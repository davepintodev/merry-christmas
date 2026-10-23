// XMAS-92a "The glass as a layer": the upright glass as its own colour numbers, so the
// page can draw it apart from the picture. The glass is worked out by the same steps
// drawGlobe paints it with (globe.ts paintUprightGlass), so the two agree where it is drawn.
import type { PhaseReading } from '../shared/clock.ts';
import { paintUprightGlass } from './globe.ts';
import type { SceneLayout } from './frame.ts';

/** The glass's colour numbers (0xRRGGBB, row by row from its top left) in a box of art pixels: 0 where the glass paints nothing. */
export interface GlassLayer {
  left: number;
  top: number;
  width: number;
  height: number;
  pixels: Uint32Array;
}

/** The picture the glass is painted on, kept between layers: one picture size asks for the same every time. */
let scratch: Uint32Array<ArrayBuffer> = new Uint32Array(0);

/** The glass at `turn` (radians) in the phase reading, as the globe's circle's box of art pixels, the same as drawGlobe paints it upright. */
export function glassLayer(layout: SceneLayout, phase: PhaseReading, turn: number): GlassLayer {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  const { width, height, globe } = layout;
  const left = Math.max(0, Math.floor(globe.cx - globe.radius));
  const right = Math.min(width - 1, Math.ceil(globe.cx + globe.radius));
  const top = Math.max(0, Math.floor(globe.cy - globe.radius));
  const bottom = Math.min(height - 1, Math.ceil(globe.cy + globe.radius));
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  if (scratch.length < width * height) scratch = new Uint32Array(width * height);
  scratch.fill(0, 0, width * height);
  paintUprightGlass(scratch, width, layout, phase, turn);
  const pixels = new Uint32Array(boxWidth * boxHeight);
  for (let row = 0; row < boxHeight; row++) {
    for (let col = 0; col < boxWidth; col++) pixels[row * boxWidth + col] = scratch[(top + row) * width + left + col] ?? 0;
  }
  return { left, top, width: boxWidth, height: boxHeight, pixels };
}
