interface Env {
  DB: D1Database;
  ORGANIZER_USERNAME?: string;
  ORGANIZER_PASSWORD_SALT?: string;
  ORGANIZER_PASSWORD_HASH?: string;
  ALLOWED_ORIGIN: string;
  ENVIRONMENT?: string;
}

interface EventRow {
  id: string;
  shareCode: string;
  title: string;
  description: string;
  timezone: string;
  slotMinutes: number;
  slotRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
interface Slot { id: string; startUtc: string; endUtc: string }
interface Participant { id: string; name: string; revision: number; passwordProtected: boolean }
interface LoginParticipant {
  id: string; name: string; revision: number;
  password_salt: string | null; password_hash: string | null;
}
interface Answer { participantId: string; slotId: string; available: number }
interface Snapshot {
  event: EventRow;
  slots: Slot[];
  participants: Participant[];
  availability: (Omit<Answer, 'available'> & { available: boolean })[];
}
interface Candidate { startUtc: string; endUtc: string }
interface OrganizerProfile {
  id: string; username: string; username_key: string; password_salt: string; password_hash: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHARE_CODE = /^[A-Za-z0-9_-]{12}$/;
const EVENT_COLUMNS = `id, share_code AS shareCode, title, description, timezone, slot_minutes AS slotMinutes, slot_revision AS slotRevision,
  revision, created_at AS createdAt, updated_at AS updatedAt`;

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new HttpError(400, `Please provide a valid ${label}.`);
  }
  return value.trim();
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, 'Invalid identifier.');
  return value;
}
async function eventIdentifier(env: Env, value: string): Promise<string> {
  if (UUID.test(value)) return value;
  if (!SHARE_CODE.test(value)) throw new HttpError(400, 'Invalid event link.');
  const event = await env.DB.prepare('SELECT id FROM events WHERE share_code = ?').bind(value).first<{ id: string }>();
  if (!event) throw new HttpError(404, 'This event was not found. Check your event link.');
  return event.id;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpError(400, 'Invalid revision.');
  return value as number;
}
function bearer(request: Request, status = 403): string {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!TOKEN.test(token)) throw new HttpError(status, 'Editing access is missing or invalid.');
  return token;
}
async function digest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000,
    salt: new TextEncoder().encode(salt) }, key, 256);
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length')) > 500_000) throw new HttpError(413, 'The request is too large.');
  let raw: string;
  try { raw = await request.text(); } catch { throw new HttpError(400, 'Cannot read this request.'); }
  if (raw.length > 500_000) throw new HttpError(413, 'The request is too large.');
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}
function interval(value: unknown): number {
  if (![15, 30, 60].includes(value as number)) throw new HttpError(400, 'Choose 15, 30, or 60 minutes per cell.');
  return value as number;
}
function candidates(value: unknown, timezone: string, slotMinutes: number): Candidate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3000) {
    throw new HttpError(400, 'Choose between 1 and 3,000 candidate time slots.');
  }
  let dates: Intl.DateTimeFormat;
  try { dates = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { throw new HttpError(400, 'Choose a valid timezone.'); }
  const seen = new Set<string>();
  const days = new Set<string>();
  const result = value.map(item => {
    if (!item || typeof item.startUtc !== 'string' || typeof item.endUtc !== 'string') {
      throw new HttpError(400, 'Invalid candidate time.');
    }
    const start = Date.parse(item.startUtc), end = Date.parse(item.endUtc);
    if (!Number.isFinite(start) || end - start !== slotMinutes * 60_000 || start % 900_000 !== 0) {
      throw new HttpError(400, `Time slots must be ${slotMinutes} minutes long and start on a quarter hour.`);
    }
    const startUtc = new Date(start).toISOString(), endUtc = new Date(end).toISOString();
    if (seen.has(startUtc)) throw new HttpError(400, 'Duplicate candidate time.');
    seen.add(startUtc);
    days.add(dates.format(new Date(start)));
    return { startUtc, endUtc };
  });
  if (days.size > 31) throw new HttpError(400, 'Choose at most 31 candidate dates.');
  result.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  if (result.some((slot, index) => index > 0 && slot.startUtc < result[index - 1].endUtc)) {
    throw new HttpError(400, 'Candidate time slots must not overlap.');
  }
  return result;
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
function changed(): never {
  throw new HttpError(409, 'This event or response changed while you were editing. Refresh and review your selections before saving again.');
}

async function snapshot(env: Env, id: string): Promise<Snapshot> {
  const rows = await env.DB.batch([
    env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(id),
    env.DB.prepare('SELECT id, start_utc AS startUtc, end_utc AS endUtc FROM slots WHERE event_id = ? ORDER BY start_utc').bind(id),
    env.DB.prepare(`SELECT id, name, revision, password_hash IS NOT NULL AS passwordProtected
      FROM participants WHERE event_id = ? AND revision > 0 ORDER BY created_at, id`).bind(id),
    env.DB.prepare(`SELECT a.participant_id AS participantId, a.slot_id AS slotId, a.available
      FROM availability a JOIN slots s ON s.id = a.slot_id WHERE s.event_id = ?`).bind(id)
  ]);
  const event = rows[0].results[0] as unknown as EventRow | undefined;
  if (!event) throw new HttpError(404, 'This event was not found. Check your event link.');
  return {
    event,
    slots: rows[1].results as unknown as Slot[],
    participants: (rows[2].results as unknown as Participant[]).map(person => ({ ...person, passwordProtected: !!person.passwordProtected })),
    availability: (rows[3].results as unknown as Answer[]).map(answer => ({ ...answer, available: !!answer.available }))
  };
}
function result(state: Snapshot, status = 200): Response {
  const response = json(state, status);
  response.headers.set('ETag', `"${state.event.revision}"`);
  return response;
}
async function checkAdmin(env: Env, id: string, request: Request): Promise<OrganizerProfile> {
  const profile = await checkOrganizer(env, request);
  const owner = await env.DB.prepare('SELECT owner_id FROM events WHERE id = ?').bind(id).first<{ owner_id: string }>();
  if (!owner) throw new HttpError(404, 'This event was not found.');
  if (owner.owner_id !== profile.id) throw new HttpError(403, 'Only the profile that created this event can manage it.');
  return profile;
}

async function bootstrapOrganizer(env: Env): Promise<void> {
  if (!env.ORGANIZER_USERNAME && !env.ORGANIZER_PASSWORD_SALT && !env.ORGANIZER_PASSWORD_HASH) return;
  if (!env.ORGANIZER_USERNAME || !env.ORGANIZER_PASSWORD_SALT || !env.ORGANIZER_PASSWORD_HASH) throw new HttpError(503, 'The original organizer profile has not been configured completely.');
  const id = '00000000-0000-4000-8000-000000000001';
  const username = env.ORGANIZER_USERNAME.trim(), key = username.normalize('NFKC').toLowerCase();
  // A stable bootstrap profile preserves ownership of pre-signup events and
  // lets the existing setup command update that profile's credentials.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO organizer_profiles (id, username, username_key, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username,
      username_key = excluded.username_key, password_salt = excluded.password_salt, password_hash = excluded.password_hash
      WHERE organizer_profiles.username != excluded.username OR organizer_profiles.password_salt != excluded.password_salt
        OR organizer_profiles.password_hash != excluded.password_hash`)
      .bind(id, username, key, env.ORGANIZER_PASSWORD_SALT, env.ORGANIZER_PASSWORD_HASH, new Date().toISOString()),
    env.DB.prepare('UPDATE events SET owner_id = ? WHERE owner_id IS NULL').bind(id)
  ]);
}
async function credentialHash(profile: OrganizerProfile): Promise<string> {
  return digest(JSON.stringify([profile.username_key, profile.password_salt, profile.password_hash]));
}
async function checkOrganizer(env: Env, request: Request): Promise<OrganizerProfile> {
  await bootstrapOrganizer(env);
  const tokenHash = await digest(bearer(request, 401));
  const profile = await env.DB.prepare(`SELECT p.id, p.username, p.username_key, p.password_salt, p.password_hash,
    s.credential_hash AS credentialHash FROM organizer_sessions s JOIN organizer_profiles p ON p.id = s.organizer_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(tokenHash, Date.now())
    .first<OrganizerProfile & { credentialHash: string }>();
  if (!profile || profile.credentialHash !== await credentialHash(profile)) throw new HttpError(401, 'Please sign in to your organizer account.');
  return profile;
}
async function reserveAccountAttempt(env: Env, request: Request, kind = 'login'): Promise<string> {
  const now = Date.now(), cutoff = now - 15 * 60_000;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  // Reserve an attempt atomically before password verification so parallel
  // requests cannot all pass the attempt limit at once.
  const attempts = await env.DB.batch([
    env.DB.prepare('DELETE FROM organizer_login_attempts WHERE attempted_at <= ?').bind(cutoff),
    env.DB.prepare(`INSERT INTO organizer_login_attempts (ip, attempted_at, kind)
      SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM organizer_login_attempts WHERE ip = ? AND kind = ? AND attempted_at > ?) < 10`)
      .bind(ip, now, kind, ip, kind, cutoff)
  ]);
  if (!attempts[1].meta.changes) {
    const oldest = await env.DB.prepare('SELECT MIN(attempted_at) AS time FROM organizer_login_attempts WHERE ip = ? AND kind = ?').bind(ip, kind).first<{ time: number }>();
    throw new HttpError(429, 'Too many account requests. Wait a few minutes and try again.', Math.max(1, Math.ceil(((oldest?.time ?? now) + 15 * 60_000 - now) / 1000)));
  }
  return ip;
}
async function profileSession(env: Env, profile: OrganizerProfile, status = 200): Promise<Response> {
  const now = Date.now();
  const token = randomToken(), expiresAt = now + 7 * 24 * 60 * 60_000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM organizer_sessions WHERE expires_at <= ? OR organizer_id IS NULL').bind(now),
    env.DB.prepare('INSERT INTO organizer_sessions (token_hash, credential_hash, expires_at, organizer_id) VALUES (?, ?, ?, ?)')
      .bind(await digest(token), await credentialHash(profile), expiresAt, profile.id)
  ]);
  return json({ token, username: profile.username, expiresAt }, status);
}
async function registerOrganizer(env: Env, request: Request): Promise<Response> {
  await bootstrapOrganizer(env);
  const input = await body(request), username = text(input.username, 'username', 80);
  const password = input.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new HttpError(400, 'Choose a password of 8–128 characters.');
  await reserveAccountAttempt(env, request, 'register');
  const profile: OrganizerProfile = { id: crypto.randomUUID(), username, username_key: username.normalize('NFKC').toLowerCase(),
    password_salt: randomToken(), password_hash: '' };
  profile.password_hash = await passwordHash(password, profile.password_salt);
  const inserted = await env.DB.prepare(`INSERT INTO organizer_profiles (id, username, username_key, password_salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(username_key) DO NOTHING`)
    .bind(profile.id, username, profile.username_key, profile.password_salt, profile.password_hash, new Date().toISOString()).run();
  if (!inserted.meta.changes) throw new HttpError(409, 'That username is already in use. Sign in or choose another username.');
  return profileSession(env, profile, 201);
}
async function loginOrganizer(env: Env, request: Request): Promise<Response> {
  await bootstrapOrganizer(env);
  const input = await body(request), username = text(input.username, 'username', 80).normalize('NFKC').toLowerCase();
  const password = input.password;
  if (typeof password !== 'string' || !password || password.length > 128) throw new HttpError(400, 'Enter your organizer password.');
  const ip = await reserveAccountAttempt(env, request);
  const profile = await env.DB.prepare('SELECT id, username, username_key, password_salt, password_hash FROM organizer_profiles WHERE username_key = ?')
    .bind(username).first<OrganizerProfile>();
  const hash = await passwordHash(password, profile?.password_salt ?? 'unknown-profile');
  const passwordMatches = crypto.subtle.timingSafeEqual(new TextEncoder().encode(hash), new TextEncoder().encode(profile?.password_hash ?? '0'.repeat(64)));
  if (!profile || !passwordMatches) throw new HttpError(403, 'Incorrect organizer username or password.');
  await env.DB.prepare("DELETE FROM organizer_login_attempts WHERE ip = ? AND kind = 'login'").bind(ip).run();
  return profileSession(env, profile);
}
async function logoutOrganizer(env: Env, request: Request): Promise<Response> {
  await env.DB.prepare('DELETE FROM organizer_sessions WHERE token_hash = ?').bind(await digest(bearer(request))).run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

async function listEvents(env: Env, request: Request): Promise<Response> {
  const profile = await checkOrganizer(env, request);
  const events = await env.DB.prepare(`SELECT ${EVENT_COLUMNS},
    (SELECT COUNT(*) FROM slots WHERE event_id = events.id) AS slotCount,
    (SELECT MIN(start_utc) FROM slots WHERE event_id = events.id) AS firstSlot,
    (SELECT MAX(start_utc) FROM slots WHERE event_id = events.id) AS lastSlot,
    (SELECT COUNT(*) FROM participants WHERE event_id = events.id AND revision > 0) AS responseCount
    FROM events WHERE owner_id = ? ORDER BY created_at DESC, id`).bind(profile.id).all();
  return json({ events: events.results });
}

async function createEvent(env: Env, request: Request): Promise<Response> {
  const profile = await checkOrganizer(env, request);
  const input = await body(request);
  const id = uuid(input.id);
  const existing = await env.DB.prepare('SELECT owner_id FROM events WHERE id = ?').bind(id).first<{ owner_id: string }>();
  if (existing) {
    if (existing.owner_id !== profile.id) throw new HttpError(403, 'This event belongs to another profile.');
    return result(await snapshot(env, id));
  }
  const title = text(input.title, 'event title', 160);
  const description = text(input.description ?? '', 'description', 2000, false);
  const timezone = text(input.timezone, 'timezone', 100);
  const slotMinutes = interval(input.slotMinutes ?? 15);
  const slots = candidates(input.slots, timezone, slotMinutes).map(slot => ({ ...slot, id: crypto.randomUUID() }));
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO events (id, share_code, title, description, timezone, slot_minutes, owner_id, mutation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, randomToken().slice(0, 12), title, description, timezone, slotMinutes, profile.id, crypto.randomUUID(), now, now),
    env.DB.prepare(`INSERT INTO slots (id, event_id, start_utc, end_utc)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.startUtc'), json_extract(value, '$.endUtc')
      FROM json_each(?)`).bind(id, JSON.stringify(slots))
  ]);
  return result(await snapshot(env, id), 201);
}

async function editEvent(env: Env, id: string, request: Request): Promise<Response> {
  const profile = await checkAdmin(env, id, request);
  const input = await body(request);
  const current = await snapshot(env, id);
  const expected = revision(input.slotRevision);
  const title = text(input.title, 'event title', 160);
  const description = text(input.description ?? '', 'description', 2000, false);
  if (input.timezone !== undefined && input.timezone !== current.event.timezone) {
    throw new HttpError(400, 'The event timezone is fixed after creation.');
  }
  const slotMinutes = interval(input.slotMinutes ?? current.event.slotMinutes);
  const slots = candidates(input.slots, current.event.timezone, slotMinutes).map(slot => ({ ...slot, id: crypto.randomUUID() }));
  const payload = JSON.stringify(slots), mutation = crypto.randomUUID();
  const writes = await env.DB.batch([
    env.DB.prepare(`UPDATE events SET title = ?, description = ?, slot_minutes = ?, slot_revision = slot_revision + 1,
      revision = revision + 1, mutation_id = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND slot_revision = ?`)
      .bind(title, description, slotMinutes, mutation, new Date().toISOString(), id, profile.id, expected),
    env.DB.prepare(`DELETE FROM slots WHERE event_id = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(?)
        WHERE json_extract(value, '$.startUtc') = slots.start_utc AND json_extract(value, '$.endUtc') = slots.end_utc)
      AND EXISTS (SELECT 1 FROM events WHERE id = ? AND mutation_id = ?)`)
      .bind(id, payload, id, mutation),
    env.DB.prepare(`INSERT INTO slots (id, event_id, start_utc, end_utc)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.startUtc'), json_extract(value, '$.endUtc')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND mutation_id = ?)
      ON CONFLICT(event_id, start_utc) DO NOTHING`).bind(id, payload, id, mutation)
  ]);
  if (!writes[0].meta.changes) changed();
  return result(await snapshot(env, id));
}

async function deleteEvent(env: Env, id: string, request: Request): Promise<Response> {
  const profile = await checkAdmin(env, id, request);
  const deleted = await env.DB.prepare('DELETE FROM events WHERE id = ? AND owner_id = ?').bind(id, profile.id).run();
  if (!deleted.meta.changes) throw new HttpError(404, 'This event was not found.');
  return new Response(null, { status: 204 });
}

async function accessParticipant(env: Env, id: string, request: Request): Promise<Response> {
  const input = await body(request);
  const name = text(input.name, 'name', 80), nameKey = name.normalize('NFKC').toLowerCase();
  const password = input.password ?? '';
  if (typeof password !== 'string' || password.length > 128) throw new HttpError(400, 'Use a password of at most 128 characters.');
  if (!await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(id).first()) throw new HttpError(404, 'This event was not found.');
  const findPerson = () => env.DB.prepare(`SELECT id, name, revision, password_salt, password_hash
    FROM participants WHERE event_id = ? AND name_key = ?`).bind(id, nameKey).first<LoginParticipant>();
  let person = await findPerson(), created = false;
  if (!person) {
    const participantId = crypto.randomUUID(), salt = password ? randomToken() : null;
    const hash = salt ? await passwordHash(password, salt) : null;
    const inserted = await env.DB.prepare(`INSERT INTO participants
      (id, event_id, name, name_key, password_salt, password_hash, revision, mutation_id, last_request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, '', ?) ON CONFLICT(event_id, name_key) DO NOTHING`)
      .bind(participantId, id, name, nameKey, salt, hash, crypto.randomUUID(), new Date().toISOString()).run();
    if (inserted.meta.changes) { person = { id: participantId, name, revision: 0, password_salt: salt, password_hash: hash }; created = true; }
    else person = await findPerson();
  }
  if (!person) throw new HttpError(409, 'This name changed while signing in. Please try again.');
  if (!created && person.password_hash && person.password_salt) {
    const candidate = await passwordHash(password, person.password_salt);
    if (!crypto.subtle.timingSafeEqual(new TextEncoder().encode(candidate), new TextEncoder().encode(person.password_hash))) {
      throw new HttpError(403, 'Incorrect password for this name.');
    }
  } else if (!created && !person.password_hash && password) {
    throw new HttpError(403, 'This name was created without a password. Leave the password blank.');
  }
  const token = randomToken();
  await env.DB.prepare('INSERT INTO participant_sessions (token_hash, participant_id) VALUES (?, ?)')
    .bind(await digest(token), person.id).run();
  return json({ participant: { id: person.id, name: person.name, revision: person.revision, passwordProtected: !!person.password_hash },
    token, snapshot: await snapshot(env, id) });
}

async function saveParticipant(env: Env, id: string, participantId: string, request: Request): Promise<Response> {
  const hash = await digest(bearer(request));
  const input = await body(request);
  const requestId = uuid(input.requestId);
  const expected = revision(input.revision), slotRevision = revision(input.slotRevision);
  const person = await env.DB.prepare(`SELECT revision, last_request_id FROM participants WHERE id = ? AND event_id = ?
    AND EXISTS (SELECT 1 FROM participant_sessions WHERE participant_id = ? AND token_hash = ?)`)
    .bind(participantId, id, participantId, hash).first<{ revision: number; last_request_id: string }>();
  if (!person) throw new HttpError(403, 'Enter your name and password again to edit this response.');
  if (person?.last_request_id === requestId) return result(await snapshot(env, id));
  if ((person?.revision ?? 0) !== expected) changed();
  const current = await snapshot(env, id);
  if (current.event.slotRevision !== slotRevision) changed();
  const available = input.availableSlotIds;
  const unavailable = input.unavailableSlotIds;
  const validIds = new Set(current.slots.map(slot => slot.id));
  if (!Array.isArray(available) || !Array.isArray(unavailable)) {
    throw new HttpError(400, 'Provide both available and not available time lists. Reload the page and try again.');
  }
  const answered = [...available, ...unavailable];
  if (answered.length > validIds.size || answered.some(value => typeof value !== 'string' || !validIds.has(value)) ||
      new Set(answered).size !== answered.length) {
    throw new HttpError(400, 'Availability includes an invalid time slot.');
  }
  const answers = [...available.map(id => ({ id, available: 1 })), ...unavailable.map(id => ({ id, available: 0 }))];
  const mutation = crypto.randomUUID();
  // Every statement is guarded by this request's mutation ID. A failed revision
  // comparison makes the whole batch a no-op, including deletes and inserts.
  const writes = await env.DB.batch([
    env.DB.prepare(`UPDATE events SET revision = revision + 1, mutation_id = ?
      WHERE id = ? AND slot_revision = ? AND
        EXISTS (SELECT 1 FROM participants WHERE id = ? AND event_id = ? AND revision = ?)
        AND EXISTS (SELECT 1 FROM participant_sessions WHERE participant_id = ? AND token_hash = ?)`)
      .bind(mutation, id, slotRevision, participantId, id, expected, participantId, hash),
    env.DB.prepare(`UPDATE participants SET revision = revision + 1, mutation_id = ?, last_request_id = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM events WHERE id = ? AND mutation_id = ?)`)
      .bind(mutation, requestId, participantId, id, mutation),
    env.DB.prepare(`DELETE FROM availability WHERE participant_id = ?
      AND EXISTS (SELECT 1 FROM events WHERE id = ? AND mutation_id = ?)`)
      .bind(participantId, id, mutation),
    env.DB.prepare(`INSERT INTO availability (participant_id, slot_id, available)
      SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.available')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND mutation_id = ?)`)
      .bind(participantId, JSON.stringify(answers), id, mutation)
  ]);
  if (!writes[0].meta.changes) changed();
  return result(await snapshot(env, id));
}

async function route(env: Env, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (path === '/health' && request.method === 'GET') return json({ ok: true });
  if (path === '/organizer/login' && request.method === 'POST') return loginOrganizer(env, request);
  if (path === '/organizer/register' && request.method === 'POST') return registerOrganizer(env, request);
  if (path === '/organizer/logout' && request.method === 'POST') return logoutOrganizer(env, request);
  if (path === '/events' && request.method === 'GET') return listEvents(env, request);
  if (path === '/events' && request.method === 'POST') return createEvent(env, request);
  const match = path.match(/^\/events\/([^/]+)(?:\/(admin|participants)(?:\/([^/]+))?)?$/);
  if (!match) throw new HttpError(404, 'Endpoint not found.');
  const id = await eventIdentifier(env, match[1]), kind = match[2], participantId = match[3];
  if (!kind && request.method === 'GET') {
    if (request.headers.has('If-None-Match')) {
      const current = await env.DB.prepare('SELECT revision FROM events WHERE id = ?').bind(id).first<{ revision: number }>();
      if (current && request.headers.get('If-None-Match') === `"${current.revision}"`) {
        return new Response(null, { status: 304, headers: { 'ETag': `"${current.revision}"`, 'Cache-Control': 'no-store' } });
      }
    }
    return result(await snapshot(env, id));
  }
  if (!kind && request.method === 'PATCH') return editEvent(env, id, request);
  if (!kind && request.method === 'DELETE') return deleteEvent(env, id, request);
  if (kind === 'admin' && !participantId && request.method === 'GET') {
    await checkAdmin(env, id, request);
    return result(await snapshot(env, id));
  }
  if (kind === 'participants' && participantId) {
    if (participantId === 'access' && request.method === 'POST') return accessParticipant(env, id, request);
    uuid(participantId);
    if (request.method === 'PUT') return saveParticipant(env, id, participantId, request);
    if (request.method === 'GET') {
      const hash = await digest(bearer(request));
      const person = await env.DB.prepare(`SELECT id, name, revision, password_hash IS NOT NULL AS passwordProtected
        FROM participants WHERE id = ? AND event_id = ?
        AND EXISTS (SELECT 1 FROM participant_sessions WHERE participant_id = ? AND token_hash = ?)`)
        .bind(participantId, id, participantId, hash).first<Participant>();
      if (!person) throw new HttpError(403, 'Enter your name and password again to edit this response.');
      return json({ ...person, passwordProtected: !!person.passwordProtected });
    }
  }
  throw new HttpError(405, 'Method not allowed.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const local = env.ENVIRONMENT === 'development' && !!origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const allowed = !origin || origin === env.ALLOWED_ORIGIN || local;
    let response: Response;
    try {
      if (!allowed) throw new HttpError(403, 'This origin is not allowed.');
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(env, request);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status);
        if (error.retryAfter) response.headers.set('Retry-After', String(error.retryAfter));
      }
      else {
        console.error('Scheduler database request failed.');
        response = json({ error: 'The database is unavailable. Your changes have not been confirmed; please retry.' }, 503);
      }
    }
    if (origin && allowed) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-None-Match');
      response.headers.set('Access-Control-Expose-Headers', 'ETag');
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  }
} satisfies ExportedHandler<Env>;
