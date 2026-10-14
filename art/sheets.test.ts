// XMAS-26 "Art build step and the rough Font sheet": the real sheet manifest
// and the rough Font sheet drawn against it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packSheet } from '../tools/art.ts';
import { decodePng } from '../tools/png.ts';
import { masterColours } from './colours.ts';
import { sheets } from './sheets.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:';
// XMAS-34 "5-wide M": M is 5x5 at the end of the sheet; every other glyph keeps its 3x5 slot.
const M_X = 156;
const M_OLD_X = 4 * FONT_CHARS.indexOf('M');
const M_PATTERN = ['#...#', '##.##', '#.#.#', '#...#', '#...#'];

function fontPng() {
  return decodePng(new Uint8Array(readFileSync(path.join(HERE, 'sheets', 'font.png'))));
}

/** Alpha of the font sheet pixel at (x, y). */
function alpha(img: { width: number; rgba: Uint8Array }, x: number, y: number): number {
  return img.rgba[(y * img.width + x) * 4 + 3] ?? -1;
}

function fontSpec() {
  const s = sheets.find((x) => x.file === 'font.png');
  if (!s) throw new Error('manifest has no font.png sheet');
  return s;
}

describe('sheet manifest', () => {
  it('has the font sheet, 161x5 (the 5-wide M added at the end)', () => {
    const s = fontSpec();
    expect(s.width).toBe(161);
    expect(s.height).toBe(5);
  });

  it('names the 39 glyphs by their character, each once', () => {
    const names = fontSpec().drawings.map((d) => d.name);
    expect(names).toHaveLength(FONT_CHARS.length);
    expect([...names].sort()).toEqual([...FONT_CHARS].sort());
  });

  it('places glyph i (0-9, A-Z, full stop, exclamation mark, colon) at x = 4*i, y = 0, 3x5, except M', () => {
    const byName = new Map(fontSpec().drawings.map((d) => [d.name, d]));
    [...FONT_CHARS].forEach((ch, i) => {
      if (ch === 'M') return;
      expect(byName.get(ch), ch).toEqual({ name: ch, x: 4 * i, y: 0, width: 3, height: 5 });
    });
  });

  it('places M at the end of the sheet: x = 156, y = 0, 5x5, filling the sheet to its right edge', () => {
    const m = fontSpec().drawings.find((d) => d.name === 'M');
    expect(m).toEqual({ name: 'M', x: M_X, y: 0, width: 5, height: 5 });
    expect((m?.x ?? 0) + (m?.width ?? 0)).toBe(fontSpec().width);
  });

  it('keeps every font drawing apart: no two overlap and each pair has a transparent column between', () => {
    const ds = fontSpec().drawings;
    for (const a of ds) {
      for (const b of ds) {
        if (a === b) continue;
        const apart = a.x + a.width + 1 <= b.x || b.x + b.width + 1 <= a.x;
        expect(apart, `${a.name} vs ${b.name}`).toBe(true);
      }
    }
  });

  it('keeps every drawing inside its sheet and drawing names unique across sheets', () => {
    const names: string[] = [];
    for (const s of sheets) {
      for (const d of s.drawings) {
        expect(d.x >= 0 && d.y >= 0 && d.x + d.width <= s.width && d.y + d.height <= s.height, `${s.file}:${d.name}`).toBe(true);
        names.push(d.name);
      }
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('every sheet file in the manifest exists under art/sheets', () => {
    for (const s of sheets) expect(existsSync(path.join(HERE, 'sheets', s.file)), s.file).toBe(true);
  });
});

describe('art/sheets/font.png (rough level)', () => {
  function packedFont() {
    const png = new Uint8Array(readFileSync(path.join(HERE, 'sheets', 'font.png')));
    return packSheet(fontSpec(), png, masterColours);
  }

  it('packs with the master colours: right size, every colour allowed', () => {
    const packed = packedFont();
    expect(Object.keys(packed).sort()).toEqual([...FONT_CHARS].sort());
  });

  it('is 161x5 pixels, the size the manifest names', () => {
    const img = fontPng();
    expect([img.width, img.height]).toEqual([161, 5]);
  });

  it('draws every glyph: each has at least one non-transparent pixel', () => {
    const packed = packedFont();
    for (const ch of FONT_CHARS) {
      const g = packed[ch];
      expect(g, ch).toBeDefined();
      expect(g?.pixels.length, ch).toBe(ch === 'M' ? 25 : 15);
      expect(g?.pixels.some((p) => p !== 0), `glyph ${ch} is blank`).toBe(true);
    }
  });

  it("draws different shapes for '0', '1', 'A' and 'M'", () => {
    const packed = packedFont();
    const shapes = ['0', '1', 'A', 'M'].map((ch) => Array.from(packed[ch]?.pixels ?? []).join(','));
    expect(new Set(shapes).size).toBe(4);
  });

  it('draws M at x = 156 as #...# / ##.## / #.#.# / #...# / #...#', () => {
    const m = packedFont()['M'];
    expect(m).toBeDefined();
    const got: string[] = [];
    for (let y = 0; y < 5; y++) {
      let line = '';
      for (let x = 0; x < 5; x++) line += (m?.pixels[y * 5 + x] ?? 0) !== 0 ? '#' : '.';
      got.push(line);
    }
    expect(got).toEqual(M_PATTERN);
  });

  it("leaves M's old 3x5 slot at x = 88 and the column before the new M fully transparent", () => {
    const img = fontPng();
    for (let y = 0; y < 5; y++) {
      for (let x = M_OLD_X; x < M_OLD_X + 3; x++) expect(alpha(img, x, y), `old M slot ${x},${y}`).toBe(0);
      expect(alpha(img, M_X - 1, y), `gap column ${M_X - 1},${y}`).toBe(0);
    }
  });

  it('draws nothing in the one-pixel gap columns between the 3-wide glyphs', () => {
    const img = fontPng();
    for (let i = 0; i < FONT_CHARS.length; i++) {
      for (let y = 0; y < 5; y++) expect(alpha(img, 4 * i + 3, y), `gap after ${FONT_CHARS[i]} at row ${y}`).toBe(0);
    }
  });
});
