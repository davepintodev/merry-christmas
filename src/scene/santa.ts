// XMAS-32d "The globe", slice 4: Santa with his sleigh and two reindeer
// circling high inside the globe. One flat drawing (santa-trot-1 / -2), squeezed
// across by how far round his orbit he is, mirrored when flying the other way,
// and spread over the fixed grid by the share of each art pixel he covers, so
// his motion never pops. Clipped to the glass; his colours never tint.
import { masterColours } from '../../art/colours.ts';
import { drawings, type Drawing } from '../shared/art.generated.ts';
import { blendShade } from './blend.ts';
import type { SceneLayout } from './frame.ts';
import { projectPoint } from './shapes.ts';

/** The glass's radius the orbit is sized on, in art pixels. */
const GLASS = 56;
/** The orbit's reach: the glass less its rim, and the share of it Santa flies out to. */
const LIMIT = GLASS - 3;
const ORBIT = LIMIT * 0.48;
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
/** Edges this close to a whole art pixel count as on it, and shares this thin count as none. */
const SNAP = 1e-9;

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

function snap(value: number): number {
  const whole = Math.round(value);
  return Math.abs(value - whole) < SNAP ? whole : value;
}

/** The art pixels a span [from, to) overlaps by more than a hair. */
function spans(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = Math.floor(from); p < to; p++) {
    const share = Math.min(to, p + 1) - Math.max(from, p);
    if (share > SNAP) out.push(p);
  }
  return out;
}

function colourOf(n: number): number {
  return Number.parseInt((masterColours[n - 1] ?? '#000000').slice(1), 16);
}

/** Draws Santa into picture (width art pixels across). Throws a RangeError for a non-finite turn or time, before drawing. */
export function drawSanta(picture: Uint32Array, width: number, layout: SceneLayout, turn: number, timeMs: number): void {
  const place = santaPlacement(turn, timeMs);
  const body: Drawing | undefined = drawings[place.trot === 0 ? 'santa-trot-1' : 'santa-trot-2'];
  if (body === undefined) throw new Error('the Santa sheet has no trot drawings');
  const { cx, cy, radius } = layout.globe;
  const span = body.width * place.squeeze;
  const left = snap(cx + place.x - span / 2);
  const top = snap(cy + place.y - body.height / 2);
  // Each picture pixel takes the colours of the drawing pixels under it, by area, over what is there.
  const columns = spans(left, left + span);
  const rows = spans(top, top + body.height);
  for (const py of rows) {
    if (py < 0 || py >= layout.height) continue;
    for (const px of columns) {
      if (px < 0 || px >= width) continue;
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      // The drawing pixels this picture pixel covers, with the picture-pixel area each takes.
      let area = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      const first = Math.max(left, px);
      const last = Math.min(left + span, px + 1);
      const rowFrom = Math.max(top, py);
      const rowTo = Math.min(top + body.height, py + 1);
      for (let sy = Math.floor(rowFrom - top); sy < rowTo - top; sy++) {
        const down = Math.min(rowTo, top + sy + 1) - Math.max(rowFrom, top + sy);
        if (down <= SNAP) continue;
        for (let sx = Math.floor((first - left) / place.squeeze); sx * place.squeeze < last - left; sx++) {
          const across = Math.min(last, left + (sx + 1) * place.squeeze) - Math.max(first, left + sx * place.squeeze);
          if (across <= SNAP) continue;
          const n = body.pixels[sy * body.width + (place.mirrored ? body.width - 1 - sx : sx)] ?? 0;
          if (n === 0) continue;
          const colour = colourOf(n);
          const weight = across * down;
          area += weight;
          red += weight * ((colour >> 16) & 255);
          green += weight * ((colour >> 8) & 255);
          blue += weight * (colour & 255);
        }
      }
      if (area <= SNAP) continue;
      const over = (Math.round(red / area) << 16) | (Math.round(green / area) << 8) | Math.round(blue / area);
      picture[py * width + px] = blendShade(picture[py * width + px] ?? 0, over, area);
    }
  }
}
