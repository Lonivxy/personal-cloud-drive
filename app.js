const state = { files: [], kind: 'all', query: '', list: false };
const API = (window.PERSONAL_CLOUD_API || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const formatSize = (n) => { if (!Number.isFinite(Number(n))) return '—'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, value = Number(n); while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; } return `${value.toFixed(i ? 1 : 0)} ${units[i]}`; };
const kindOf = (file) => { const ext = (file.name.split('.').pop() || '').toLowerCase(); if (['zip','7z','rar','tar','gz','bz2','xz'].includes(ext)) return 'archive'; if (['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md'].includes(ext)) return 'document'; if (['jpg','jpeg','png','gif','webp','svg','heic'].includes(ext)) return 'image'; return 'other'; };
const iconOf = (kind) => ({ archive: '▧', document: '▤', image: '▨', other: '◇' })[kind] || '◇';
let token = sessionStorage.getItem('cloud-drive-session') || '';
async function api(path, options = {}) {
  if (!API) throw new Error('api_not_configured');
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, cache: 'no-store' });
  if (response.status === 401) { token = ''; sessionStorage.removeItem('cloud-drive-session'); throw new Error('unauthorized'); }
  if (!response.ok) throw new Error(`api_${response.status}`);
  return response.json();
}
function render() {
  const visible = state.files.filter((f) => (state.kind === 'all' || kindOf(f) === state.kind) && f.name.toLowerCase().includes(state.query));
  $('file-count').textContent = String(state.files.length);
  $('total-size').textContent = formatSize(state.files.reduce((sum, f) => sum + (Number(f.size) || 0), 0));
  const latest = state.files.map((f) => f.modified).filter(Boolean).sort().at(-1);
  $('last-updated').textContent = latest ? new Date(latest).toLocaleDateString('zh-CN') : '—';
  $('result-count').textContent = `${visible.length} 个文件`;
  $('file-list').innerHTML = visible.map((f) => {
    const kind = kindOf(f); const date = f.modified ? new Date(f.modified).toLocaleDateString('zh-CN') : '—';
    return `<article class="file-row"><div class="file-name"><span class="file-icon ${kind}">${iconOf(kind)}</span><div><div class="file-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div><div class="file-subtitle">${escapeHtml((f.name.split('.').pop() || 'FILE').toUpperCase())}</div></div></div><span class="file-size">${formatSize(f.size)}</span><span class="file-date">${escapeHtml(date)}</span><button class="download" data-key="${encodeURIComponent(f.name)}" aria-label="下载 ${escapeHtml(f.name)}" title="下载">↓</button></article>`;
  }).join('');
  $('empty-state').hidden = visible.length !== 0;
  $('empty-title').textContent = state.files.length && !visible.length ? '没有找到匹配文件' : '目录暂时为空';
  $('empty-copy').textContent = state.files.length && !visible.length ? '试试其他关键词或文件类型。' : '上传至私有 OSS Bucket 的文件会显示在这里。';
  document.querySelectorAll('.download').forEach((button) => button.addEventListener('click', () => downloadFile(decodeURIComponent(button.dataset.key), button)));
}
async function loadFiles() {
  $('file-list').innerHTML = '<div class="loading"><span class="spinner"></span>正在读取文件目录</div>';
  $('error-state').hidden = true;
  const data = await api('/api/files');
  state.files = Array.isArray(data.files) ? data.files : [];
  $('file-list').innerHTML = '';
  render();
  $('login-dialog').close();
}
async function downloadFile(key, button) {
  button.disabled = true;
  try {
    const result = await api('/api/download', { method: 'POST', body: JSON.stringify({ key }) });
    window.location.assign(result.url);
  } catch (error) {
    if (error.message === 'unauthorized') $('login-dialog').showModal();
    else $('error-state').hidden = false;
  } finally { button.disabled = false; }
}
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').hidden = true;
  const submit = $('login-form').querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('drive-password').value }) });
    token = result.token;
    sessionStorage.setItem('cloud-drive-session', token);
    $('drive-password').value = '';
    await loadFiles();
  } catch (error) {
    $('login-error').textContent = error.message === 'invalid_password' ? '密码不正确，请重试。' : '暂时无法连接云盘，请稍后重试。';
    $('login-error').hidden = false;
  } finally { submit.disabled = false; }
});
$('search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); render(); });
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { document.querySelector('.filter.active')?.classList.remove('active'); button.classList.add('active'); state.kind = button.dataset.kind; render(); }));
$('view-toggle').addEventListener('click', () => { state.list = !state.list; $('file-list').classList.toggle('list-mode', state.list); });
document.addEventListener('keydown', (e) => { if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('search').focus(); } });
if (!API) { $('file-list').innerHTML = ''; $('error-state').textContent = '云盘后端尚未配置。'; $('error-state').hidden = false; $('result-count').textContent = '尚未连接'; }
else if (token) loadFiles().catch(() => $('login-dialog').showModal());
else $('login-dialog').showModal();
