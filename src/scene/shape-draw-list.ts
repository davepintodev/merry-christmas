// XMAS-80: the shapes' bodies as an ordered list of draw steps, and a CPU
// renderer that draws the list at any whole zoom. The steps are the same faces
// drawShapes paints, in the same order, so the list at zoom 1 is its bodies.
// XMAS-83: with a time, Santa joins the list as one sprite step, placed among
// the shapes by depth.
import type { Drawing } from '../shared/art.generated.ts';
import type { SceneLayout } from './frame.ts';
import { paintSantaStep } from './santa-step.ts';
import { santaNearness, santaPlacement, santaSprite } from './santa.ts';
import { globeShapes, projectShape, wrapTurn, type GlobeShape } from './shapes.ts';
import { faceAxes, nearness, paintShape, shapesFarFirst, type FaceDraw } from './shapes-draw.ts';

/** Santa as one sprite: his trot drawing, its centre relative to the globe's centre in art units (unrounded), squeezed across and mirrored as he flies. */
export interface SantaDraw {
  sprite: Drawing;
  x: number;
  y: number;
  squeeze: number;
  mirrored: boolean;
}

/** One step of the list: a face of a shape (its drawing, and its top left, top right and bottom left corners in globe-centred art units, and a gable's triangle clip), or Santa. */
export type DrawStep = FaceDraw | SantaDraw;

/**
 * The bodies of `shapes` turned by `turn`, kept per turn so a still picture
 * builds them once: the faces in paint order (far shapes first, each shape's
 * far faces first), and for each shape in that order its nearness and the index
 * of its first face, which is where Santa goes when he is nearer than it. Throws
 * a RangeError for a non-finite turn.
 */
export interface TurnBodies {
  turn: number;
  faces: FaceDraw[];
  shapes: { nearness: number; start: number }[];
}

export function turnBodies(turn: number, shapes: readonly GlobeShape[] = globeShapes): TurnBodies {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  const t = wrapTurn(turn);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const faces: FaceDraw[] = [];
  const starts: { nearness: number; start: number }[] = [];
  for (const shape of shapesFarFirst(shapes, turn)) {
    starts.push({ nearness: nearness(shape, cos, sin), start: faces.length });
    for (const face of [...projectShape(shape, turn)].reverse()) faces.push(faceAxes(face));
  }
  return { turn, faces, shapes: starts };
}

/**
 * The draw list of `bodies`: its faces in order, and with `santaTimeMs` Santa's
 * step spliced in at his depth, after every shape farther back than him and
 * before the rest, never between two faces of one shape. Throws a RangeError
 * for a non-finite time.
 */
export function drawListOf(bodies: TurnBodies, santaTimeMs?: number): DrawStep[] {
  if (santaTimeMs === undefined) return [...bodies.faces];
  const place = santaPlacement(bodies.turn, santaTimeMs);
  // The list is far first, so the first shape nearer than him is where he goes.
  const at = bodies.shapes.findIndex((shape) => shape.nearness >= santaNearness(place));
  const before = at === -1 ? bodies.faces.length : (bodies.shapes[at]?.start ?? bodies.faces.length);
  const santa: SantaDraw = { sprite: santaSprite(place.trot), x: place.x, y: place.y, squeeze: place.squeeze, mirrored: place.mirrored };
  return [...bodies.faces.slice(0, before), santa, ...bodies.faces.slice(before)];
}

/**
 * The bodies of `shapes` (all of globeShapes by default) turned by `turn`, as
 * draw steps in paint order: far shapes first, each shape's far faces first,
 * so a later step covers an earlier one where they overlap. With `santaTimeMs`
 * the list also holds Santa, as one step placed after every shape farther back
 * than him and before the rest, never between two faces of one shape. Throws a
 * RangeError for a non-finite turn or time.
 */
export function shapeDrawList(turn: number, shapes?: readonly GlobeShape[]): FaceDraw[];
export function shapeDrawList(turn: number, shapes: readonly GlobeShape[], santaTimeMs: number): DrawStep[];
export function shapeDrawList(turn: number, shapes: readonly GlobeShape[] = globeShapes, santaTimeMs?: number): DrawStep[] {
  return drawListOf(turnBodies(turn, shapes), santaTimeMs);
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
  for (const step of steps) {
    if ('sprite' in step) paintSantaStep(picture, side, layout, step, zoom);
    else paintShape(picture, side, layout, [step], zoom);
  }
}
