// XMAS-24 "Cap script: download caps checked after every build": the I/O
// layer. Brotli sizing and listing built files.
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import type { FileSize } from './caps.ts';

/** Brotli-compressed size of data at maximum quality (11). */
export function brotliSize(data: Uint8Array): number {
  return brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}

/** Regular files under dir with Brotli sizes, sorted by POSIX-relative path.
 * A missing directory has no files. */
export function measureDir(dir: string): FileSize[] {
  return walk(dir, '').sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function walk(dir: string, prefix: string): FileSize[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const sizes: FileSize[] = [];
  for (const entry of entries) {
    const file = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) sizes.push(...walk(path.join(dir, entry.name), file));
    else if (entry.isFile()) sizes.push({ file, bytes: brotliSize(readFileSync(path.join(dir, entry.name))) });
  }
  return sizes;
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
