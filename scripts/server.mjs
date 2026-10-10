import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

export function startServer({ root = resolve('meet'), port = 8788, workerPort = 8787 } = {}) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.md': 'text/plain' };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const upstream = await fetch(`http://127.0.0.1:${workerPort}${url.pathname.slice(4)}${url.search}`, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([key]) => !['host', 'connection', 'content-length'].includes(key))),
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
        });
        // fetch decompresses the upstream body, so do not forward its original
        // compression or length headers with the decoded bytes.
        const content = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(key))));
        res.end(content);
        return;
      }
      if (url.pathname === '/') { res.writeHead(302, { Location: '/meet/' }); res.end(); return; }
      if (!url.pathname.startsWith('/meet/')) { res.writeHead(404); res.end('Not found'); return; }
      let file = resolve(root, `.${decodeURIComponent(url.pathname.slice(5))}`);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      let content = await readFile(file);
      if (extname(file) === '.html') content = Buffer.from(content.toString().replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''));
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 502, { 'Content-Type': 'text/plain' });
      res.end(error.code === 'ENOENT' ? 'Not found' : 'The local backend is unavailable.');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
