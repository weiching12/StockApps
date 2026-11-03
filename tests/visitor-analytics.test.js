import { createHash } from 'node:crypto';
import { authDatabase } from './helpers/auth-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { OnlinePresence, presenceResponse } from '../cloudflare/presence.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query, ...values) {
    const statement = db.prepare(query);
    const rows = statement.all(...values);
    return { one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  const presence = new OnlinePresence({ storage: { sql } });
  let now = Date.UTC(2026, 9, 22, 15, 50);
  presence.now = () => now;
  const accountDb = authDatabase();
  accountDb.sqlite.prepare('INSERT INTO app_users(id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)').run('admin', 'admin', 'unused', 'admin', Date.now());
  accountDb.sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(createHash('sha256').update('a'.repeat(64)).digest('hex'), 'admin', Date.now() + 3600000);
  const env = { T86_DB: accountDb, ONLINE_PRESENCE: { getByName: () => presence } };
  const request = (path = '', options = {}) => {
    const req = new Request(`https://stock.test/api/v1/presence${path}`, options);
    if (Object.hasOwn(options, 'cf')) Object.defineProperty(req, 'cf', { value: options.cf });
    return presenceResponse(req, env);
  };
  const get = (query = '') => request(query, { headers: { Cookie: '__Host-stock_session=' + 'a'.repeat(64) } });
  const post = (id, nationality, options = {}) => request('', { method: 'POST', body: JSON.stringify({ id, nationality, ...options }), headers: { 'CF-Connecting-IP': '203.0.113.7', 'CF-IPCountry': 'TW' } });
  return { db, accountDb, env, presence, request, get, post, advance: ms => { now += ms; } };
}
test('anonymous writes disclose no counts; every public GET requires administrator authentication', async () => {
  const f = fixture();
  try {
    const response = await f.post(crypto.randomUUID(), '台灣');
    assert.deepEqual(await response.json(), { recorded: true });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await f.request()).status, 401);
    assert.equal((await f.request('', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    delete f.env.T86_DB;
    assert.equal((await f.get()).status, 503);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});
test('events survive midnight and restart, retry the same entry once and retain trusted-edge metadata', async () => {
  const f = fixture(), id = crypto.randomUUID(), visitId = crypto.randomUUID();
  try {
    await f.post(id, '台灣', { visitId }); f.advance(60000); await f.post(id, undefined, { visitId });
    let data = await (await f.get()).json();
    assert.equal(data.today.today, 1); assert.equal(data.total, 1);
    assert.equal(Object.hasOwn(data.visitors[0], 'nationality'), false); assert.equal(data.visitors[0].ip, '203.0.113.7'); assert.equal(data.visitors[0].country, 'TW');
    assert.ok(data.visitors[0].last_seen > data.visitors[0].first_seen);
    f.advance(10 * 60000); await f.post(id, '台灣');
    await f.post(crypto.randomUUID());
    data = await (await f.get('?start=2026-10-22&end=2026-10-23')).json();
    assert.equal(data.today.today, 2); assert.equal(data.total, 3);
    assert.deepEqual(data.daily, [{ day: '2026-10-23', visitors: 2, visits: 2 }, { day: '2026-10-22', visitors: 1, visits: 1 }]);
    const { PresenceRepository } = await import('../cloudflare/repositories/presence-repository.js');
    const repository = new PresenceRepository(f.presence.sql);
    assert.equal(repository.analytics('2026-10-22', '2026-10-23', 100, 0).total, 3);
    assert.equal((await f.get('?start=2026-02-30')).status, 400);
    assert.equal((await f.get('?offset=-1')).status, 400);
    assert.equal((await f.get('?start=2026-10-24&end=2026-10-23')).status, 400);
    data = await (await f.get('?start=2026-10-22&end=2026-10-23&offset=2')).json();
    assert.equal(data.visitors.length, 1);
    data = await (await f.get('?start=2026-10-22&end=2026-10-23&limit=2')).json();
    assert.deepEqual([data.visitors.length, data.limit, data.detailTotal], [2, 2, 3]);
    for (const limit of ['0', '101', '1.5']) assert.equal((await f.get(`?limit=${limit}`)).status, 400, limit);
    assert.equal((await f.post(id, 'x'.repeat(81))).status, 200); // Retired PWA field is ignored.
    assert.equal((await f.request('', { method: 'POST', body: 'x'.repeat(513) })).status, 413);
    assert.equal((await f.request('', { method: 'POST', headers: { Origin: 'https://other.test' } })).status, 403);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('trend preserves date order and unknown gaps without inventing historical zeroes', async () => {
  const { trendSeries } = await import('../public/visitor-trend.js');
  assert.deepEqual(trendSeries('2026-10-21', '2026-10-23', [{ day: '2026-10-23', visitors: 3 }, { day: '2026-10-21', visitors: 1 }]), [
    { day: '2026-10-21', value: 1 }, { day: '2026-10-22', value: null }, { day: '2026-10-23', value: 3 },
  ]);
});

test('monthly and whole-history trends count page entries including repeat browsers', async () => {
  const f = fixture(), id = crypto.randomUUID();
  try {
    await f.post(id, '台灣'); f.advance(86400000); await f.post(id, '台灣');
    f.advance(31 * 86400000); await f.post(id);
    let data = await (await f.get('?scope=history')).json();
    assert.equal(data.period, 'month'); assert.equal(data.unique, 1); assert.equal(data.total, 3);
    assert.deepEqual(data.daily, [{ day: '2026-11', visitors: 1, visits: 1 }, { day: '2026-10', visitors: 2, visits: 2 }]);
    const { trendSeries } = await import('../public/visitor-trend.js');
    assert.deepEqual(trendSeries('2026-10-22', '2026-11-23', data.daily, 'month').map(p => p.value), [2, 1]);
    assert.equal((await f.get('?start=2020-01-01&end=2026-10-23')).status, 400);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('repeat entries count individually; retries and metadata-only updates cannot add or rebind events', async () => {
  const f = fixture(), id = crypto.randomUUID(), visitId = crypto.randomUUID();
  try {
    await f.post(id, '台灣', { visitId });
    await f.post(id, '台灣', { visitId });
    await f.post(id, '日本', { visitId, metadataOnly: true });
    let data = await (await f.get('?month=2026-10')).json();
    assert.equal(data.total, 1); assert.equal(data.overall.total, 1);
    assert.equal(Object.hasOwn(data.visitors[0], 'nationality'), false);
    assert.equal(f.db.prepare('SELECT nationality FROM visit_events WHERE event_id = ?').get(visitId).nationality, null);
    await f.post(crypto.randomUUID(), '不可改綁', { visitId });
    await f.post(crypto.randomUUID(), '不可修改', { visitId, metadataOnly: true });
    await f.post(id, '不存在', { visitId: crypto.randomUUID(), metadataOnly: true });
    data = await (await f.get('?month=2026-10')).json();
    assert.equal(data.total, 1); assert.equal(data.visitors[0].country, 'TW');
    await f.post(id, undefined, { visitId: crypto.randomUUID() });
    await f.post(id); await f.post(id); // Legacy clients omit keys: each POST is a page entry.
    data = await (await f.get('?month=2026-10')).json();
    assert.equal(data.total, 4); assert.equal(data.unique, 1);
    f.advance(86400000);
    await f.post(id, undefined, { visitId });
    data = await (await f.get('?month=2026-10')).json();
    assert.equal(data.total, 4); assert.equal(data.today.today, 0);
    assert.equal(data.visitors.find(event => event.event_id === visitId).day, '2026-10-22');
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('month and selected-day filters retain the full monthly trend and lifetime total across pagination', async () => {
  const f = fixture(), id = crypto.randomUUID();
  try {
    for (let index = 0; index < 102; index++) await f.post(id, undefined, { visitId: crypto.randomUUID() });
    f.advance(86400000);
    for (let index = 0; index < 3; index++) await f.post(id, undefined, { visitId: crypto.randomUUID() });
    let data = await (await f.get('?month=2026-10&selectedDay=2026-10-22&offset=100')).json();
    assert.equal(data.month, '2026-10'); assert.equal(data.start, '2026-10-01'); assert.equal(data.end, '2026-10-23');
    assert.equal(data.total, 105); assert.equal(data.detailTotal, 102); assert.equal(data.visitors.length, 2);
    assert.equal(data.visitors.every(event => event.day === '2026-10-22'), true);
    assert.deepEqual(data.daily, [{ day: '2026-10-23', visitors: 3, visits: 3 }, { day: '2026-10-22', visitors: 102, visits: 102 }]);
    assert.deepEqual(data.overall, { total: 105, firstDay: '2026-10-22', lastDay: '2026-10-23' });
    assert.deepEqual(data.months, ['2026-10']);
    f.advance(40 * 86400000); await f.post(id);
    data = await (await f.get('?month=2026-10&selectedDay=2026-10-23')).json();
    assert.equal(data.total, 105); assert.equal(data.detailTotal, 3); assert.equal(data.overall.total, 106);
    assert.deepEqual(data.months, ['2026-12', '2026-10']);
    const emptyMonth = await (await f.get('?month=2026-11')).json();
    assert.equal(emptyMonth.total, 0); assert.deepEqual(emptyMonth.daily, []); assert.deepEqual(emptyMonth.visitors, []);
    assert.equal(emptyMonth.overall.total, 106);
    const emptyDay = await (await f.get('?month=2026-10&selectedDay=2026-10-21')).json();
    assert.equal(emptyDay.detailTotal, 0); assert.equal(emptyDay.total, 105); assert.equal(emptyDay.daily.length, 2);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('calendar validation rejects future months, invalid dates and selected days outside the month', async () => {
  const f = fixture();
  try {
    for (const query of ['month=', 'month=2026-1', 'month=2026-13', 'month=2026-11', 'month=0000-01',
      'month=2026-10&selectedDay=2026-09-30', 'month=2026-10&selectedDay=2026-10-23',
      'month=2026-02&selectedDay=2026-02-30', 'month=2026-10&selectedDay=', 'month=2026-10&offset=1.5'])
      assert.equal((await f.get(`?${query}`)).status, 400, query);
    const empty = await (await f.get()).json();
    assert.equal(empty.month, '2026-10'); assert.equal(empty.total, 0); assert.equal(empty.detailTotal, 0);
    assert.deepEqual(empty.overall, { total: 0, firstDay: null, lastDay: null }); assert.deepEqual(empty.months, ['2026-10']);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('existing daily history imports once, preserves unknown times, and never invents previously discarded repeat views', async () => {
  const f = fixture(), id = crypto.randomUUID();
  try {
    // Recreate an old database before event migration to exercise a crash-safe import retry.
    f.db.exec('DROP TABLE visit_events; DROP TABLE presence_migrations');
    f.db.prepare('INSERT INTO visit_history(day,id,first_seen,last_seen,nationality) VALUES (?,?,?,?,?)').run('2026-10-21', id, null, null, '台灣');
    f.db.prepare('INSERT INTO visit_history(day,id,first_seen,last_seen,nationality) VALUES (?,?,?,?,?)').run('2026-10-22', id, 123, 456, '台灣');
    const { PresenceRepository } = await import('../cloudflare/repositories/presence-repository.js');
    const first = new PresenceRepository(f.presence.sql), second = new PresenceRepository(f.presence.sql);
    assert.equal(first.overall().total, 2); assert.equal(second.overall().total, 2);
    const events = second.analytics('2026-10-01', '2026-10-22', 100, 0).visitors;
    assert.equal(events.find(event => event.day === '2026-10-21').first_seen, null);
    assert.equal(events.find(event => event.day === '2026-10-22').last_seen, 456);
    assert.equal(events.every(event => !Object.hasOwn(event, 'nationality')), true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM visit_history').get().n, 2);
    assert.equal(f.db.prepare('SELECT nationality FROM visit_history LIMIT 1').get().nationality, '台灣');
    assert.equal(f.db.prepare('SELECT count(DISTINCT legacy_key) n FROM visit_events').get().n, 2);
    assert.equal(f.db.prepare('SELECT count(*) n FROM presence_migrations').get().n, 1);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});

test('country comes from original trusted edge metadata before DO forwarding; JSON geography is ignored', async () => {
  const f = fixture(), id = crypto.randomUUID();
  try {
    const cases = [
      { cf: { country: 'tw' }, header: 'JP', expected: 'TW' },
      { header: 'gb', expected: 'GB' },
      { cf: { country: 'XX' }, header: 'us', expected: 'US' },
      { cf: { country: 'T1' }, header: 'XX', expected: null },
      { cf: { country: 'unknown' }, header: 'ZZ', expected: null },
      { expected: null },
    ];
    for (const entry of cases) {
      const visitId = crypto.randomUUID();
      const response = await f.request('', {
        method: 'POST', ...(entry.cf ? { cf: entry.cf } : {}),
        headers: { 'CF-Connecting-IP': '203.0.113.19', ...(entry.header ? { 'CF-IPCountry': entry.header } : {}) },
        body: JSON.stringify({ id, visitId, nationality: { ignored: true }, country: 'CN', ip: '192.0.2.2' }),
      });
      assert.equal(response.status, 200);
      const stored = f.db.prepare('SELECT * FROM visit_events WHERE event_id = ?').get(visitId);
      assert.equal(stored.country, entry.expected);
      assert.equal(stored.ip, '203.0.113.19');
      assert.equal(stored.nationality, null);
    }
    const data = await (await f.get('?month=2026-10')).json();
    assert.equal(data.total, cases.length);
    assert.equal(data.visitors.every(event => !Object.hasOwn(event, 'nationality')), true);
    assert.equal(data.visitors.some(event => event.country === 'CN'), false);
    // Retained historical fields are not exposed, and legacy malformed country codes are unknown.
    f.db.prepare("UPDATE visit_events SET nationality = '舊資料', country = 'XX' WHERE event_id = ?").run(data.visitors[0].event_id);
    const sanitized = await (await f.get('?month=2026-10')).json();
    assert.equal(sanitized.visitors.find(event => event.event_id === data.visitors[0].event_id).country, null);
    assert.equal(JSON.stringify(sanitized).includes('舊資料'), false);
  } finally { f.db.close(); f.accountDb.sqlite.close(); }
});
