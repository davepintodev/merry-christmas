// XMAS-26 "Art build step and the rough Font sheet": the packed font, as
// code sees it. Glyphs come from the generated art module, never from a PNG.
import { describe, expect, it } from 'vitest';
import { drawings } from './art.generated.ts';
import { drawings as fontDrawings } from './font.generated.ts';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyph, glyphWidth } from './font.ts';

const FONT_CHARS = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:'];
// XMAS-34 "5-wide M": M is the one 5x5 glyph, so it no longer reads as H.
const M_PATTERN = ['#...#', '##.##', '#.#.#', '#...#', '#...#'];
const NARROW_CHARS = FONT_CHARS.filter((ch) => ch !== 'M');

/** A glyph's pixels as rows of '#' (ink) and '.' (transparent). */
function rows(ch: string): string[] {
  const g = glyph(ch);
  if (g === undefined) throw new Error(`no glyph ${ch}`);
  const out: string[] = [];
  for (let y = 0; y < g.height; y++) {
    let line = '';
    for (let x = 0; x < g.width; x++) line += (g.pixels[y * g.width + x] ?? 0) !== 0 ? '#' : '.';
    out.push(line);
  }
  return out;
}

describe('font', () => {
  it('the standard glyph is 3x5 art pixels', () => {
    expect(GLYPH_WIDTH).toBe(3);
    expect(GLYPH_HEIGHT).toBe(5);
  });

  it.each(NARROW_CHARS)('looks up %s: 3x5, one colour number per pixel, at least one drawn pixel', (ch) => {
    const g = glyph(ch);
    expect(g).toBeDefined();
    expect(g?.width).toBe(GLYPH_WIDTH);
    expect(g?.height).toBe(GLYPH_HEIGHT);
    expect(g?.pixels).toBeInstanceOf(Uint8Array);
    expect(g?.pixels.length).toBe(15);
    expect(g?.pixels.some((p) => p !== 0)).toBe(true);
  });

  it('looks up M: 5x5, one colour number per pixel (25)', () => {
    const g = glyph('M');
    expect(g).toBeDefined();
    expect(g?.width).toBe(5);
    expect(g?.height).toBe(GLYPH_HEIGHT);
    expect(g?.pixels).toBeInstanceOf(Uint8Array);
    expect(g?.pixels.length).toBe(25);
  });

  it('draws M as #...# / ##.## / #.#.# / #...# / #...#', () => {
    expect(rows('M')).toEqual(M_PATTERN);
  });

  it('draws M unlike H: the two no longer share a shape', () => {
    expect(rows('M').join('/')).not.toBe(rows('H').join('/'));
    expect(glyph('M')?.width).not.toBe(glyph('H')?.width);
  });

  it('the generated font module holds M at x=156, 5x5, on the font sheet', () => {
    const d = fontDrawings['M'];
    expect(d).toBeDefined();
    expect({ sheet: d?.sheet, x: d?.x, y: d?.y, width: d?.width, height: d?.height }).toEqual({ sheet: 'font.png', x: 156, y: 0, width: 5, height: 5 });
  });

  it('returns the packed drawing from the generated art module for that character', () => {
    for (const ch of FONT_CHARS) {
      const d = drawings[ch];
      expect(d, ch).toBeDefined();
      expect(d?.sheet).toBe('font.png');
      expect(Array.from(glyph(ch)?.pixels ?? []), ch).toEqual(Array.from(d?.pixels ?? []));
    }
  });

  it('gives different glyphs for different characters', () => {
    const shapes = ['0', '1', '8', 'A', 'M', 'W', '.', ':'].map((ch) => Array.from(glyph(ch)?.pixels ?? []).join(','));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it.each([
    ['lowercase letter', 'a'],
    ['lowercase m', 'm'],
    ['space', ' '],
    ['empty string', ''],
    ['two characters', 'AB'],
    ['digit then colon', '1:'],
    ['comma', ','],
    ['question mark', '?'],
    ['accented letter', 'É'],
    ['emoji', '🎄'],
    ['object key', 'constructor'],
    ['prototype key', '__proto__'],
    ['toString', 'toString'],
  ])('returns undefined for a %s (%j)', (_label, input) => {
    expect(glyph(input)).toBeUndefined();
  });

  it('is case-sensitive: an upper-case glyph is not returned for its lower-case letter', () => {
    expect(glyph('A')).toBeDefined();
    expect(glyph('a')).toBeUndefined();
  });
});

describe('glyphWidth', () => {
  it('gives 5 for M', () => {
    expect(glyphWidth('M')).toBe(5);
  });

  it.each(NARROW_CHARS)('gives the standard width 3 for %s', (ch) => {
    expect(glyphWidth(ch)).toBe(GLYPH_WIDTH);
  });

  it("matches each glyph's own packed width, for every character in the font", () => {
    for (const ch of FONT_CHARS) expect(glyphWidth(ch), ch).toBe(glyph(ch)?.width);
  });

  it.each([
    ['space', ' '],
    ['lowercase m', 'm'],
    ['empty string', ''],
    ['two characters', 'MM'],
    ['emoji', '🎄'],
    ['prototype key', '__proto__'],
    ['object key', 'constructor'],
  ])('gives the standard width 3 for a %s (%j), which has no glyph', (_label, input) => {
    expect(glyphWidth(input)).toBe(GLYPH_WIDTH);
  });
});
