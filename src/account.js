// One document shares account state and a single cross-tab subscription across
// the desktop top bar and repeatedly opened mobile settings.
const menus = new Map();
const listeners = new Set();
let user = null, loaded = false, busy = false, logoutFailed = false;
let generation = 0, pending, controller, channel, listening = false;

function accountLink(text, href, settings) {
  const link = document.createElement('a');
  link.href = href; link.textContent = text;
  if (settings) link.className = 'outline-button account-destination';
  return link;
}

function render(node, settings) {
  node.replaceChildren();
  if (!user) {
    const login = accountLink('登入', '/login.html', settings);
    if (settings) login.className = 'outline-button account-login';
    node.append(login); return;
  }
  const label = document.createElement('span');
  label.className = 'account-identity'; label.textContent = user.username; label.title = user.username;
  node.append(label);
  const destination = user.mustChangePassword
    ? accountLink('設定新密碼', '/change-password.html', settings)
    : user.role === 'admin' ? accountLink('管理', '/admin-visitors.html', settings) : null;
  if (destination && !settings) node.append(destination);
  const logout = document.createElement('button');
  logout.type = 'button'; logout.textContent = busy ? '登出中…' : logoutFailed ? '登出失敗，重試' : '登出';
  logout.disabled = busy;
  if (settings) logout.className = 'outline-button account-logout';
  logout.onclick = () => void signOut();
  node.append(logout);
  if (destination && settings) node.append(destination);
}

/** Called with the account now and on every change, once it is known. */
export function onAccountChange(listener) {
  listeners.add(listener);
  if (loaded) listener(user);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener(user);
  for (const [node, settings] of menus) {
    if (node.isConnected) render(node, settings);
    else menus.delete(node);
  }
  if (!menus.size) stopListening();
}

function invalidateRequest() {
  generation++; controller?.abort(); controller = null; pending = null;
}

async function refresh(force = false) {
  if (force) invalidateRequest();
  if (pending) return pending;
  const requestGeneration = generation;
  const abort = new AbortController(); controller = abort;
  pending = Promise.resolve().then(async () => {
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) return;
      const body = await response.json();
      if (!Object.hasOwn(body ?? {}, 'user') || (body.user !== null &&
          (typeof body.user?.username !== 'string' || !['admin', 'user'].includes(body.user.role)))) return;
      if (requestGeneration !== generation) return;
      user = body.user; loaded = true; logoutFailed = false; notify();
    } catch { /* Account services must not prevent public market browsing. */ }
    finally { if (requestGeneration === generation) { pending = null; controller = null; } }
  });
  return pending;
}

async function signOut() {
  if (busy) return;
  invalidateRequest(); busy = true; logoutFailed = false; notify();
  try {
    const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    invalidateRequest();
    user = null; loaded = true;
    channel?.postMessage('changed');
  } catch { logoutFailed = true; }
  finally { busy = false; notify(); }
}

const onFocus = () => { if (!document.hidden && !busy) void refresh(); };
function stopListening() {
  channel?.close(); channel = null;
  if (listening) {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    listening = false;
  }
  invalidateRequest();
}

export function startAccountMenu(node, { settings = false } = {}) {
  if (!node) return;
  menus.set(node, settings);
  if (!listening) {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('stock-insight-auth');
      channel.onmessage = () => { if (!busy) void refresh(true); };
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    listening = true;
  }
  render(node, settings);
  if (!loaded || settings) void refresh();
  return { refresh: () => refresh(), stop() { menus.delete(node); if (!menus.size) stopListening(); } };
}
