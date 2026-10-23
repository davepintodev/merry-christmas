// 2D canvas matrices for the canvas fakes: [a, b, c, d, e, f] as in setTransform.

/** A canvas matrix, [a, b, c, d, e, f]. */
export type Matrix = number[];
/** A point, [x, y]. */
export type Point = [number, number];

/** The matrix that changes nothing. Copy it before changing it. */
export const IDENTITY: readonly number[] = [1, 0, 0, 1, 0, 0];

/** Where a matrix puts a point of its source space (missing entries count as 0). */
export function through(m: readonly number[], x: number, y: number): Point {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}
