// XMAS-27 "Countdown on a plain sky", part B: the build plugin bundles
// src/countdown/main.ts into ONE inline classic <script> in index.html, in
// place of the `<!-- countdown-script -->` marker, so the countdown needs no
// request beyond the document. Runs a real Vite build into a temp dir.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countdownPlugin } from './countdown-plugin.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '<!-- countdown-script -->';

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

/** Every <script ...>...</script> in the html, with its attributes and body. */
function scripts(html: string): { attrs: string; body: string }[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
    attrs: m[1] ?? '',
    body: m[2] ?? '',
  }));
}

describe('the index.html source', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  it('holds the countdown canvas, the noscript line and the script marker', () => {
    expect(source).toMatch(/<canvas\b[^>]*\bid="countdown"/);
    expect(source).toContain(MARKER);
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/i.exec(source);
    expect(noscript?.[1]?.replace(/<[^>]*>/g, '').trim()).toBe('Christmas is on 25 December');
  });
});

describe('countdownPlugin', () => {
  it('is a named Vite plugin', () => {
    const plugin = countdownPlugin();
    expect(typeof plugin.name).toBe('string');
    expect(plugin.name).toMatch(/countdown/);
  });

  it('is wired into vite.config.ts', async () => {
    const config = (await import('../vite.config.ts')).default as { plugins?: unknown[] };
    const names = (config.plugins ?? []).flat(5).map((p) => (p as { name?: string } | null)?.name);
    expect(names).toContain(countdownPlugin().name);
  });
});

describe('a build with countdownPlugin', () => {
  let outDir = '';
  let html = '';

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'countdown-plugin-'));
    await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      publicDir: false,
      plugins: [countdownPlugin()],
      build: { outDir, emptyOutDir: true },
    });
    html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  }, 60_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('replaces the marker with exactly one inline script', () => {
    expect(html).not.toContain(MARKER);
    const found = scripts(html);
    expect(found).toHaveLength(1);
    expect(found[0]?.body.trim().length).toBeGreaterThan(0);
  });

  it('makes the script classic and inline: no src, no type="module"', () => {
    const [script] = scripts(html);
    expect(script?.attrs ?? '').not.toMatch(/\bsrc\s*=/i);
    expect(script?.attrs ?? '').not.toMatch(/type\s*=\s*["']?module/i);
    expect(html).not.toMatch(/<link\b[^>]*rel=["']?modulepreload/i);
  });

  it('bundles main.ts and its imports, leaving no import or export statement', () => {
    const body = scripts(html)[0]?.body ?? '';
    expect(body).not.toMatch(/(^|[;\s}])import\s*[\w{*'"(]/);
    expect(body).not.toMatch(/(^|[;\s}])export\s*[\w{*]/);
    // The drawing code is in the page itself: it reaches for the countdown canvas.
    expect(body).toContain('countdown');
    expect(() => new Function(body)).not.toThrow(); // parses as a classic script
  });

  it('emits no separate script file for the countdown', () => {
    expect(listFiles(outDir).filter((f) => /\.(m?js|css)$/.test(f))).toEqual([]);
  });

  it('keeps the canvas and the noscript line in the built page', () => {
    expect(html).toMatch(/<canvas\b[^>]*\bid="countdown"/);
    expect(html).toContain('Christmas is on 25 December');
  });
});
