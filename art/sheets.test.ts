// XMAS-26 "Art build step and the rough Font sheet": the real sheet manifest
// and the rough Font sheet drawn against it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packSheet } from '../tools/art.ts';
import { masterColours } from './colours.ts';
import { sheets } from './sheets.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:';

function fontSpec() {
  const s = sheets.find((x) => x.file === 'font.png');
  if (!s) throw new Error('manifest has no font.png sheet');
  return s;
}

describe('sheet manifest', () => {
  it('has the font sheet, 156x5', () => {
    const s = fontSpec();
    expect(s.width).toBe(156);
    expect(s.height).toBe(5);
  });

  it('names the 39 glyphs by their character, in the order 0-9, A-Z, full stop, exclamation mark, colon', () => {
    expect(fontSpec().drawings.map((d) => d.name)).toEqual([...FONT_CHARS]);
  });

  it('places glyph i at x = 4*i, y = 0, each 3x5, one transparent column apart', () => {
    fontSpec().drawings.forEach((d, i) => {
      expect(d, d.name).toEqual({ name: FONT_CHARS[i], x: 4 * i, y: 0, width: 3, height: 5 });
    });
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

  it('draws every glyph: each has at least one non-transparent pixel', () => {
    const packed = packedFont();
    for (const ch of FONT_CHARS) {
      const g = packed[ch];
      expect(g, ch).toBeDefined();
      expect(g?.pixels.length, ch).toBe(15);
      expect(g?.pixels.some((p) => p !== 0), `glyph ${ch} is blank`).toBe(true);
    }
  });

  it("draws different shapes for '0', '1', 'A' and 'M'", () => {
    const packed = packedFont();
    const shapes = ['0', '1', 'A', 'M'].map((ch) => Array.from(packed[ch]?.pixels ?? []).join(','));
    expect(new Set(shapes).size).toBe(4);
  });
});
