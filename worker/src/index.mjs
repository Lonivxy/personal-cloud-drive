import OSS from 'ali-oss';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

function makeOss(env) {
  return new OSS({
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    bucket: env.OSS_BUCKET,
    region: env.OSS_REGION,
    endpoint: `https://${env.OSS_REGION}.aliyuncs.com`,
    secure: true,
    authorizationV4: true,
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
    if (new URL(request.url).pathname === '/api/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400, cors); }
      if (typeof body.password !== 'string' || !timingSafeEqual(body.password, env.DRIVE_PASSWORD ?? '')) return json({ error: 'invalid_password' }, 401, cors);
      const expires = String(Math.floor(Date.now() / 1000) + 60 * 60 * 8);
      const token = `${expires}.${b64url(await hmac(env.SESSION_SECRET, expires))}`;
      return json({ token, expiresAt: Number(expires) }, 200, cors);
    }
    if (!await validSession(request, env)) return json({ error: 'unauthorized' }, 401, cors);

    const url = new URL(request.url);
    if (url.pathname === '/api/files' && request.method === 'GET') {
      const client = makeOss(env);
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
      const signedUrl = await makeOss(env).signatureUrlV4('GET', 300, {}, key);
      return json({ url: signedUrl, expiresIn: 300 }, 200, cors);
    }
    return json({ error: 'not_found' }, 404, cors);
  },
};
