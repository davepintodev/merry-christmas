// XMAS-70: the backdrop's small scenery, drawn from tiny character pictures:
// a cabin with smoke, a fence with a lantern and an owl, a bunny,
// birds and a decorated tree's gifts and star. Each picture is stamped by its
// top left corner; '.' and ' ' are clear. Colours are codes of the plan.
import * as C from './backdrop-codes.ts';

export type Put = (x: number, y: number, code: number) => void;

/** Stamps rows of characters at (x, y), each character looked up in the key; unknown characters are skipped. */
export function stamp(put: Put, x: number, y: number, rows: readonly string[], key: Readonly<Record<string, number>>): void {
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      const code = key[ch];
      if (code !== undefined) put(x + dx, y + dy, code);
    });
  });
}

/** The cabin's width and height in pixels, without its smoke and glow. */
export const CABIN = { width: 19, height: 19 };

/** A snow-roofed log cabin: icicles, two cross-framed lit windows, a lit door with a wreath, a chimney with smoke puffs and a warm glow on the snow; x0 is its left edge, yb its bottom row. */
export function cabin(put: Put, x0: number, yb: number): void {
  const top = yb - 18;
  const at = (dx: number, dy: number, code: number): void => put(x0 + dx, top + dy, code);
  // Chimney first: the roof's slope covers its foot.
  for (let dy = 1; dy <= 7; dy++) for (let dx = 15; dx <= 17; dx++) at(dx, dy, dx === 15 ? C.LOG_LIGHT : C.WALL_SHADE);
  for (let dx = 14; dx <= 18; dx++) at(dx, 0, dx === 14 ? C.LOG_LIGHT : C.WALL_SHADE);
  // The roof: a snow-covered triangle, shaded on its right, outlined, with a shaded eave.
  for (let r = 0; r <= 8; r++) {
    const left = 8 - r;
    const right = 10 + r;
    for (let dx = left; dx <= right; dx++) {
      const edge = r === 0 || dx === left || dx === right;
      at(dx, r, edge ? C.OUTLINE : dx >= right - 2 ? C.NEAR_SHADE : C.SNOW_CAP);
    }
  }
  at(0, 8, C.OUTLINE);
  for (let dx = 1; dx <= 17; dx++) at(dx, 9, C.WALL_SHADE);
  at(0, 9, C.OUTLINE);
  at(18, 9, C.OUTLINE);
  for (const dx of [2, 4, 7, 11, 14, 16]) at(dx, 10, C.ICICLE);
  for (const dx of [4, 11]) at(dx, 11, C.ICICLE);
  // Walls: logs in alternate light and plain rows, shaded on the right, outlined.
  for (let dy = 10; dy <= 17; dy++) {
    at(1, dy, C.OUTLINE);
    at(17, dy, C.OUTLINE);
    for (let dx = 2; dx <= 16; dx++) {
      if (dy <= 11 && [2, 4, 7, 11, 14, 16].includes(dx)) continue;
      at(dx, dy, dy % 2 === 0 ? (dx >= 14 ? C.WALL_SHADE : C.LOG_LIGHT) : dx >= 14 ? C.WALL_SHADE : C.WALL);
    }
  }
  for (let dx = 1; dx <= 17; dx++) at(dx, 18, C.OUTLINE);
  // Two windows with a cross frame, a lit door with a wreath.
  for (const wx of [4, 12]) {
    stamp(put, x0 + wx, top + 12, ['YFY', 'FFF', 'YFY'], { Y: C.WINDOW, F: C.WALL_SHADE });
  }
  stamp(put, x0 + 8, top + 13, ['.D.', 'DDD', 'DDD', 'DDD', 'DDD'], { D: C.DOOR });
  stamp(put, x0 + 8, top + 14, ['GRG'], { G: C.WREATH, R: C.RED });
  // Smoke: three puffs growing as they drift left and right.
  stamp(put, x0 + 15, top - 3, ['.SS.', 'SSSS', '.SS.'], { S: C.SMOKE });
  stamp(put, x0 + 14, top - 7, ['.SSS.', 'SSSSS', 'SSSSS', '.SSS.'], { S: C.SMOKE });
  stamp(put, x0 + 12, top - 12, ['..SSS..', '.SSSSS.', 'SSSSSSS', '.SSSSS.'], { S: C.SMOKE });
  // The warm glow spilling from the door onto the snow.
  for (let dx = 6; dx <= 12; dx++) put(x0 + dx, yb + 1, C.GLOW);
  for (let dx = 7; dx <= 11; dx++) put(x0 + dx, yb + 2, C.GLOW);
}

/** A bunny sitting and facing right: long ears with a pink inside, an eye, a nose and a cheek, a tail puff and a soft shadow. */
const BUNNY_ROWS = [
  '.....oo..oo.',
  '....oBpo.oBpo',
  '....oBpo.oBpo',
  '....oBpo.oBpo',
  '....oBBooBBBo',
  '...oBBBBBBBBBo',
  '...oBBBBBBeBBn',
  '..oBBBBBBBcBBo',
  '.oBBBBBBBBBBBo',
  'oLLBBBBBBBBBBo',
  'oLLBBBBBBBBBBo',
  '.ooBBBBBBBBBoo',
  '...oLLoooLLo..',
];
export const BUNNY_SIZE = { width: 14, height: BUNNY_ROWS.length };
export function bunny(put: Put, x: number, bottom: number): void {
  stamp(put, x, bottom - BUNNY_ROWS.length + 1, BUNNY_ROWS, { o: C.OUTLINE, B: C.BUNNY, L: C.BUNNY_LIGHT, p: C.PINK, e: C.EYE, n: C.PINK, c: C.PINK });
  for (let dx = 1; dx <= 12; dx++) put(x + dx, bottom + 1, C.FLOOR_SHADE);
  // A carrot beside it.
  stamp(put, x + 15, bottom - 3, ['.gg', 'CCC', '.CC', '..C'], { g: C.WREATH, C: C.CARROT });
}

/** A fence panel row along a ground line: tall posts with thick snow caps, two rails, a lantern on the first post and an owl on the last. */
export function fence(put: Put, x: number, panels: number, groundAt: (x: number) => number): void {
  const step = 6;
  const len = panels * step + 2;
  for (let dx = 0; dx < len; dx++) {
    const g = groundAt(x + dx);
    put(x + dx, g - 2, C.FENCE);
    put(x + dx, g - 4, C.FENCE);
    put(x + dx, g - 5, C.WALL_SHADE);
  }
  for (let p = 0; p <= panels; p++) {
    const px = x + p * step;
    const g = groundAt(px);
    for (let dy = 0; dy <= 6; dy++) for (let dx = 0; dx <= 1; dx++) put(px + dx, g - dy, dx === 0 ? C.LOG_LIGHT : C.FENCE);
    stamp(put, px - 1, g - 8, ['.SS.', 'SSSS'], { S: C.SNOW_CAP });
    put(px, g - 9, C.SNOW_CAP);
    if (p === 0) stamp(put, px, g - 14, ['.o.', 'oBo', 'oBo', '.o.'], { o: C.OUTLINE, B: C.BULB });
    if (p === 0) put(px + 1, g - 10, C.OUTLINE);
    if (p === 1) stamp(put, px - 1, g - 12, ['R.R', '.R.'], { R: C.RED });
    if (p === panels) stamp(put, px - 2, g - 14, ['w...w', 'wwwww', 'wEwEw', 'wwcww', '.wbw.'], { w: C.OWL, E: C.BULB, c: C.CARROT, b: C.BELLY });
  }
}

/** A flying bird seen side on: a body, a pale belly and two wings, one raised. */
export function bird(put: Put, x: number, y: number): void {
  stamp(put, x, y, ['w.......w', 'ww.....ww', '.wwBBBww.', '...bBb...'], { w: C.WING, B: C.BIRD, b: C.BELLY });
}

/** Three small gift boxes with ribbons and bows at a tree's foot; x is the tree's trunk column, bottom the ground row. */
export function gifts(put: Put, x: number, bottom: number): void {
  const box = (dx: number, rows: readonly string[], colour: number): void => stamp(put, x + dx, bottom - rows.length + 1, rows, { b: colour, R: C.RED, g: C.BULB, o: C.OUTLINE });
  box(-9, ['.R.R.', '..R..', 'obRbo', 'obRbo', 'obRbo'], C.BLUE);
  box(4, ['.g.g.', '..g..', 'obgbo', 'obgbo', 'ooooo'], C.GREEN);
  box(9, ['.R.R', '..R.', 'bbRb', 'bbRb'], C.RED);
}

/** A five-point star of light on a tree's tip, centred at x. */
export function topStar(put: Put, x: number, y: number): void {
  stamp(put, x - 2, y - 2, ['..g..', '.ggg.', 'ggggg', '.ggg.', '..g..'], { g: C.BULB });
}
