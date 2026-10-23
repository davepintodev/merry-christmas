// XMAS-24 "Cap script: download caps checked after every build": the I/O
// layer. Brotli sizing and listing built files, against temp dirs.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { brotliSize, measureDir } from './measure.ts';

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'xmas-caps-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe('brotliSize', () => {
  it('compresses repetitive data to less than its input size', () => {
    const data = new TextEncoder().encode('merry christmas '.repeat(2_000));
    const n = brotliSize(data);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(data.length / 10);
  });

  it('is deterministic', () => {
    const data = randomBytes(4_096);
    expect(brotliSize(data)).toBe(brotliSize(data));
  });

  it('uses maximum quality', () => {
    const data = new TextEncoder().encode('<div class="digit">0</div>'.repeat(500) + 'abc'.repeat(3_000));
    const q11 = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    expect(brotliSize(data)).toBe(q11);
  });

  it('keeps incompressible data close to its input size', () => {
    const data = randomBytes(10_000);
    const n = brotliSize(data);
    expect(n).toBeGreaterThanOrEqual(10_000);
    expect(n).toBeLessThan(10_100);
  });

  it('handles empty input', () => {
    expect(brotliSize(new Uint8Array(0))).toBeGreaterThanOrEqual(0);
  });
});

describe('measureDir', () => {
  it('returns [] for a missing directory without throwing', () => {
    const missing = path.join(tempDir(), 'no-such-dist');
    expect(measureDir(missing)).toEqual([]);
  });

  it('returns [] for an empty directory', () => {
    expect(measureDir(tempDir())).toEqual([]);
  });

  it('lists nested files with sorted POSIX-relative paths and Brotli sizes', () => {
    const dir = tempDir();
    const index = new TextEncoder().encode('<html>' + 'x'.repeat(5_000) + '</html>');
    const scene = randomBytes(2_000);
    const preview = randomBytes(1_000);
    const headers = new TextEncoder().encode('/*\n  X-Frame-Options: DENY\n');
    mkdirSync(path.join(dir, 'assets', 'deep'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), index);
    writeFileSync(path.join(dir, '_headers'), headers);
    writeFileSync(path.join(dir, 'assets', 'scene-abc123.js'), scene);
    writeFileSync(path.join(dir, 'assets', 'deep', 'chunk-1.js'), 'export {}');
    writeFileSync(path.join(dir, 'preview-abc123.png'), preview);

    const sizes = measureDir(dir);
    expect(sizes.map((s) => s.file)).toEqual([
      '_headers',
      'assets/deep/chunk-1.js',
      'assets/scene-abc123.js',
      'index.html',
      'preview-abc123.png',
    ]);
    const byFile = Object.fromEntries(sizes.map((s) => [s.file, s.bytes]));
    expect(byFile['index.html']).toBe(brotliSize(index));
    expect(byFile['assets/scene-abc123.js']).toBe(brotliSize(scene));
    expect(byFile['preview-abc123.png']).toBe(brotliSize(preview));
    expect(byFile['index.html']).toBeLessThan(index.length);
  });

  it('has no entry for a scene or preview file that does not exist yet', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    writeFileSync(path.join(dir, '_headers'), '/*\n');
    const files = measureDir(dir).map((s) => s.file);
    expect(files).toEqual(['_headers', 'index.html']);
  });

  it('skips directories and lists only regular files', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'assets', 'empty'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), 'hi');
    try {
      symlinkSync(path.join(dir, 'index.html'), path.join(dir, 'link.html'));
    } catch {
      // symlinks unavailable: the regular-file assertion below still holds
    }
    expect(measureDir(dir).map((s) => s.file)).toEqual(['index.html']);
  });
});
