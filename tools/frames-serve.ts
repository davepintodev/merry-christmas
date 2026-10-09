// XMAS-31c "Frames review page": the review server. Usage:
// node tools/frames-serve.ts [dir] (default tests/frames). Serves the review
// page and the folder's PNGs on HOST and PORT (see framesAddress); the folder
// is read on every request, so pictures added or removed while the page is
// open show up on reload, and the server never writes.
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { framesAddress } from './frames.ts';
import { frameList, reviewPage } from './frames-review.ts';

const dir = process.argv[2] ?? 'tests/frames';
const { host, port } = framesAddress(process.env);

/** The one answer for anything the folder does not hold as a PNG right now. */
function missing(response: ServerResponse): void {
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not a frame picture');
}

/** The requested path as a file name, or null when it cannot be decoded. */
function decodeName(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  const name = new URL(request.url ?? '/', `http://${host}:${port}`).pathname;
  if (name === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(reviewPage(frameList(dir)));
    return;
  }
  // A request only ever names one of the folder's own entries, so no decoded
  // name can step outside it; anything else (including `..` paths) is missing.
  const wanted = decodeName(name);
  const found = wanted === null ? undefined : frameList(dir).find((frame) => frame.file === wanted);
  if (found === undefined) {
    missing(response);
    return;
  }
  try {
    const body = readFileSync(path.join(dir, found.file));
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(body);
  } catch {
    missing(response);
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
