// The pixel buffers, colour words and the lean's shear the fine layer and Santa's sprite share, kept apart so
// that neither module imports the other.
import type { CanvasCalls } from './frame-trace.ts';

/** An image of one size for a layer, and a 32-bit view of its bytes; kept while the size holds. */
export interface Pixels {
  image: ImageData;
  words: Uint32Array;
}

/** A colour number (0xRRGGBB) as the little-endian word of an opaque RGBA pixel. */
export function opaqueWord(colour: number): number {
  return 0xff000000 | ((colour & 0xff) << 16) | (colour & 0xff00) | ((colour >> 16) & 0xff);
}

/** The lean as a shear of a box's device pixels (XMAS-90): a point at device row Y moves lean × (height − Y) across, `height` being the box's height in device pixels. */
export interface Shear {
  lean: number;
  height: number;
}

/** A canvas transform: a, b, c, d, e, f, as setTransform takes them. */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * Sets the context's transform to `matrix`, with `shear` in front of it: a point goes through the matrix and then through
 * the shear, so what is drawn or clipped after it leans, the ground line (the box's bottom) staying put. At lean 0, or with
 * the identity matrix, the shear is the identity. The two are multiplied out here and set as one matrix, so no transform()
 * call is needed. With `tally` (XMAS-113) the call is timed and counted in it; without, nothing is read.
 */
export function setShear(ctx: CanvasRenderingContext2D, { lean, height }: Shear, [a, b, c, d, e, f]: Matrix = IDENTITY, tally?: CanvasCalls): void {
  const at = tally === undefined ? 0 : performance.now();
  // A point (x, y) goes to (a x + c y + e, b x + d y + f), and the shear then takes its x to x − lean × y + lean × height.
  ctx.setTransform(a - lean * b, b, c - lean * d, d, e - lean * f + lean * height, f);
  if (tally !== undefined) {
    tally.setTransforms += 1;
    tally.setTransformMs += performance.now() - at;
  }
}

/** ctx.save(), timed and counted in `tally` when there is one (XMAS-113). */
export function saveCanvas(ctx: CanvasRenderingContext2D, tally?: CanvasCalls): void {
  const at = tally === undefined ? 0 : performance.now();
  ctx.save();
  if (tally !== undefined) {
    tally.saves += 1;
    tally.saveMs += performance.now() - at;
  }
}

/** ctx.restore(), timed with the saves in `tally` when there is one (XMAS-113). */
export function restoreCanvas(ctx: CanvasRenderingContext2D, tally?: CanvasCalls): void {
  const at = tally === undefined ? 0 : performance.now();
  ctx.restore();
  if (tally !== undefined) {
    tally.restores += 1;
    tally.saveMs += performance.now() - at;
  }
}
