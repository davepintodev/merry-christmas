// XMAS-26 "Art build step and the rough Font sheet": the packed 3x5 font, read
// from the generated font module (never a PNG). The sheet holds 0-9, A-Z,
// '.', '!' and ':', each on a 3x5 grid, one pixel column apart.
import { drawings, type Drawing } from './font.generated.ts';

export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;

/** The packed glyph for one character, or undefined when the font has none. */
export function glyph(char: string): Drawing | undefined {
  return Object.hasOwn(drawings, char) ? drawings[char] : undefined;
}
