// XMAS-24 "Cap script: download caps checked after every build": the CLI,
// run as a child process with Node type stripping against temp dirs that
// hold made-up built files. Random bytes are incompressible, so their
// Brotli size is close to their input size.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tools', 'check-caps.ts');
const CAP_NAMES = ['before-countdown', 'globe-ready', 'total', 'preview'];

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'xmas-check-caps-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function runCaps(args: string[], cwd = ROOT): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 60_000 });
}

function row(out: string, name: string): string {
  return out.split('\n').find((l) => l.includes(name)) ?? '';
}

// Numbers on a table row, in column order: files, bytes, limit.
function numbers(line: string): number[] {
  return (line.match(/\d+/g) ?? []).map(Number);
}

describe('check-caps CLI', () => {
  it('exits 0 and prints the table for a small passing set', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<html>' + 'digit '.repeat(200) + '</html>');
    writeFileSync(path.join(dir, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
    writeFileSync(path.join(dir, 'assets', 'scene-abc123.js'), randomBytes(1_000));
    const r = runCaps([dir]);
    expect(r.status, r.stderr).toBe(0);
    const header = r.stdout.split('\n').find((l) => l.includes('cap') && l.includes('result')) ?? '';
    expect(header).toMatch(/cap.*files.*bytes.*limit.*result/);
    for (const name of CAP_NAMES) expect(row(r.stdout, name)).toContain('pass');
    expect(r.stdout).not.toContain('FAIL');
    expect(r.stderr).not.toContain('Cap exceeded');
  });

  it('exits 1 and names before-countdown when index.html is over 50 KB compressed', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'index.html'), randomBytes(60 * 1024));
    const r = runCaps([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Cap exceeded: before-countdown');
    expect(r.stderr).not.toContain('Cap exceeded: globe-ready');
    expect(r.stderr).not.toContain('Cap exceeded: total');
    expect(r.stderr).not.toContain('Cap exceeded: preview');
    expect(row(r.stdout, 'before-countdown')).toContain('FAIL');
    expect(row(r.stdout, 'total')).toContain('pass');
  });

  it('names each failing cap on its own stderr line', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), randomBytes(60 * 1024));
    writeFileSync(path.join(dir, 'assets', 'scene-x.js'), randomBytes(260 * 1024));
    writeFileSync(path.join(dir, 'preview-x.png'), randomBytes(310 * 1024));
    const r = runCaps([dir]);
    expect(r.status).toBe(1);
    const lines = r.stderr.split('\n').filter((l) => l.startsWith('Cap exceeded: '));
    expect(lines).toEqual(['Cap exceeded: before-countdown', 'Cap exceeded: globe-ready', 'Cap exceeded: preview']);
  });

  it('does not count the preview image towards the total', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'index.html'), 'hi');
    writeFileSync(path.join(dir, 'preview-abc.png'), randomBytes(250 * 1024));
    const r = runCaps([dir]);
    expect(r.status, r.stderr).toBe(0);
    const [files, bytes] = numbers(row(r.stdout, 'total'));
    expect(files).toBe(1);
    expect(bytes).toBeLessThan(100);
    expect(numbers(row(r.stdout, 'preview'))[1]).toBeGreaterThanOrEqual(250 * 1024);
  });

  it('exits 1 naming the dir when the dir is empty (no index.html)', () => {
    const dir = tempDir();
    const r = runCaps([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`index.html not found in ${dir}`);
    expect(r.stderr).not.toContain('Cap exceeded');
  });

  it('exits 1 naming the dir when the dir is missing', () => {
    const dir = path.join(tempDir(), 'missing');
    const r = runCaps([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`index.html not found in ${dir}`);
  });

  it('exits 1 when only other files exist, even if every cap would pass', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, '_headers'), '/*\n');
    writeFileSync(path.join(dir, 'assets', 'scene-a.js'), 'export {}');
    const r = runCaps([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`index.html not found in ${dir}`);
  });

  it('exits 1 when the default dist dir is missing', () => {
    const cwd = tempDir();
    const r = runCaps([], cwd);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/index\.html not found in \S*dist/);
  });

  it('exits 0 with zeros for the caps a lone index.html does not touch', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    const r = runCaps([dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(numbers(row(r.stdout, 'preview')).slice(0, 2)).toEqual([0, 0]);
    for (const name of CAP_NAMES) expect(row(r.stdout, name)).toContain('pass');
  });

  it('defaults to dist under the working directory', () => {
    const cwd = tempDir();
    mkdirSync(path.join(cwd, 'dist'));
    writeFileSync(path.join(cwd, 'dist', 'index.html'), randomBytes(60 * 1024));
    const r = runCaps([], cwd);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Cap exceeded: before-countdown');
  });
});
