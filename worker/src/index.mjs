const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
const decodeBase32 = (value) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = '';
  for (const char of normalized) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return null;
    bits += digit.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
};
async function totp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const message = new Uint8Array(8);
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i--) { message[i] = Number(value & 255n); value >>= 8n; }
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}
async function validTotp(code, encodedSecret) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const secret = decodeBase32(encodedSecret);
  if (!secret || secret.length < 20) return false;
  const step = Math.floor(Date.now() / 30_000);
  const candidates = await Promise.all([-1, 0, 1].map((drift) => totp(secret, step + drift)));
  return candidates.reduce((matched, candidate) => timingSafeEqual(code, candidate) || matched, false);
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

let ossModule;
const workerUrllib = {
  async request(url, options = {}) {
    const headers = new Headers();
    const workerManagedHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'user-agent']);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (!workerManagedHeaders.has(name.toLowerCase())) headers.set(name, value);
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      ...(options.data == null ? {} : { body: options.data }),
      redirect: 'manual',
    });
    return {
      status: response.status,
      data: await response.text(),
      headers: Object.fromEntries(response.headers.entries()),
      res: response,
    };
  },
};
async function makeOss(env) {
  if (!ossModule) {
    if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
    globalThis.location ??= new URL('https://localhost/');
    ossModule = import('ali-oss').then((module) => module.default);
  }
  const OSS = await ossModule;
  return new OSS({
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    bucket: env.OSS_BUCKET,
    region: env.OSS_REGION,
    endpoint: `https://oss-${env.OSS_REGION}.aliyuncs.com`,
    secure: true,
    authorizationV4: true,
    urllib: workerUrllib,
  });
}

async function validSession(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const [expires, signature] = token.split('.');
  if (!expires || !signature || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(signature, b64url(await hmac(env.SESSION_SECRET, expires)));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const cors = origin === allowedOrigin ? {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'vary': 'Origin',
    } : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (origin && origin !== allowedOrigin) return json({ error: 'origin_not_allowed' }, 403);
    if (!env.DRIVE_PASSWORD || !env.TOTP_SECRET || !env.SESSION_SECRET || !env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) return json({ error: 'not_configured' }, 503, cors);
    if (new URL(request.url).pathname === '/api/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, cors); }
      const passwordValid = typeof body.password === 'string' && timingSafeEqual(body.password, env.DRIVE_PASSWORD);
      const codeValid = await validTotp(body.code, env.TOTP_SECRET);
      if (!passwordValid || !codeValid) return json({ error: 'invalid_credentials' }, 401, cors);
      const expires = String(Math.floor(Date.now() / 1000) + 60 * 60 * 8);
      const token = `${expires}.${b64url(await hmac(env.SESSION_SECRET, expires))}`;
      return json({ token, expiresAt: Number(expires) }, 200, cors);
    }
    if (!await validSession(request, env)) return json({ error: 'unauthorized' }, 401, cors);

    const url = new URL(request.url);
    if (url.pathname === '/api/files' && request.method === 'GET') {
      const client = await makeOss(env);
      const files = [];
      let token;
      do {
        const query = { 'max-keys': 1000 };
        if (token) query['continuation-token'] = token;
        const result = await client.listV2(query);
        for (const object of result.objects ?? []) {
          if (!object.name || object.name.endsWith('/')) continue;
          files.push({ name: object.name, size: Number(object.size) || 0, modified: object.lastModified ?? null });
        }
        token = result.isTruncated ? result.nextContinuationToken : undefined;
      } while (token && files.length < 10000);
      return json({ files }, 200, cors);
    }
    if (url.pathname === '/api/download' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, cors); }
      const key = body?.key;
      if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('..') || key.includes('\\')) return json({ error: 'invalid_key' }, 400, cors);
      const signedUrl = await (await makeOss(env)).signatureUrlV4('GET', 300, {}, key);
      return json({ url: signedUrl, expiresIn: 300 }, 200, cors);
    }
    return json({ error: 'not_found' }, 404, cors);
  },
};

