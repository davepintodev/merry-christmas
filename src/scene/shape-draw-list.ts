// XMAS-80: the shapes' bodies as an ordered list of draw steps, and a CPU
// renderer that draws the list at any whole zoom. The steps are the same faces
// drawShapes paints, in the same order, so the list at zoom 1 is its bodies.
import type { SceneLayout } from './frame.ts';
import { globeShapes, projectShape, type GlobeShape } from './shapes.ts';
import { faceAxes, paintShape, shapesFarFirst, type FaceDraw } from './shapes-draw.ts';

/** One face's drawing: its sheet, its top left, top right and bottom left corners in globe-centred art units, and a gable's triangle clip. */
export type DrawStep = FaceDraw;

/**
 * The bodies of `shapes` (all of globeShapes by default) turned by `turn`, as
 * draw steps in paint order: far shapes first, each shape's far faces first,
 * so a later step covers an earlier one where they overlap. Throws a
 * RangeError for a non-finite turn.
 */
export function shapeDrawList(turn: number, shapes: readonly GlobeShape[] = globeShapes): DrawStep[] {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  return shapesFarFirst(shapes, turn).flatMap((shape) => [...projectShape(shape, turn)].reverse().map((face) => faceAxes(face)));
}

/**
 * Draws `steps` in order over `picture`, which is `width` art pixels across
 * at `zoom` picture pixels to each art pixel, so `width * zoom` wide, with
 * the globe centred on layout.globe. Each drawing pixel becomes a zoom x zoom
 * block, sampled at the block's pixel centres, so the centre pixel of every
 * block is the zoom 1 picture. Throws a RangeError for a zoom that is not a
 * whole number of at least 1, or a picture of the wrong size.
 */
export function renderDrawList(picture: Uint32Array, width: number, layout: SceneLayout, steps: readonly DrawStep[], zoom: number): void {
  if (!Number.isInteger(zoom) || zoom < 1) throw new RangeError(`zoom must be a whole number of at least 1, got ${zoom}`);
  const side = width * zoom;
  const size = side * layout.height * zoom;
  if (picture.length !== size) throw new RangeError(`picture must hold ${size} colour numbers, got ${picture.length}`);
  // Each step paints over what the steps before it left, so a near face covers a far one.
  for (const step of steps) paintShape(picture, side, layout, [step], zoom);
}
