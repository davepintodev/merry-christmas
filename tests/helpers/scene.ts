// Small scene helpers shared by the scene tests: reading a picture, master colours as numbers and drawing over two plain backgrounds.
import { masterColours } from '../../art/colours.ts';
import type { Drawing } from '../../src/shared/art.generated.ts';
import type { SceneFrame, SceneLayout } from '../../src/scene/frame.ts';

/** The colour at (x, y) in a frame's picture, or -1 outside it. */
export function at(f: SceneFrame, x: number, y: number): number {
  return f.picture[y * f.width + x] ?? -1;
}

/** `#rrggbb` as a number. */
export function hexNum(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/** A drawing's colour at (x, y) as a number, or -1 where it is transparent (or outside it). */
export function colourAt(d: Drawing, x: number, y: number): number {
  const n = d.pixels[y * d.width + x] ?? 0;
  return n === 0 ? -1 : hexNum(masterColours[n - 1] ?? '#000000');
}

/** The two plain backgrounds: nothing drawn shows the same colour over both. */
export const FILL_A = 0x010203;
export const FILL_B = 0xfdfcfb;

/** One drawing over each plain background. */
export interface Drawn { a: Uint32Array; b: Uint32Array; layout: SceneLayout; width: number }

/** Runs `draw` once over a picture filled with FILL_A and once over one filled with FILL_B. */
export function overPlain(layout: SceneLayout, draw: (pic: Uint32Array, width: number) => void): Drawn {
  const width = layout.width;
  const a = new Uint32Array(width * layout.height).fill(FILL_A);
  const b = new Uint32Array(width * layout.height).fill(FILL_B);
  draw(a, width);
  draw(b, width);
  return { a, b, layout, width };
}

/** Wholly covered: the same colour over both backgrounds. */
export const solid = (d: Drawn, i: number): boolean => d.a[i] === d.b[i] && d.a[i] !== FILL_A;

/** Untouched: each background shows. */
export const bare = (d: Drawn, i: number): boolean => d.a[i] === FILL_A && d.b[i] === FILL_B;
