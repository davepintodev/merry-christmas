// XMAS-26 "Art build step and the rough Font sheet": the real sheet manifest.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sheets } from './sheets.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:';
// XMAS-34 "5-wide M": M is 5x5 at the end of the sheet; every other glyph keeps its 3x5 slot.
const M_X = 156;

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
