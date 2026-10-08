// XMAS-26 "Art build step and the rough Font sheet": the packed font, as
// code sees it. Glyphs come from the generated art module, never from a PNG.
import { describe, expect, it } from 'vitest';
import { drawings } from './art.generated.ts';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyph } from './font.ts';

const FONT_CHARS = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:'];

describe('font', () => {
  it('glyphs are 3x5 art pixels', () => {
    expect(GLYPH_WIDTH).toBe(3);
    expect(GLYPH_HEIGHT).toBe(5);
  });

  it.each(FONT_CHARS)('looks up %s: 3x5, one colour number per pixel, at least one drawn pixel', (ch) => {
    const g = glyph(ch);
    expect(g).toBeDefined();
    expect(g?.width).toBe(GLYPH_WIDTH);
    expect(g?.height).toBe(GLYPH_HEIGHT);
    expect(g?.pixels).toBeInstanceOf(Uint8Array);
    expect(g?.pixels.length).toBe(15);
    expect(g?.pixels.some((p) => p !== 0)).toBe(true);
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
