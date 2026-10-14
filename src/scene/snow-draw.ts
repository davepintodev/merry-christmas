// XMAS-36b1 "Snow and the stir", slice 2: drawing the globe snow. Every flake is
// a whole art pixel at floor(globe centre + x, globe centre + y). Flakes behind
// the centre (z <= 0) are a dimmer blue and are drawn on the glass, so the
// objects cover them; flakes in front are white and drawn last, over the
// objects and reflections. The nearest free flakes tumble between a plus and
// an X. Nothing here reads the clock or randomness: the time comes in as input.
// The stir plays no part in the drawing; the simulation has already moved the flakes.
import type { SceneLayout } from './frame.ts';
import { GLASS_LIMIT, type Flake, type GlobeSnow } from './snow.ts';

/** A flake behind the glass centre: the master list's dim blue, darker than white. */
const BEHIND = 0xaebcf0;
const WHITE = 0xffffff;
/**
 * The nearest share of the depth tumbles: the top 7% of the snow's depth,
 * measured across the snow limit (GLASS_LIMIT, 53 art px either side of the
 * centre, so 106 across), not the glass radius of 56. The threshold is
 * z > 53 - 0.07 * 106 = 45.6.
 */
const TUMBLE_SHARE = 0.07;
const TUMBLE_FROM = GLASS_LIMIT * (1 - 2 * TUMBLE_SHARE);
/**
 * Shape swaps a second, as the approved prototype runs them: 2.5 swaps is one
 * plus-to-X change every 0.4 s, so a full plus, X, plus cycle takes 0.8 s
 * (1.25 cycles a second). Read "two and a half times a second" as swaps.
 */
const TUMBLE_RATE = 2.5;
/** Offsets from a flake's pixel: the centre alone, a plus (centre and four orthogonal arms), and an X (centre and four diagonal arms). */
type Shape = readonly (readonly [number, number])[];
const SINGLE: Shape = [[0, 0]];
const PLUS: Shape = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
const CROSS: Shape = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/** Writes one colour to a picture pixel; anything outside the picture (or not a number) is skipped. */
function put(picture: Uint32Array, width: number, height: number, x: number, y: number, colour: number): void {
  if (!(x >= 0 && x < width && y >= 0 && y < height)) return;
  picture[y * width + x] = colour;
}

/** The art pixel a flake's centre lands on: floor(globe centre + offset) on each axis. */
function pixelOf(layout: SceneLayout, f: Flake): [number, number] {
  return [Math.floor(layout.globe.cx + f.x), Math.floor(layout.globe.cy + f.y)];
}

/** A flake tumbles only while it is free, and only in the nearest share of the depth. */
function tumbles(f: Flake): boolean {
  return !f.resting && f.z > TUMBLE_FROM;
}

/** The plus or the X a tumbling flake shows at `time` (ms): the swap runs off the flake's own phase, so flakes do not switch together. */
function tumbleShape(f: Flake, time: number): Shape {
  const step = Math.floor((time / 1000) * TUMBLE_RATE + f.phase);
  return step % 2 === 0 ? CROSS : PLUS;
}

/** The flakes behind the glass centre, one dim pixel each, drawn on the glass before the objects. */
export function drawSnowBehind(picture: Uint32Array, width: number, layout: SceneLayout, snow: GlobeSnow): void {
  for (const f of snow.flakes) {
    if (f.z > 0) continue;
    const [x, y] = pixelOf(layout, f);
    put(picture, width, layout.height, x, y, BEHIND);
  }
}

/** The flakes in front of the glass centre, white, drawn last: a single pixel, or a plus and an X for the nearest free ones. */
export function drawSnowFront(picture: Uint32Array, width: number, layout: SceneLayout, snow: GlobeSnow, time: number): void {
  for (const f of snow.flakes) {
    if (f.z <= 0) continue;
    const [x, y] = pixelOf(layout, f);
    const shape = tumbles(f) ? tumbleShape(f, time) : SINGLE;
    for (const [dx, dy] of shape) put(picture, width, layout.height, x + dx, y + dy, WHITE);
  }
}
