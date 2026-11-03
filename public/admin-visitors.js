import { trendSeries } from './visitor-trend.js';
const node = id => document.getElementById(id);
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
// Visitor details are shown ten rows per page.
const PAGE_SIZE = 10;
let month = today.slice(0, 7), selectedDay = null, offset = 0;
let generation = 0, controller, pendingKey, currentData, renderedWidth, renderedMonth;
const count = value => value.toLocaleString('zh-TW');
const monthLabel = value => `${value.slice(0, 4)}年${Number(value.slice(5))}月`;
const time = value => value == null || !Number.isFinite(new Date(value).getTime()) ? '未記錄'
  : new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
let countryNames;
try { countryNames = new Intl.DisplayNames(['zh-Hant'], { type: 'region' }); } catch { /* Keep ISO labels usable on older browsers. */ }
function countryName(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code) || ['XX', 'ZZ'].includes(code)) return '未知';
  const name = countryNames?.of(code);
  return name && name !== code ? name : countryNames ? '未知' : code;
}

function fillMonths(months) {
  const values = [...new Set([month, ...months])].sort().reverse();
  node('month').replaceChildren(...values.map(value => {
    const option = document.createElement('option'); option.value = value; option.textContent = monthLabel(value); return option;
  }));
  node('month').value = month;
}
fillMonths([month]);

function setLoading(loading) {
  const reportVisible = !node('report').hidden;
  node('initial-loading').hidden = !loading || reportVisible;
  node('details-loading').hidden = !loading || !reportVisible;
  node('visitor-details').setAttribute('aria-busy', String(loading));
}

function clearData() {
  currentData = null; renderedMonth = null;
  for (const id of ['visitors', 'trend', 'today-date', 'overall-start', 'selected-day-text', 'pagination']) node(id).replaceChildren();
  for (const id of ['today', 'cumulative']) node(id).textContent = '—';
  node('show-month').hidden = true;
}
function clearReport() {
  generation++; controller?.abort(); pendingKey = null; clearData();
  node('report').hidden = true; node('logout').hidden = true; node('push-panel').hidden = true;
  setLoading(false);
  node('login').hidden = true; node('retry').hidden = true; node('status').textContent = '';
}
function renderVisitors(data) {
  const rows = data.visitors.map(visit => {
    const row = document.createElement('tr');
    for (const value of [visit.day.slice(5), visit.id, countryName(visit.country), visit.ip || '未記錄', time(visit.first_seen), time(visit.last_seen)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    row.firstElementChild.title = visit.day;
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 6; cell.className = 'empty-state'; cell.textContent = selectedDay ? '當天尚無造訪紀錄' : '此月份尚無造訪紀錄';
    row.append(cell); rows.push(row);
  }
  node('visitors').replaceChildren(...rows);
  node('selected-day-text').textContent = `${selectedDay ? selectedDay.replaceAll('-', '/') : monthLabel(month) + ' · 全月'} · ${count(data.detailTotal)} 次造訪`;
  node('show-month').hidden = !selectedDay;
  const pages = Math.max(1, Math.ceil(data.detailTotal / data.limit));
  node('pagination').textContent = `第 ${Math.floor(offset / data.limit) + 1}／${pages} 頁 · 共 ${count(data.detailTotal)} 筆`;
  node('previous').disabled = offset === 0; node('next').disabled = offset + data.limit >= data.detailTotal;
}

async function load() {
  const params = new URLSearchParams({ month, offset, limit: PAGE_SIZE });
  if (selectedDay) params.set('selectedDay', selectedDay);
  const key = params.toString();
  if (pendingKey === key) return;
  controller?.abort(); controller = new AbortController(); pendingKey = key;
  const requestGeneration = ++generation, requestedMonth = month;
  node('status').dataset.state = 'pending'; node('status').textContent = '';
  setLoading(true);
  node('retry').hidden = true; node('login').hidden = true;
  node('visitors').replaceChildren(); node('pagination').textContent = '';
  node('previous').disabled = true; node('next').disabled = true;
  if (currentData?.month !== month) clearData();
  else renderTrend(currentData);
  node('selected-day-text').textContent = selectedDay ? selectedDay.replaceAll('-', '/') : monthLabel(month) + ' · 全月';
  node('show-month').hidden = !selectedDay;
  try {
    const response = await fetch(`/api/v1/presence?${params}`, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
    if (requestGeneration !== generation) return;
    if (response.status === 401) { clearReport(); location.replace('/login.html'); return; }
    if (response.status === 403) {
      const failure = await response.clone().json().catch(() => null);
      if (requestGeneration !== generation) return;
      clearReport();
      if ((failure?.error?.code || failure?.code) === 'PASSWORD_CHANGE_REQUIRED') { location.replace('/change-password.html'); return; }
      node('status').dataset.state = 'error'; node('status').textContent = '僅管理員可查看造訪紀錄'; node('login').hidden = false;
      return;
    }
    if (!response.ok) throw new Error(response.status >= 500 ? '統計服務暫時無法使用，請稍後再試。' : '無法載入此月份，請稍後再試。');
    const data = await response.json().catch(() => { throw new Error('統計資料回應異常，請稍後再試。'); });
    if (requestGeneration !== generation) return;
    if (!data || data.month !== requestedMonth || !Array.isArray(data.months) || !Array.isArray(data.daily) || !Array.isArray(data.visitors)
        || !Number.isFinite(data.today?.today) || typeof data.today.asOf !== 'string' || !Number.isFinite(data.overall?.total)
        || !Number.isFinite(data.total) || !Number.isFinite(data.detailTotal) || !Number.isFinite(data.limit)
        || typeof data.start !== 'string' || typeof data.end !== 'string') throw new Error('統計資料回應異常，請稍後再試。');
    currentData = data; fillMonths(data.months);
    node('today').textContent = count(data.today.today); node('today-date').textContent = data.today.asOf;
    node('cumulative').textContent = count(data.overall.total);
    node('overall-start').textContent = data.overall.firstDay ? `自 ${data.overall.firstDay.replaceAll('-', '/')}` : '—';
    node('report').hidden = false; node('logout').hidden = false; node('status').textContent = '';
    renderTrend(data); renderVisitors(data);
  } catch (error) {
    if (requestGeneration !== generation) return;
    node('status').dataset.state = 'error';
    node('status').textContent = error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name)
      ? '無法取得訪客統計，請確認連線後重試。' : error.message;
    node('retry').hidden = false;
  } finally { if (requestGeneration === generation) { pendingKey = null; setLoading(false); } }
}

function chooseDay(day) {
  selectedDay = day; offset = 0; void load();
}
function renderTrend(data) {
  const container = node('trend'), focusDay = container.contains(document.activeElement) ? document.activeElement.dataset.day : null;
  const sameMonth = renderedMonth === data.month;
  const previousScroll = sameMonth ? container.scrollLeft : 0;
  const series = trendSeries(data.start, data.end, data.daily, 'day');
  renderedWidth = Math.round(container.clientWidth); renderedMonth = data.month;
  const width = Math.max(280, renderedWidth, series.length * 26 + 44), height = 240;
  const left = 32, right = width - 12, baseline = 204, slot = (right - left) / Math.max(1, series.length);
  const max = Math.max(1, ...series.map(point => point.value ?? 0));
  const x = index => left + slot * (index + .5), y = value => baseline - value / max * 168;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.style.width = `${width}px`;
  svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', `${monthLabel(month)}每日瀏覽數，選取日期查看造訪明細`);
  const add = (parent, tag, attrs, text) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text != null) element.textContent = text;
    parent.append(element); return element;
  };
  for (const value of new Set([0, Math.round(max / 2), max])) {
    add(svg, 'line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: '#e8edf5' });
    add(svg, 'text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#64748b' }, value);
  }
  let previous;
  series.forEach((point, index) => {
    if (point.value !== null && previous !== undefined)
      add(svg, 'line', { x1: x(previous), x2: x(index), y1: y(series[previous].value), y2: y(point.value), stroke: '#2563eb', 'stroke-width': 2 });
    previous = point.value === null ? undefined : index;
  });
  series.forEach((point, index) => {
    const isSelected = point.day === selectedDay;
    const label = `${Number(point.day.slice(5, 7))}月${Number(point.day.slice(8))}日，${point.value === null ? '無造訪紀錄' : point.value + ' 次造訪'}`;
    const group = add(svg, 'g', { role: 'button', tabindex: '0', 'aria-label': label, 'aria-pressed': String(isSelected), 'data-day': point.day });
    add(group, 'rect', { x: x(index) - slot / 2, y: 12, width: slot, height: 220, rx: 6, fill: isSelected ? '#eff6ff' : 'transparent', class: 'day-target' });
    if (point.value !== null) {
      add(group, 'circle', { cx: x(index), cy: y(point.value), r: isSelected ? 4 : 3, fill: isSelected ? '#2563eb' : '#fff', stroke: '#2563eb', 'stroke-width': 2 });
      add(group, 'text', { x: x(index), y: y(point.value) - 12, 'text-anchor': 'middle', 'font-size': 11, fill: '#2563eb', 'font-weight': 600 }, point.value);
    }
    add(group, 'text', { x: x(index), y: 226, 'text-anchor': 'middle', 'font-size': 12, fill: isSelected ? '#2563eb' : '#64748b' }, Number(point.day.slice(8)));
    add(group, 'title', {}, label);
    group.onclick = () => chooseDay(point.day);
    group.onkeydown = event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); chooseDay(point.day); }
      else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? series.length - 1 : Math.max(0, Math.min(series.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
        svg.querySelectorAll('[data-day]')[next]?.focus();
      }
    };
  });
  container.replaceChildren(svg);
  const lastRecorded = series.findLastIndex(point => point.value !== null);
  container.scrollLeft = sameMonth ? previousScroll : Math.max(0, x(Math.max(0, lastRecorded)) - container.clientWidth * .75);
  if (focusDay) container.querySelector(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
}

node('month').onchange = () => { month = node('month').value; selectedDay = null; offset = 0; void load(); };
node('show-month').onclick = () => { selectedDay = null; offset = 0; void load(); };
node('previous').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); void load(); };
node('next').onclick = () => { offset += PAGE_SIZE; void load(); };
node('retry').onclick = () => void load();
node('logout').onclick = async () => {
  clearReport();
  try {
    const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error();
    const channel = new BroadcastChannel('stock-insight-auth'); channel.postMessage('changed'); channel.close();
    location.replace('/login.html');
  } catch { node('status').dataset.state = 'error'; node('status').textContent = '登出失敗，請重新登入後重試'; node('login').hidden = false; }
};
const SERVICE_LABELS = { apple: 'Apple（iPhone、iPad、Mac Safari）', google: 'Google（Android、Chrome）',
  microsoft: 'Microsoft（Windows、Edge）', mozilla: 'Mozilla（Firefox）', other: '其他' };
let pushGeneration = 0, pushSending = false, pushPending = 0;
function renderPush(data) {
  const web = data.web, native = data.native;
  pushPending = web.pending + (native ? native.total - native.delivered : 0);
  node('push-date').textContent = `資料日 ${data.asOf.replaceAll('-', '/')}`;
  node('push-total').textContent = count(web.total + (native?.total ?? 0));
  node('push-delivered').textContent = count(web.delivered + (native?.delivered ?? 0));
  node('push-rejected').textContent = count(web.rejected);
  node('push-pending').textContent = count(pushPending);
  const rows = web.services.map(item => [SERVICE_LABELS[item.service] ?? item.service, item.total, item.delivered, item.rejected, item.pending, item.lastFailure ?? '—']);
  if (native) rows.push(['iOS App（APNs）', native.total, native.delivered, '—', native.total - native.delivered, '—']);
  node('push-services').replaceChildren(...(rows.length ? rows : [['目前沒有訂閱裝置']]).map(values => {
    const row = document.createElement('tr');
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = typeof value === 'number' ? count(value) : value; row.append(cell); }
    if (values.length === 1) { row.firstElementChild.colSpan = 6; row.firstElementChild.className = 'empty-state'; }
    return row;
  }));
  node('push-resend').disabled = pushSending || pushPending === 0;
  node('push-resend').title = pushPending === 0 ? '今日沒有待發送的裝置' : '';
}
async function loadPush() {
  const requestGeneration = ++pushGeneration;
  node('push-loading').hidden = false; node('push-panel').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/v1/push/status', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (requestGeneration !== pushGeneration) return;
    // Sign-in and role problems are reported by the visitor report; keep the panel hidden.
    if ([401, 403].includes(response.status)) { node('push-panel').hidden = true; return; }
    if (!response.ok) throw new Error();
    const { data } = await response.json();
    if (requestGeneration !== pushGeneration) return;
    renderPush(data); node('push-panel').hidden = false;
  } catch {
    if (requestGeneration !== pushGeneration) return;
    node('push-panel').hidden = false;
    node('push-message').dataset.state = 'error'; node('push-message').textContent = '無法取得推播狀態，請稍後重新整理。';
  } finally { if (requestGeneration === pushGeneration) { node('push-loading').hidden = true; node('push-panel').setAttribute('aria-busy', 'false'); } }
}
node('push-resend').onclick = async () => {
  pushSending = true; node('push-resend').disabled = true;
  node('push-message').dataset.state = 'pending'; node('push-message').textContent = '發送中…';
  try {
    const response = await fetch('/api/v1/push/resend', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || '重新發送失敗，請稍後再試。');
    const { web, native } = body.data;
    const sent = web.sent + (native?.sent ?? 0), failed = web.failed + (native?.failed ?? 0);
    node('push-message').dataset.state = web.rejected || failed ? 'error' : 'done';
    node('push-message').textContent = sent + web.rejected + failed === 0 ? '今日沒有待發送的裝置。'
      : `已送出 ${count(sent)} 則${web.rejected ? `，被拒 ${count(web.rejected)} 則` : ''}${failed ? `，暫時失敗 ${count(failed)} 則（稍後可再試）` : ''}。`;
  } catch (error) {
    node('push-message').dataset.state = 'error';
    node('push-message').textContent = error instanceof TypeError || error.name === 'TimeoutError' ? '無法連線，請確認網路後重試。' : error.message;
  } finally { pushSending = false; await loadPush(); }
};

window.addEventListener('pagehide', clearReport);
window.addEventListener('pageshow', () => { void load(); void loadPush(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void load(); void loadPush(); } });
const channel = new BroadcastChannel('stock-insight-auth');
channel.onmessage = () => { clearReport(); void load(); void loadPush(); };
new ResizeObserver(() => {
  if (currentData && !node('report').hidden && Math.round(node('trend').clientWidth) !== renderedWidth) renderTrend(currentData);
}).observe(node('trend'));
