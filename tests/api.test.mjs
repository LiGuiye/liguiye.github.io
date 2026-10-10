import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { startServer } from '../scripts/server.mjs';
import { makeOrganizerConfig } from '../scripts/organizer-config.mjs';

const token = () => randomBytes(32).toString('base64url');
const organizerPassword = 'local-organizer-test-password';
const organizerConfig = makeOrganizerConfig('organizer', organizerPassword);
let creator;
const port = 8797, base = `http://127.0.0.1:${port}`;
let worker, directory, proxy, logs = '';
const environment = { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' };

async function startWorker(credentials) {
  const args = ['--config', 'scheduler/wrangler.jsonc', '--persist-to', directory];
  const variables = Object.entries(credentials).flatMap(([key, value]) => ['--var', `${key}:${value}`]);
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', ...args, '--port', String(port), ...variables, '--var', 'ENVIRONMENT:development'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', data => { logs += data; }); worker.stderr.on('data', data => { logs += data; });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    let ready = false;
    try { ready = (await fetch(`${base}/health`)).ok; } catch {}
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Local Worker did not start.\n${logs}`);
}
async function stopWorker() {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await Promise.race([new Promise(resolve => worker.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'guiye-scheduler-test-'));
  const args = ['--config', 'scheduler/wrangler.jsonc', '--persist-to', directory];
  const migrate = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'guiye-scheduler', '--local', ...args], { env: environment, encoding: 'utf8' });
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
  await startWorker(organizerConfig);
  proxy = await startServer({ port: 8798, workerPort: port });
  const login = await api('/organizer/login', { method: 'POST', data: { username: 'organizer', password: organizerPassword } });
  assert.equal(login.status, 200, JSON.stringify(login.data)); creator = login.data.token;
});
after(async () => {
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  await stopWorker();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function api(path, { method = 'GET', secret, data, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
  return { status: response.status, headers: response.headers, data: response.status === 304 || response.status === 204 ? null : await response.json() };
}
function slot(hour, minute = 0, slotMinutes = 15) {
  const start = Date.UTC(2026, 9, 12, hour, minute);
  return { startUtc: new Date(start).toISOString(), endUtc: new Date(start + slotMinutes * 60_000).toISOString() };
}
async function create(slots = [slot(15), slot(15, 15)], ownerToken = creator, slotMinutes = 15) {
  const id = randomUUID();
  const response = await api('/events', { method: 'POST', secret: ownerToken, data: { id, title: 'Committee meeting', description: '', timezone: 'America/Denver', slotMinutes, slots } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return { id, ownerToken, state: response.data };
}
async function save(event, { id, secret, name = 'Guest', password = '', available = event.state.slots.map(slot => slot.id), unavailable = [], revision, slotRevision = event.state.event.slotRevision, requestId = randomUUID() } = {}) {
  if (!id) {
    const access = await api(`/events/${event.id}/participants/access`, { method: 'POST', data: { name, password } });
    assert.equal(access.status, 200, JSON.stringify(access.data));
    id = access.data.participant.id; secret = access.data.token;
    revision ??= access.data.participant.revision;
  }
  revision ??= 0;
  const data = { name, availableSlotIds: available, unavailableSlotIds: unavailable, revision, slotRevision, requestId };
  const response = await api(`/events/${event.id}/participants/${id}`, { method: 'PUT', secret, data });
  return { id, secret, response, data };
}
async function edit(event, slots, extra = {}) {
  return api(`/events/${event.id}`, { method: 'PATCH', secret: event.ownerToken, data: { title: 'Updated meeting', description: '', slotRevision: event.state.event.slotRevision, slots, ...extra } });
}

test('creation is private, and credentials never appear in public snapshots', async () => {
  const denied = await api('/events', { method: 'POST', data: {} });
  assert.equal(denied.status, 401);
  const event = await create();
  assert.equal((await api(`/events/${event.id}/admin`, { secret: token() })).status, 401);
  assert.equal((await api(`/events/${event.id}/admin`, { secret: event.ownerToken })).status, 200);
  const guest = await save(event); assert.equal(guest.response.status, 200);
  const publicData = JSON.stringify((await api(`/events/${event.id}`)).data);
  for (const credential of [creator, guest.secret, 'token_hash', 'owner_id']) assert.ok(!publicData.includes(credential));
  assert.equal((await api(`/events/${event.id}/participants/${guest.id}`, { secret: token() })).status, 403);
  assert.equal((await api(`/events/${event.id}/participants/${guest.id}`, { secret: guest.secret })).status, 200);
  assert.equal((await api(`/events/${event.id}/participants/${guest.id}`, { method: 'PUT', secret: token(), data: guest.data })).status, 403);
});

test('organizer sign-in requires the configured username and password and returns only session details', async () => {
  for (const data of [{ username: 'other', password: organizerPassword }, { username: 'organizer', password: 'incorrect' }]) {
    assert.equal((await api('/organizer/login', { method: 'POST', data })).status, 403);
  }
  const login = await api('/organizer/login', { method: 'POST', data: { username: ' ORGANIZER ', password: organizerPassword } });
  assert.equal(login.status, 200);
  assert.equal(login.data.username, 'organizer');
  assert.ok(login.data.expiresAt > Date.now());
  assert.equal((await api('/events', { secret: login.data.token })).status, 200);
  for (const value of [organizerPassword, organizerConfig.ORGANIZER_PASSWORD_HASH, organizerConfig.ORGANIZER_PASSWORD_SALT]) {
    assert.ok(!JSON.stringify(login.data).includes(value));
  }
  assert.equal((await api('/events', { secret: token() })).status, 401);
});

test('signing out revokes only that organizer session', async () => {
  const login = await api('/organizer/login', { method: 'POST', data: { username: 'organizer', password: organizerPassword } });
  assert.equal((await api('/organizer/logout', { method: 'POST', secret: login.data.token })).status, 204);
  assert.equal((await api('/events', { secret: login.data.token })).status, 401);
  assert.equal((await api('/events', { secret: creator })).status, 200);
});

test('expired organizer sessions cannot manage events, while participation remains accessible', async () => {
  const event = await create();
  const login = await api('/organizer/login', { method: 'POST', data: { username: 'organizer', password: organizerPassword } });
  const hash = createHash('sha256').update(login.data.token).digest('hex');
  const expired = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'guiye-scheduler', '--local', '--config', 'scheduler/wrangler.jsonc', '--persist-to', directory,
    '--command', `UPDATE organizer_sessions SET expires_at = 0 WHERE token_hash = '${hash}'`], { env: environment, encoding: 'utf8' });
  assert.equal(expired.status, 0, expired.stdout + expired.stderr);
  assert.equal((await api('/events', { secret: login.data.token })).status, 401);
  assert.equal((await api(`/events/${event.id}/admin`, { secret: login.data.token })).status, 401);
  assert.equal((await api(`/events/${event.id}`)).status, 200);
});

test('parallel bad-password attempts respect the login rate limit', async () => {
  const headers = { 'CF-Connecting-IP': '192.0.2.40' };
  const attempts = await Promise.all(Array.from({ length: 12 }, () => api('/organizer/login', {
    method: 'POST', headers, data: { username: 'organizer', password: 'incorrect' }
  })));
  assert.equal(attempts.filter(value => value.status === 403).length, 10);
  assert.equal(attempts.filter(value => value.status === 429).length, 2);
  const limited = attempts.find(value => value.status === 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
});

test('the event dashboard is organizer-only and reports saved responses without exposing credentials', async () => {
  const event = await create(), guest = await save(event);
  assert.equal((await api('/events')).status, 401);
  assert.equal((await api('/events', { secret: token() })).status, 401);
  assert.equal((await api('/events', { secret: guest.secret })).status, 401);
  const opened = await api(`/events/${event.id}/participants/access`, { method: 'POST', data: { name: 'Unsubmitted guest' } });
  assert.equal(opened.status, 200);
  const list = await api('/events', { secret: creator });
  assert.equal(list.status, 200);
  const row = list.data.events.find(value => value.id === event.id);
  assert.equal(row.title, 'Committee meeting');
  assert.equal(row.slotCount, 2);
  assert.equal(row.responseCount, 1);
  assert.equal(row.firstSlot, event.state.slots[0].startUtc);
  for (const secret of [creator, guest.secret, 'password_hash']) assert.ok(!JSON.stringify(list.data).includes(secret));
});

test('the owning profile can edit an existing event without a private admin link', async () => {
  const event = await create(); await save(event);
  assert.equal((await api(`/events/${event.id}/admin`, { secret: creator })).status, 200);
  const edited = await api(`/events/${event.id}`, { method: 'PATCH', secret: creator,
    data: { title: 'Managed from dashboard', description: '', slots: [slot(15), slot(17)], slotRevision: 1 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.availability.length, 1);
  assert.equal(edited.data.availability[0].available, true);
  assert.equal((await api(`/events/${event.id}/admin`, { secret: creator })).status, 200);
  const row = (await api('/events', { secret: creator })).data.events.find(value => value.id === event.id);
  assert.equal(row.title, 'Managed from dashboard'); assert.equal(row.responseCount, 1);
});

test('open signup creates a private profile and keeps event listing and editing isolated', async () => {
  const original = await create();
  const signup = await api('/organizer/register', { method: 'POST', data: { username: 'new-profile', password: 'new-profile-password' } });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const otherToken = signup.data.token;
  assert.deepEqual((await api('/events', { secret: otherToken })).data.events, []);
  const other = await create([slot(18)], otherToken);
  const originalList = (await api('/events', { secret: creator })).data.events;
  const otherList = (await api('/events', { secret: otherToken })).data.events;
  assert.ok(originalList.some(value => value.id === original.id));
  assert.ok(!originalList.some(value => value.id === other.id));
  assert.deepEqual(otherList.map(value => value.id), [other.id]);
  for (const [event, secret] of [[original, otherToken], [other, creator]]) {
    assert.equal((await api(`/events/${event.id}/admin`, { secret })).status, 403);
    assert.equal((await api(`/events/${event.id}`, { method: 'PATCH', secret, data: {} })).status, 403);
  }
  const takeover = await api('/events', { method: 'POST', secret: otherToken, data: { id: original.id } });
  assert.equal(takeover.status, 403);
  assert.equal((await api(`/events/${original.id}`)).status, 200);
  const login = await api('/organizer/login', { method: 'POST', data: { username: 'NEW-PROFILE', password: 'new-profile-password' } });
  assert.equal(login.status, 200);
  assert.deepEqual((await api('/events', { secret: login.data.token })).data.events.map(value => value.id), [other.id]);
});

test('only the owning organizer can delete an event', async () => {
  const event = await create(), guest = await save(event);
  const other = await api('/organizer/register', { method: 'POST', data: { username: 'delete-other-profile', password: 'delete-other-password' } });
  assert.equal(other.status, 201);
  for (const [secret, status] of [[undefined, 401], [token(), 401], [guest.secret, 401], [other.data.token, 403]]) {
    const denied = await api(`/events/${event.state.event.shareCode}`, { method: 'DELETE', secret });
    assert.equal(denied.status, status);
  }
  const deniedOrigin = await api(`/events/${event.id}`, { method: 'DELETE', secret: creator, headers: { Origin: 'https://unrelated.example' } });
  assert.equal(deniedOrigin.status, 403);
  assert.deepEqual((await api(`/events/${event.id}`)).data, guest.response.data);
  const preflight = await api(`/events/${event.id}`, { method: 'OPTIONS', headers: { Origin: 'https://liguiye.github.io' } });
  assert.equal(preflight.status, 204);
  assert.ok(preflight.headers.get('Access-Control-Allow-Methods').split(', ').includes('DELETE'));
});

test('deleting an event removes its children and invitation links while preserving other events', async () => {
  const kept = await create(), keptGuest = await save(kept);
  for (const reference of ['id', 'shareCode']) {
    const event = await create(), guest = await save(event);
    const otherGuest = await save(event, { name: 'Another guest' });
    const deleted = await api(`/events/${event.state.event[reference]}`, { method: 'DELETE', secret: creator });
    assert.equal(deleted.status, 204);
    assert.equal((await api(`/events/${event.id}`)).status, 404);
    assert.equal((await api(`/events/${event.state.event.shareCode}`)).status, 404);
    assert.equal((await api(`/events/${event.id}/participants/${guest.id}`, { secret: guest.secret })).status, 403);
    const list = (await api('/events', { secret: creator })).data.events;
    assert.ok(!list.some(row => row.id === event.id));
    assert.ok(list.some(row => row.id === kept.id));
    const people = `'${guest.id}', '${otherGuest.id}'`;
    const query = `SELECT
      (SELECT COUNT(*) FROM slots WHERE event_id = '${event.id}') AS slots,
      (SELECT COUNT(*) FROM participants WHERE event_id = '${event.id}') AS participants,
      (SELECT COUNT(*) FROM availability WHERE participant_id IN (${people})) AS answers,
      (SELECT COUNT(*) FROM participant_sessions WHERE participant_id IN (${people})) AS sessions`;
    const counts = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'guiye-scheduler', '--local',
      '--config', 'scheduler/wrangler.jsonc', '--persist-to', directory, '--command', query, '--json'], { env: environment, encoding: 'utf8' });
    assert.equal(counts.status, 0, counts.stdout + counts.stderr);
    assert.deepEqual(JSON.parse(counts.stdout)[0].results[0], { slots: 0, participants: 0, answers: 0, sessions: 0 });
  }
  assert.deepEqual((await api(`/events/${kept.id}`)).data, keptGuest.response.data);
});

test('signup validates passwords and prevents duplicate or bootstrap-profile takeover', async () => {
  assert.equal((await api('/organizer/register', { method: 'POST', data: { username: 'short-password', password: 'short' } })).status, 400);
  assert.equal((await api('/organizer/register', { method: 'POST', data: { username: ' ORGANIZER ', password: 'different-password' } })).status, 409);
  const attempts = await Promise.all([api('/organizer/register', { method: 'POST', data: { username: 'Same profile', password: 'same-profile-password' } }),
    api('/organizer/register', { method: 'POST', data: { username: ' SAME PROFILE ', password: 'other-profile-password' } })]);
  assert.deepEqual(attempts.map(value => value.status).sort(), [201, 409]);
  const registered = attempts.find(value => value.status === 201);
  assert.ok(!JSON.stringify(registered.data).includes('password_hash'));
  assert.ok(!JSON.stringify(registered.data).includes('same-profile-password'));
});

test('successful login cannot reset the separate public signup limit', async () => {
  const headers = { 'CF-Connecting-IP': '192.0.2.50' };
  for (let i = 0; i < 10; i++) {
    const response = await api('/organizer/register', { method: 'POST', headers, data: { username: `limited-profile-${i}`, password: 'limited-profile-password' } });
    assert.equal(response.status, 201);
  }
  const login = await api('/organizer/login', { method: 'POST', headers, data: { username: 'limited-profile-0', password: 'limited-profile-password' } });
  assert.equal(login.status, 200);
  assert.equal((await api('/organizer/register', { method: 'POST', headers, data: { username: 'limited-profile-extra', password: 'limited-profile-password' } })).status, 429);
});

test('a name with no password reopens the same response, without an editing link', async () => {
  const event = await create(), guest = await save(event, { name: 'Alex' });
  const reopened = await api(`/events/${event.id}/participants/access`, { method: 'POST', data: { name: '  ALEX  ', password: '' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.participant.id, guest.id);
  assert.equal(reopened.data.participant.name, 'Alex');
  assert.equal(reopened.data.snapshot.participants.length, 1);
  assert.equal(reopened.data.participant.passwordProtected, false);
  const edited = await save(event, { id: guest.id, secret: reopened.data.token, revision: 1, available: [], unavailable: event.state.slots.map(slot => slot.id) });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.response.data.availability.length, 2);
  assert.ok(edited.response.data.availability.every(answer => !answer.available));
});

test('optional passwords protect an existing name and permit independent browser sessions', async () => {
  const event = await create(), guest = await save(event, { name: 'Protected guest', password: 'local-test-password' });
  for (const password of ['', 'incorrect']) {
    const denied = await api(`/events/${event.id}/participants/access`, { method: 'POST', data: { name: 'Protected guest', password } });
    assert.equal(denied.status, 403);
  }
  const reopened = await api(`/events/${event.id}/participants/access`, { method: 'POST', data: { name: 'Protected guest', password: 'local-test-password' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.participant.id, guest.id);
  assert.equal(reopened.data.participant.passwordProtected, true);
  assert.notEqual(reopened.data.token, guest.secret);
  assert.equal((await api(`/events/${event.id}/participants/${guest.id}`, { secret: guest.secret })).status, 200);
  const publicData = JSON.stringify((await api(`/events/${event.id}`)).data);
  for (const secret of ['local-test-password', reopened.data.token, 'password_hash', 'password_salt']) assert.ok(!publicData.includes(secret));
});

test('opening a new name is not counted as a response until availability is saved', async () => {
  const event = await create();
  const access = await api(`/events/${event.id}/participants/access`, { method: 'POST', data: { name: 'New guest' } });
  assert.equal(access.status, 200);
  assert.equal(access.data.snapshot.participants.length, 0);
  const saved = await save(event, { id: access.data.participant.id, secret: access.data.token, revision: 0 });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.response.data.participants.length, 1);
});

test('the local proxy returns readable JSON and strips Jekyll front matter', async () => {
  const response = await fetch('http://127.0.0.1:8798/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.deepEqual(await response.json(), { ok: true });
  const page = await fetch('http://127.0.0.1:8798/meet/');
  const html = await page.text();
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!html.includes('layout: null'));
});

test('an unavailable backend returns a recoverable local proxy error', async () => {
  const offline = await startServer({ port: 0, workerPort: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${offline.address().port}/api/health`);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), 'The local backend is unavailable.');
    assert.equal((await fetch(`http://127.0.0.1:${offline.address().port}/meet/`)).status, 200);
  } finally { await new Promise(resolve => offline.close(resolve)); }
});

test('retrying a creation after a lost reply returns the original event', async () => {
  const event = await create();
  const retry = await api('/events', { method: 'POST', secret: creator, data: { id: event.id } });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.event.id, event.id);
  assert.equal(retry.data.event.shareCode, event.state.event.shareCode);
  assert.deepEqual(retry.data.slots, event.state.slots);
});

test('short event codes resolve the same event and remain stable after edits', async () => {
  const event = await create(), other = await create();
  const code = event.state.event.shareCode;
  assert.match(code, /^[A-Za-z0-9_-]{12}$/);
  assert.notEqual(code, other.state.event.shareCode);
  const guest = await save(event, { available: [event.state.slots[0].id] });
  const short = await api(`/events/${code}`);
  assert.equal(short.status, 200);
  assert.deepEqual(short.data, (await api(`/events/${event.id}`)).data);
  assert.equal((await api(`/events/${code}/admin`)).status, 401);
  assert.equal((await api(`/events/${code}/admin`, { secret: creator })).status, 200);
  assert.equal((await api(`/events/${code}/participants/${guest.id}`, { secret: guest.secret })).status, 200);
  assert.equal((await api(`/events/${code}`, { headers: { 'If-None-Match': `"${short.data.event.revision}"` } })).status, 304);
  const edited = await edit(event, [slot(15), slot(16)]);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.event.shareCode, code);
  assert.equal((await api(`/events/${code}`)).data.event.id, event.id);
  assert.equal((await api('/events', { secret: creator })).data.events.find(row => row.id === event.id).shareCode, code);
  assert.equal((await api('/events/invalid')).status, 400);
  assert.equal((await api('/events/____________')).status, 404);
});

test('editing preserves unchanged answers, removes deleted answers, and leaves added slots unanswered', async () => {
  const event = await create(), beforeSlots = event.state.slots;
  const guest = await save(event, { available: [beforeSlots[0].id], unavailable: [beforeSlots[1].id] }); assert.equal(guest.response.status, 200);
  const changed = await edit(event, [slot(15), slot(15, 30)]); assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.slots[0].id, beforeSlots[0].id);
  assert.deepEqual(changed.data.availability, [{ participantId: guest.id, slotId: beforeSlots[0].id, available: true }]);
  const stale = await save(event, { id: guest.id, secret: guest.secret, revision: 1 }); assert.equal(stale.response.status, 409);
  event.state = changed.data;
  const readded = await edit(event, [slot(15), slot(15, 15), slot(15, 30)]); assert.equal(readded.status, 200);
  const restored = readded.data.slots.find(value => value.startUtc === beforeSlots[1].startUtc);
  assert.notEqual(restored.id, beforeSlots[1].id);
  assert.ok(!readded.data.availability.some(answer => answer.slotId === restored.id));
  assert.equal((await edit({ ...event, state: readded.data }, [slot(15)], { timezone: 'UTC' })).status, 400);
});

test('simultaneous participants both persist; simultaneous edits to one response do not overwrite silently', async () => {
  const event = await create();
  const [a, b] = await Promise.all([save(event, { name: 'Alice' }), save(event, { name: 'Bob' })]);
  assert.equal(a.response.status, 200); assert.equal(b.response.status, 200);
  let current = (await api(`/events/${event.id}`)).data;
  assert.equal(current.participants.length, 2); assert.equal(current.availability.length, 4);
  const [first, second] = await Promise.all([
    save(event, { id: a.id, secret: a.secret, revision: 1, available: [] }),
    save(event, { id: a.id, secret: a.secret, revision: 1, available: [event.state.slots[0].id] })
  ]);
  assert.deepEqual([first.response.status, second.response.status].sort(), [200, 409]);
  current = (await api(`/events/${event.id}`)).data;
  assert.equal(current.participants.find(person => person.id === a.id).revision, 2);
  assert.equal(current.availability.filter(answer => answer.participantId === b.id && answer.available).length, 2);
});

test('a stale organizer batch cannot delete slots or responses after a concurrent edit', async () => {
  const event = await create(); await save(event);
  const [a, b] = await Promise.all([edit(event, [slot(15), slot(16)]), edit(event, [slot(15, 15), slot(17)])]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const winner = a.status === 200 ? a.data : b.data;
  const current = (await api(`/events/${event.id}`)).data;
  assert.deepEqual(current.slots, winner.slots);
  assert.deepEqual(current.availability, winner.availability);
  assert.equal(current.availability.length, 1);
});

test('duplicate response retries are idempotent; unchanged polls return 304', async () => {
  const event = await create(), guest = await save(event);
  const again = await api(`/events/${event.id}/participants/${guest.id}`, { method: 'PUT', secret: guest.secret, data: guest.data });
  assert.equal(again.status, 200);
  assert.equal(again.data.event.revision, guest.response.data.event.revision);
  assert.equal(again.data.participants[0].revision, 1);
  const unchanged = await api(`/events/${event.id}`, { headers: { 'If-None-Match': `"${again.data.event.revision}"` } });
  assert.equal(unchanged.status, 304);
});

test('invalid slots, wrong event credentials, and disallowed origins are rejected', async () => {
  const a = await create(), b = await create();
  assert.equal((await api(`/events/${b.id}`, { method: 'PATCH', secret: token(), data: {} })).status, 401);
  const invalid = await save(a, { available: [randomUUID()] }); assert.equal(invalid.response.status, 400);
  assert.equal((await edit(a, [slot(15), slot(15)])).status, 400);
  const denied = await api(`/events/${a.id}`, { headers: { Origin: 'https://unrelated.example' } }); assert.equal(denied.status, 403);
  const preflight = await api(`/events/${a.id}`, { method: 'OPTIONS', headers: { Origin: 'https://liguiye.github.io' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://liguiye.github.io');
});

test('saving preserves unanswered cells and explicitly clears old answers', async () => {
  const event = await create([slot(15), slot(15, 15), slot(15, 30)]);
  const [a, b, c] = event.state.slots.map(slot => slot.id);
  const guest = await save(event, { available: [a], unavailable: [b] });
  assert.equal(guest.response.status, 200);
  let current = (await api(`/events/${event.id}`)).data;
  assert.deepEqual(new Map(current.availability.map(answer => [answer.slotId, answer.available])), new Map([[a, true], [b, false]]));
  assert.ok(!current.availability.some(answer => answer.slotId === c));
  const cleared = await save(event, { id: guest.id, secret: guest.secret, revision: 1, available: [], unavailable: [b] });
  assert.equal(cleared.response.status, 200);
  assert.deepEqual(cleared.response.data.availability, [{ participantId: guest.id, slotId: b, available: false }]);
  const allCleared = await save(event, { id: guest.id, secret: guest.secret, revision: 2, available: [], unavailable: [] });
  assert.equal(allCleared.response.status, 200);
  assert.deepEqual(allCleared.response.data.availability, []);
  assert.equal(allCleared.response.data.participants[0].revision, 3);
});

test('conflicting or foreign explicit answers are rejected without changing saved responses', async () => {
  const event = await create(), guest = await save(event);
  const a = event.state.slots[0].id;
  for (const options of [{ available: [a], unavailable: [a] }, { available: [], unavailable: [randomUUID()] },
    { available: [], unavailable: [a, a] }]) {
    assert.equal((await save(event, { id: guest.id, secret: guest.secret, revision: 1, ...options })).response.status, 400);
  }
  const oldClient = { ...guest.data, revision: 1, requestId: randomUUID() }; delete oldClient.unavailableSlotIds;
  assert.equal((await api(`/events/${event.id}/participants/${guest.id}`, { method: 'PUT', secret: guest.secret, data: oldClient })).status, 400);
  assert.deepEqual((await api(`/events/${event.id}`)).data.availability, guest.response.data.availability);
});

test('event intervals are stored and resized cells get new identities and unanswered responses', async () => {
  for (const minutes of [15, 30, 60]) {
    const event = await create([slot(15, 0, minutes), slot(16, 0, minutes)], creator, minutes);
    assert.equal((await api(`/events/${event.id}`)).data.event.slotMinutes, minutes);
    assert.equal((await api('/events', { secret: creator })).data.events.find(value => value.id === event.id).slotMinutes, minutes);
    const guest = await save(event, { available: [event.state.slots[0].id], unavailable: [event.state.slots[1].id] });
    const edited = await edit(event, [slot(15, 0, minutes), slot(17, 0, minutes)]);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.event.slotMinutes, minutes);
    assert.equal(edited.data.slots[0].id, event.state.slots[0].id);
    assert.equal(edited.data.availability.length, 1);
    event.state = edited.data;
    const nextMinutes = minutes === 60 ? 15 : 60;
    const resized = await edit(event, [slot(15, 0, nextMinutes), slot(17, 0, nextMinutes)], { slotMinutes: nextMinutes });
    assert.equal(resized.status, 200, JSON.stringify(resized.data));
    assert.equal(resized.data.event.slotMinutes, nextMinutes);
    assert.notEqual(resized.data.slots[0].id, event.state.slots[0].id);
    assert.deepEqual(resized.data.availability, []);
    const stale = await save(event, { id: guest.id, secret: guest.secret, revision: 1 });
    assert.equal(stale.response.status, 409);
  }
});

test('invalid event intervals, mismatched durations, and overlapping cells are rejected', async () => {
  const event = await create();
  for (const slotMinutes of [10, 45, '30']) assert.equal((await edit(event, [slot(15)], { slotMinutes })).status, 400);
  assert.equal((await edit(event, [slot(15)], { slotMinutes: 30 })).status, 400);
  assert.equal((await edit(event, [slot(15, 0, 30), slot(15, 15, 30)], { slotMinutes: 30 })).status, 400);
  assert.deepEqual((await api(`/events/${event.id}`)).data.slots, event.state.slots);
});

test('changing organizer credentials invalidates old sessions without removing events', async () => {
  const event = await create(), oldSession = creator;
  const replacement = makeOrganizerConfig('replacement-organizer', 'replacement-test-password');
  await stopWorker(); await startWorker(replacement);
  assert.equal((await api('/events', { secret: oldSession })).status, 401);
  assert.equal((await api('/organizer/login', { method: 'POST', data: { username: 'organizer', password: organizerPassword } })).status, 403);
  const login = await api('/organizer/login', { method: 'POST', data: { username: 'replacement-organizer', password: 'replacement-test-password' } });
  assert.equal(login.status, 200);
  const events = await api('/events', { secret: login.data.token });
  assert.equal(events.status, 200);
  assert.ok(events.data.events.some(value => value.id === event.id));
  assert.equal((await api(`/events/${event.id}`)).status, 200);
});

test('public signup works without preconfigured organizer credentials', async () => {
  await stopWorker();
  await startWorker({ ORGANIZER_USERNAME: '', ORGANIZER_PASSWORD_SALT: '', ORGANIZER_PASSWORD_HASH: '' });
  const response = await api('/organizer/register', { method: 'POST', data: { username: 'unconfigured-signup', password: 'unconfigured-signup-password' } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  const event = await create([slot(20)], response.data.token);
  assert.equal((await api('/events', { secret: response.data.token })).data.events[0].id, event.id);
});
