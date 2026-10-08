// XMAS-31a "Scene core engine and reference pictures": the viewing page.
// Usage: node tools/frames-serve.ts [dir] (default tests/frames). Serves the
// page and the pictures on HOST and PORT (see framesAddress); never writes.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { framesAddress, framesPage, referenceFrames } from './frames.ts';

const dir = process.argv[2] ?? 'tests/frames';
const { host, port } = framesAddress(process.env);
const page = framesPage();
const pictures = new Set(referenceFrames.map((ref) => `${ref.name}.png`));

const server = createServer((request, response) => {
  const name = new URL(request.url ?? '/', `http://${host}:${port}`).pathname;
  if (name === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  const file = name.slice(1);
  if (!pictures.has(file)) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not a reference picture');
    return;
  }
  try {
    const body = readFileSync(path.join(dir, file));
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('missing reference picture');
  }
});
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`frames: PORT ${port} is already in use`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
server.listen(port, host, () => console.log(`frames: http://${host}:${port}`));
