// XMAS-42b "Preview image in the build": the build writes
// preview-<8 hex of sha256>.png from renderPreview() into the root of dist and
// index.html names it in its social meta tags. Real Vite build, project config.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capsFor, evaluateCaps } from '../../tools/caps.ts';
import { measureDir } from '../../tools/measure.ts';
import { renderPreview } from '../../tools/preview-image.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESCRIPTION = 'How long until Christmas? Shake the snow globe while you wait.';

let outDir = '';
let html = '';
let previews: string[] = [];

/** The content of the <meta> tag whose name or property is `key`, or undefined. */
function meta(key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const id = /\b(?:name|property)\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (id === key) return /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
  }
  return undefined;
}

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), 'preview-build-'));
  await build({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    publicDir: false,
    build: { outDir, emptyOutDir: true },
  });
  html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  previews = readdirSync(outDir).filter((f) => f.startsWith('preview'));
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('the built preview file', () => {
  it('is exactly one preview-<8 hex of sha256 of its bytes>.png at the root of dist', () => {
    expect(previews).toHaveLength(1);
    const bytes = readFileSync(path.join(outDir, previews[0]!));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    expect(previews[0]).toBe(`preview-${hash}.png`);
  });

  it('holds the bytes renderPreview() returns', () => {
    expect(previews).toHaveLength(1);
    const bytes = readFileSync(path.join(outDir, previews[0]!));
    expect(Buffer.from(renderPreview()).equals(bytes)).toBe(true);
  });
});

describe('the built page meta tags', () => {
  it('og:image and twitter:image name the preview file by its root-relative path', () => {
    expect(previews).toHaveLength(1);
    expect(meta('og:image')).toBe(`/${previews[0]}`);
    expect(meta('twitter:image')).toBe(`/${previews[0]}`);
  });

  it('has og:title, the description tags and the summary_large_image card', () => {
    expect(meta('og:title')).toBe('Christmas Countdown');
    expect(meta('og:description')).toBe(DESCRIPTION);
    expect(meta('description')).toBe(DESCRIPTION);
    expect(meta('twitter:card')).toBe('summary_large_image');
  });

  it('titles the page "Christmas Countdown"', () => {
    expect(/<title>([^<]*)<\/title>/i.exec(html)?.[1]).toBe('Christmas Countdown');
  });

  it('names no PNG but the preview file and the favicon icons', () => {
    expect(previews).toHaveLength(1);
    const icons = ['/icon-32.png', '/icon-192.png', '/apple-touch-icon.png'];
    const named = (html.match(/[^"'\s=]*\.png\b/gi) ?? []).filter((n) => !icons.includes(n));
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(n).toBe(`/${previews[0]}`);
  });
});

describe('download caps with the preview in the build', () => {
  it('counts the preview in the preview cap only, and under its limit', () => {
    expect(previews).toHaveLength(1);
    expect(capsFor(previews[0]!)).toEqual(['preview']);
    const sizes = measureDir(outDir);
    const result = evaluateCaps(sizes).find((r) => r.name === 'preview');
    expect(result?.files).toBe(1);
    expect(result?.pass, `preview: ${result?.bytes} of ${result?.limitBytes}`).toBe(true);
    const total = evaluateCaps(sizes).find((r) => r.name === 'total');
    const without = evaluateCaps(sizes.filter((s) => !s.file.startsWith('preview'))).find((r) => r.name === 'total');
    expect(total).toEqual(without);
  });
});
