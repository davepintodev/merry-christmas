// XMAS-26: the manifest of drawn PNG sheets and the drawings cut from them.
// Every sheet's drawings sit at fixed sizes, so packSheet can stop the build
// when a sheet is redrawn at the wrong size.
import type { SheetSpec } from '../tools/art.ts';

const FONT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.!:';

export const sheets: SheetSpec[] = [
  {
    file: 'font.png',
    width: 156,
    height: 5,
    drawings: [...FONT_CHARS].map((name, i) => ({ name, x: 4 * i, y: 0, width: 3, height: 5 })),
  },
];
