// XMAS-28 "Rough art for the remaining sheets" part 1, review finding: the
// inline countdown script must carry the font only, never scene art. Runs a
// real Vite build into a temp dir.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { objects } from '../../art/objects.ts';
import { sheets } from '../../art/sheets.ts';
import { packSheet } from '../../tools/art.ts';
import { countdownPlugin } from '../../tools/countdown-plugin.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function inlineScripts(html: string): string {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? '').join('\n');
}

/** The base64 pixels of every font glyph, packed straight from art/sheets/font.png. */
function fontBase64(): Map<string, string> {
  const font = sheets.find((s) => s.file === 'font.png');
  if (!font) throw new Error('manifest has no font.png');
  const packed = packSheet(font, new Uint8Array(readFileSync(path.join(ROOT, 'art', 'sheets', 'font.png'))), masterColours);
  return new Map(Object.entries(packed).map(([name, d]) => [name, Buffer.from(d.pixels).toString('base64')]));
}

function sceneNames(): string[] {
  const names = objects.map((o) => o.name);
  expect(names).toContain('house-wall-front');
  expect(names).toContain('santa-trot-1');
  expect(names).toContain('shake-frame');
  return names;
}

describe('a build with countdownPlugin carries no scene art', () => {
  let outDir = '';
  let script = '';

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'countdown-art-'));
    await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      publicDir: false,
      plugins: [countdownPlugin()],
      build: { outDir, emptyOutDir: true },
    });
    script = inlineScripts(readFileSync(path.join(outDir, 'index.html'), 'utf8'));
  }, 60_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('names no object from art/objects.ts in the inline script', () => {
    expect(script.length).toBeGreaterThan(0);
    const found = sceneNames().filter((n) => script.includes(n));
    expect(found).toEqual([]);
  });

  it('names no scene sheet file in the inline script', () => {
    for (const f of ['house.png', 'santa.png', 'props.png', 'base.png', 'buttons.png']) expect(script, f).not.toContain(f);
  });

  it('still carries the pixels of every font glyph', () => {
    for (const [ch, b64] of fontBase64()) expect(script, `glyph ${ch}`).toContain(b64);
  });

});
