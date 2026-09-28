import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const requested = Number(process.env.PORT ?? 8731);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_TRIES = 20;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = join(root, normalize(pathname));
  if (!target.startsWith(root + sep) && target !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let stats;
  try {
    stats = statSync(target);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  if (stats.isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'service-worker-allowed': '/',
  });
  createReadStream(target).pipe(response);
});

// Walk forward from the requested port until one is free, so a busy port on the
// machine never blocks local testing.
const listen = (port, attempt = 0) => {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < MAX_TRIES) {
      listen(port + 1, attempt + 1);
      return;
    }
    process.stderr.write(`failed to start: ${error.message}\n`);
    process.exit(1);
  });
  // Bind IPv4 explicitly: on Windows, binding "::" can leave 127.0.0.1
  // unreachable depending on the dual-stack configuration.
  server.listen(port, HOST, () => {
    process.stdout.write(`serving ${root}\n  http://${HOST}:${port}/\n`);
  });
};

listen(requested);
