// XMAS-84 "Snow inside the glass on the fine layer": the globe's flakes as an
// ordered list of draw steps, and a CPU renderer that puts them on the screen's
// pixel grid at any whole zoom. The flakes behind the glass centre (z <= 0) are
// drawn before Santa and the shapes, the ones in front (z > 0) after them. A
// flake sits partway between its last two steps, as the turn does (XMAS-79).
// Resting flakes lie on the floor disc: each is drawn at y + z * 0.3. Nothing
// here reads the clock or randomness: the time comes in as input.
import type { SceneLayout } from './frame.ts';
import { GLASS_LIMIT, type Flake, type GlobeSnow } from './snow.ts';

/** One flake's drawing: where its centre is, its colour, the pixels it covers from its own pixel, and its depth. */
export interface SnowStep {
  /** The centre in art px from the globe centre, not floored. */
  x: number;
  y: number;
  colour: number;
  /** Offsets from the flake's own pixel: [0, 0] alone, or the five of a plus or an X. */
  shape: readonly (readonly [number, number])[];
  /** The flake's z: the depth it is judged by, toward the viewer. */
  depth: number;
}

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
/** A resting flake lies this far down the screen per unit of its depth z. */
const REST_DEPTH = 0.3;
/** A flake that moved this far in one step (art px) was restarted, so it is drawn where it is, not swept across the glass. */
const JUMP_LIMIT = 40;
/** Offsets from a flake's pixel: the centre alone, a plus (centre and four orthogonal arms), and an X (centre and four diagonal arms). */
type Shape = readonly (readonly [number, number])[];
const SINGLE: Shape = [[0, 0]];
const PLUS: Shape = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
const CROSS: Shape = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/** A flake tumbles only while it is free, and only in the nearest share of the depth. */
function tumbles(f: Flake): boolean {
  return !f.resting && f.z > TUMBLE_FROM;
}

/** The plus or the X a tumbling flake shows at `time` (ms): the swap runs off the flake's own phase, so flakes do not switch together. */
function tumbleShape(f: Flake, time: number): Shape {
  const step = Math.floor((time / 1000) * TUMBLE_RATE + f.phase);
  return step % 2 === 0 ? CROSS : PLUS;
}

/** Where a flake is drawn: a resting flake lies lower on the screen the deeper it is. */
function placeY(f: Flake): number {
  return f.resting ? f.y + f.z * REST_DEPTH : f.y;
}

/**
 * Sets `step`'s centre `fraction` of the way from the flake's previous step to
 * its current one (clamped to 0 to 1). With no previous flake, one that changed
 * its resting state, or one that moved JUMP_LIMIT or more, it is the current place.
 */
function blendInto(step: SnowStep, f: Flake, previous: Flake | undefined, fraction: number): void {
  const nowY = placeY(f);
  step.x = f.x;
  step.y = nowY;
  if (previous === undefined || previous.resting !== f.resting) return;
  const wasY = placeY(previous);
  if (Math.hypot(f.x - previous.x, nowY - wasY) >= JUMP_LIMIT) return;
  const t = Math.min(1, Math.max(0, fraction));
  step.x = previous.x + (f.x - previous.x) * t;
  step.y = wasY + (nowY - wasY) * t;
}

/**
 * The flakes on one side of the glass centre as draw steps, in flake order:
 * 'behind' takes z <= 0 and 'front' z > 0, each judged on its current z.
 * `previous` is the snow as the last step before this one left it (its flakes
 * matched by index); `fraction` says how far between the two to draw. Only
 * tumbling flakes change shape, by `time` (ms). Throws nothing; the stir plays
 * no part in the drawing. `into`, when given, is the list written and returned,
 * its step objects reused, so a frame makes none anew.
 */
export function snowDrawList(snow: GlobeSnow, previous: GlobeSnow | undefined, fraction: number, side: 'behind' | 'front', time = 0, into: SnowStep[] = []): SnowStep[] {
  const colour = side === 'behind' ? BEHIND : WHITE;
  let count = 0;
  snow.flakes.forEach((f, i) => {
    if (side === 'behind' ? f.z > 0 : f.z <= 0) return;
    const step = into[count] ?? { x: 0, y: 0, colour, shape: SINGLE, depth: 0 };
    blendInto(step, f, previous?.flakes[i], fraction);
    step.colour = colour;
    step.shape = tumbles(f) ? tumbleShape(f, time) : SINGLE;
    step.depth = f.z;
    into[count++] = step;
  });
  into.length = count;
  return into;
}

/** Writes one colour to a picture pixel; anything outside the picture is skipped. */
function put(picture: Uint32Array, width: number, height: number, x: number, y: number, colour: number): void {
  if (!(x >= 0 && x < width && y >= 0 && y < height)) return;
  picture[y * width + x] = colour;
}

/**
 * Draws `steps` in order over `picture`, which is `width` art pixels across at
 * `zoom` picture pixels to each art pixel, so `width * zoom` wide, and the
 * layout's height at the same zoom. A step's centre lands on the picture pixel
 * floor(centre * zoom) of the globe, so at zoom 1 it is the art pixel
 * floor(centre + x), and at a larger zoom it sits on the zoom grid inside its
 * art pixel. Its shape's offsets are taken at the same zoom. Later steps cover
 * earlier ones; anything off the picture is skipped. Throws a RangeError for a
 * zoom that is not a whole number of at least 1, or a picture of the wrong size.
 */
export function renderSnowSteps(picture: Uint32Array, width: number, layout: SceneLayout, steps: readonly SnowStep[], zoom: number, size = 1): void {
  if (!Number.isInteger(zoom) || zoom < 1) throw new RangeError(`zoom must be a whole number of at least 1, got ${zoom}`);
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`size must be a whole number of at least 1, got ${size}`);
  const side = width * zoom;
  const rows = layout.height * zoom;
  if (picture.length !== side * rows) throw new RangeError(`picture must hold ${side * rows} colour numbers, got ${picture.length}`);
  const { cx, cy } = layout.globe;
  // Squares bigger than a pixel space their arms by their side so they stay joined.
  const reach = size > 1 ? size : zoom;
  for (const step of steps) {
    const x = Math.floor((cx + step.x) * zoom);
    const y = Math.floor((cy + step.y) * zoom);
    for (const [dx, dy] of step.shape) {
      const px = x + dx * reach;
      const py = y + dy * reach;
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) put(picture, side, rows, px + i, py + j, step.colour);
    }
  }
}

/** Screen pixels to a flake's side: two at zoom 1, otherwise the zoom, at least four. */
export function flakeSize(zoom: number): number {
  if (!Number.isInteger(zoom) || zoom < 1) throw new RangeError(`zoom must be a whole number of at least 1, got ${zoom}`);
  return zoom === 1 ? 2 : Math.max(4, zoom);
}
