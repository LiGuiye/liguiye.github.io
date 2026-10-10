import { spawn } from 'node:child_process';
import { startServer } from './server.mjs';
import { ensureLocalOrganizer } from './organizer-config.mjs';

const config = 'scheduler/wrangler.jsonc';
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
async function run(args) {
  const child = spawn(process.execPath, [wrangler, ...args], { stdio: 'inherit' });
  await new Promise((resolve, reject) => child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Wrangler exited with ${code}`))));
}
const login = await ensureLocalOrganizer();
await run(['d1', 'migrations', 'apply', 'guiye-scheduler', '--local', '--config', config]);
const worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', config, '--port', '8787', '--var', 'ENVIRONMENT:development'], { stdio: 'inherit' });
const server = await startServer();
console.log(`\nLocal scheduler: http://127.0.0.1:8788/meet/\nOrganizer username: ${login.username}\nOrganizer password: ${login.password || '(the password you set with npm run organizer:setup)'}\nChange credentials: npm run organizer:setup\n`);
function stop() { worker.kill('SIGTERM'); server.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
worker.on('exit', () => server.close());
