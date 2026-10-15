// XMAS-32d "The globe", slice 4: Santa with his sleigh and two reindeer
// circling high inside the globe. One flat drawing (santa-trot-1 / -2), squeezed
// across by how far round his orbit he is, mirrored when flying the other way,
// and spread over the fixed grid by the share of each art pixel he covers, so
// his motion never pops. Clipped to the glass; his colours never tint.
import { drawings, type Drawing } from '../shared/art.generated.ts';
import type { SceneLayout } from './frame.ts';
import { paintSantaStep } from './santa-step.ts';
import type { SantaDraw } from './shape-draw-list.ts';
import { projectPoint } from './shapes.ts';

/** The glass's radius the orbit is sized on, in art pixels. */
const GLASS = 56;
/** The orbit's reach: the glass less its rim, and the share of it Santa flies out to. */
const LIMIT = GLASS - 3;
const ORBIT = LIMIT * 0.42;
/** How high Santa flies, up from the globe's centre. */
const HEIGHT = GLASS * 0.46;
/** Radians a second round the orbit, and the bob's rate and reach. */
const SPEED = 0.45;
const BOB_RATE = 1.3;
const BOB = 2;
/** Trot frames a second. */
const TROT_RATE = 7;
/** The narrowest he is squeezed: never so thin he vanishes. */
const MIN_SQUEEZE = 0.3;
/** A step towards the visitor moves a floor point this far down, as the shapes tilt it. */
const TILT = projectPoint(0, 1, 0, 0)[1] - projectPoint(0, 0, 0, 0)[1];

export interface SantaPlacement {
  /** Round the orbit, in radians; its sine is the depth. */
  angle: number;
  /** Relative to the globe's centre, in art pixels (x right, y down). */
  x: number;
  y: number;
  /** -1 (far side) to 1 (near side). */
  depth: number;
  /** The share of his width he shows, from 0.3 to 1. */
  squeeze: number;
  /** Whether he flies towards the left, drawn the other way round. */
  mirrored: boolean;
  /** Which trot frame: 0 or 1. */
  trot: 0 | 1;
}

/** Where Santa flies at `turn` and `timeMs`. Throws a RangeError for a non-finite turn or time. */
export function santaPlacement(turn: number, timeMs: number): SantaPlacement {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  if (!Number.isFinite(timeMs)) throw new RangeError(`time must be a finite number of milliseconds, got ${timeMs}`);
  const t = timeMs / 1000;
  const angle = 2 + turn + t * SPEED;
  const depth = Math.sin(angle);
  return {
    angle,
    x: Math.cos(angle) * ORBIT,
    y: -HEIGHT + Math.sin(t * BOB_RATE) * BOB + depth * ORBIT * TILT,
    depth,
    squeeze: Math.max(MIN_SQUEEZE, Math.abs(depth)),
    mirrored: depth > 0,
    trot: (Math.floor(t * TROT_RATE) % 2) as 0 | 1,
  };
}

/** Santa's depth as the shapes measure theirs (their nearness along the turn, in art pixels): his orbit's reach times his depth. */
export function santaNearness(place: SantaPlacement): number {
  return place.depth * ORBIT;
}

/** The trot drawing Santa shows: santa-trot-1 or santa-trot-2. Throws a plain Error if the sheet lacks it. */
export function santaSprite(trot: 0 | 1): Drawing {
  const body: Drawing | undefined = drawings[trot === 0 ? 'santa-trot-1' : 'santa-trot-2'];
  if (body === undefined) throw new Error('the Santa sheet has no trot drawings');
  return body;
}

/** Draws Santa into picture (width art pixels across), as the one step paintSantaStep paints at zoom 1. Throws a RangeError for a non-finite turn or time, before drawing. */
export function drawSanta(picture: Uint32Array, width: number, layout: SceneLayout, turn: number, timeMs: number): void {
  const place = santaPlacement(turn, timeMs);
  const step: SantaDraw = { sprite: santaSprite(place.trot), x: place.x, y: place.y, squeeze: place.squeeze, mirrored: place.mirrored };
  paintSantaStep(picture, width, layout, step, 1);
}
