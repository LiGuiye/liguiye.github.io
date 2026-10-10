import { createInterface } from 'node:readline/promises';
import { writeFile, unlink } from 'node:fs/promises';
import { makeOrganizerConfig, saveLocalOrganizer } from './organizer-config.mjs';

function passwordPrompt(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal to enter a password.');
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    function finish() {
      process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
    }
    function onData(chunk) {
      for (const character of chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')) {
        if (character === '\r' || character === '\n') { finish(); resolve(value); return; }
        if (character === '\x03') { finish(); reject(new Error('Setup cancelled.')); return; }
        if (character === '\x7f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character === '\x15') value = '';
        else if (character >= ' ') value += character;
      }
    }
    process.stdin.setEncoding('utf8'); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
  });
}

try {
  const production = process.argv.includes('--production');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await prompt.question('Organizer username [guiye]: ')).trim() || 'guiye';
  prompt.close();
  const password = await passwordPrompt('Password (8–128 characters, hidden): ');
  if (password !== await passwordPrompt('Confirm password (hidden): ')) throw new Error('Passwords do not match. Run setup again.');
  const config = makeOrganizerConfig(username, password);
  if (production) {
    await writeFile('scheduler/.organizer-secrets.json', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    console.log('Saved hashed production credentials to scheduler/.organizer-secrets.json. No plaintext password was saved.');
  } else {
    await saveLocalOrganizer(config);
    try { await unlink('scheduler/.dev.login.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log('Saved your local organizer credentials. Restart npm run dev to use them. No plaintext password was saved.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
