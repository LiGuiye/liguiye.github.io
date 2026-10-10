import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export function makeOrganizerConfig(username, password) {
  username = username.trim();
  if (!username || username.length > 80 || /[\r\n\0]/.test(username)) throw new Error('Choose a username of 1–80 characters.');
  if (password.length < 8 || password.length > 128) throw new Error('Choose a password of 8–128 characters.');
  const salt = randomBytes(32).toString('base64url');
  return {
    ORGANIZER_USERNAME: username,
    ORGANIZER_PASSWORD_SALT: salt,
    ORGANIZER_PASSWORD_HASH: pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex')
  };
}

async function localVariables() {
  try { return await readFile('scheduler/.dev.vars', 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

export async function saveLocalOrganizer(config) {
  const previous = await localVariables();
  const retained = previous.split('\n').filter(line => !/^(CREATOR_TOKEN|ORGANIZER_USERNAME|ORGANIZER_PASSWORD_SALT|ORGANIZER_PASSWORD_HASH)=/.test(line));
  const variables = Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
  await writeFile('scheduler/.dev.vars', `${retained.join('\n').trimEnd()}\n${variables}\n`, { mode: 0o600 });
}

export async function ensureLocalOrganizer() {
  const variables = await localVariables(), config = {};
  for (const line of variables.split('\n')) {
    const match = line.match(/^(ORGANIZER_[A-Z_]+)=(.*)$/);
    if (match) config[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
  }
  if (config.ORGANIZER_USERNAME && config.ORGANIZER_PASSWORD_SALT && config.ORGANIZER_PASSWORD_HASH) {
    let password;
    try {
      const login = JSON.parse(await readFile('scheduler/.dev.login.json', 'utf8'));
      const hash = pbkdf2Sync(login.password, config.ORGANIZER_PASSWORD_SALT, 100_000, 32, 'sha256').toString('hex');
      if (login.username === config.ORGANIZER_USERNAME && hash === config.ORGANIZER_PASSWORD_HASH) password = login.password;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { username: config.ORGANIZER_USERNAME, password };
  }
  const username = config.ORGANIZER_USERNAME || 'guiye', password = `local-${randomBytes(9).toString('base64url')}`;
  await saveLocalOrganizer(makeOrganizerConfig(username, password));
  await writeFile('scheduler/.dev.login.json', JSON.stringify({ username, password }) + '\n', { mode: 0o600 });
  return { username, password };
}
