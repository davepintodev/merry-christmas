// XMAS-26: the manifest of drawn PNG sheets and the drawings cut from them.
// Every sheet's drawings sit at fixed sizes, so packSheet can stop the build
// when a sheet is redrawn at the wrong size.
//
// XMAS-28: the object sheets are derived from the single object list in
// art/objects.ts. Each lays its drawings left to right on one row with a
// one-pixel transparent gap, so sheet width = widths + gaps and height is the
// tallest drawing.
import type { SheetSpec } from '../tools/art.ts';
import { objects, type ArtObject } from './objects.ts';

const FONT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:';
const GAP = 1;

export const sheets: SheetSpec[] = [
  {
    file: 'font.png',
    width: 156,
    height: 5,
    drawings: [...FONT_CHARS].map((name, i) => ({ name, x: 4 * i, y: 0, width: 3, height: 5 })),
  },
  objectSheet('house'),
  objectSheet('santa'),
  objectSheet('props'),
  objectSheet('base'),
  objectSheet('buttons'),
];

/** One row of drawings, one transparent column apart, for one object sheet. */
function objectSheet(sheet: ArtObject['sheet']): SheetSpec {
  const list = objects.filter((o) => o.sheet === sheet);
  let x = 0;
  const drawings = list.map((o) => {
    const drawing = { name: o.name, x, y: 0, width: o.width, height: o.height };
    x += o.width + GAP;
    return drawing;
  });
  return {
    file: `${sheet}.png`,
    width: x - GAP,
    height: Math.max(...list.map((o) => o.height)),
    drawings,
  };
}
