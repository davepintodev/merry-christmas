// XMAS-31b "Scene core", page runtime: the built page. The scene is its own
// file, loaded lazily by the countdown script once the countdown shows; the
// page links nothing up front. The download caps still hold with the scene
// and its art in the build (globe-ready 300 KB, total 500 KB, Brotli).
// Runs a real Vite build with the project's vite.config.ts into a temp dir.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { objects } from '../../art/objects.ts';
import { CAPS, KB, evaluateCaps } from '../../tools/caps.ts';
import { measureDir } from '../../tools/measure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

function inlineScripts(html: string): string {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? '').join('\n');
}

let outDir = '';
let html = '';
let scripts: string[] = [];

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), 'scene-build-'));
  await build({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    publicDir: false,
    build: { outDir, emptyOutDir: true },
  });
  html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  scripts = listFiles(outDir).filter((f) => /\.m?js$/.test(f));
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('the built scene file', () => {
  it('is a separate script file next to the page', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it('is not linked from the page up front: no script src, no modulepreload, no preload', () => {
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    expect(html).not.toMatch(/<link\b[^>]*rel=["']?(modulepreload|preload|prefetch)/i);
    for (const file of scripts) {
      const name = path.posix.basename(file);
      const outsideScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      expect(outsideScripts, `${name} is referenced outside the countdown script`).not.toContain(name);
    }
  });

  it('is named by the countdown script, which loads it', () => {
    const inline = inlineScripts(html);
    const named = scripts.filter((f) => inline.includes(path.posix.basename(f)));
    expect(named.length, `the inline script names none of ${scripts.join(', ')}`).toBeGreaterThanOrEqual(1);
  });

  it('carries the scene: draws on a scene canvas and records globe-ready', () => {
    const code = scripts.map((f) => readFileSync(path.join(outDir, f), 'utf8')).join('\n');
    expect(code).toContain('globe-ready');
    expect(code).toMatch(/requestAnimationFrame/);
    expect(code).toMatch(/visibilitychange|visibilityState/);
  });

  it('keeps the scene out of the countdown script: no globe-ready, no scene art', () => {
    const inline = inlineScripts(html);
    expect(inline).not.toContain('globe-ready');
    expect(inline).not.toMatch(/requestAnimationFrame/);
    const sceneOnly = objects.map((o) => o.name).filter((n) => /^(house-|santa-|snowman-|disc$)/.test(n));
    expect(sceneOnly.length).toBeGreaterThan(0);
    for (const name of sceneOnly) expect(inline, name).not.toContain(`"${name}"`);
  });

  it('names no PNG sheet', () => {
    for (const file of scripts) {
      expect(readFileSync(path.join(outDir, file), 'utf8'), file).not.toMatch(/\.png\b/i);
    }
  });
});

describe('download caps with the scene in the build', () => {
  it('globe-ready is 300 KB and total 500 KB', () => {
    expect(CAPS.find((c) => c.name === 'globe-ready')?.limitBytes).toBe(300 * KB);
    expect(CAPS.find((c) => c.name === 'total')?.limitBytes).toBe(500 * KB);
  });

  it('globe-ready counts the page and the scene file, and stays under its cap', () => {
    const result = evaluateCaps(measureDir(outDir)).find((r) => r.name === 'globe-ready');
    expect(result?.files).toBeGreaterThanOrEqual(1 + scripts.length);
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    expect(result?.pass, `globe-ready: ${result?.bytes} of ${result?.limitBytes} bytes`).toBe(true);
  });

  it('every cap passes', () => {
    const results = evaluateCaps(measureDir(outDir));
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    expect(results.filter((r) => !r.pass).map((r) => `${r.name} ${r.bytes}/${r.limitBytes}`)).toEqual([]);
  });

  it('before-countdown (50 KB) is still the page alone: the scene does not ride in it', () => {
    const result = evaluateCaps(measureDir(outDir)).find((r) => r.name === 'before-countdown');
    expect(result?.files).toBe(1);
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    expect(result?.pass).toBe(true);
  });
});
