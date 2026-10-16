// XMAS-36b2 "Snow and the stir", slice 3: the outside snow, simulation and drawing.
// Ported from the approved prototype (prototype/snow-behaviour, variant F). The
// outside snow never meets the globe's stir: it falls on its own, the nearer
// flakes faster, and is drawn dimmer, behind the globe. A pure module: a seeded
// generator and the snow's own step count, no Math.random and no clock. One
// stepOutsideSnow call is one 1/60 s step. drawOutsideSnow takes the time in ms.

import type { SceneLayout } from './frame.ts';

export interface OutsideAmounts {
  amount: number;
  fallSpeed: number;
}

export const OUTSIDE_SNOW: { ordinary: OutsideAmounts; christmasDay: OutsideAmounts } = {
  ordinary: { amount: 2.5, fallSpeed: 1.3 },
  christmasDay: { amount: 4, fallSpeed: 1.5 },
};

/** Art px; d is depth (0 far, 1 near), v is px/s, p is the tumble phase. */
export interface OutsideFlake {
  x: number;
  y: number;
  v: number;
  d: number;
  p: number;
}

export interface OutsideSnow {
  readonly flakes: OutsideFlake[];
}

/** One flake per this many art px of picture, times the amount. */
const PIXELS_PER_FLAKE = 700;
const STEP_SECONDS = 1 / 60;
/** The sway per step, in px: sin(time + v) over 30. */
const SWAY = 1 / 30;
/** A flake below this row (px) wraps back to the top. */
const WRAP_BELOW = 2;
/** The dim colours the flakes blend toward: sky, then ground from the ground line down (the default: Purple night's). */
const SKY_FLAKE = 0x8f8ad0;
const GROUND_FLAKE = 0xb9c3ee;
/** The two flake colours a picture draws with (XMAS-57: by day they are pale, not the night's violet). */
export interface FlakeColours { sky: number; ground: number }
/** A sparkle's four tips draw at this share of the flake's full colour. */
const TIP_SHARE = 0.4;
/** Depth above which a flake tumbles between a plus and an X, and above which it sparkles. */
const TUMBLE_FROM = 2 / 3;
const SPARKLE_FROM = 0.93;
/** Shape swaps a second, as the prototype runs them. */
const TUMBLE_RATE = 2.5;
/**
 * A snow that createOutsideSnow did not make (a hand-built {flakes} object) has no picture size, so stepping
 * it wraps and spreads its flakes on this 240 x 180 picture. Only tests build such snows; the page always
 * makes its snow with createOutsideSnow.
 */
const HAND_BUILT = { width: 240, height: 180 };

/** Offsets from a flake's pixel, each with its share of the flake's alpha: the centre, a plus, an X, a sparkle. */
type Shape = readonly (readonly [number, number, number])[];
const SINGLE: Shape = [[0, 0, 1]];
const PLUS: Shape = [[0, 0, 1], [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1]];
const CROSS: Shape = [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]];
const SPARKLE: Shape = [
  ...PLUS,
  [-2, 0, TIP_SHARE],
  [2, 0, TIP_SHARE],
  [0, -2, TIP_SHARE],
  [0, 2, TIP_SHARE],
];

/** The state the snow keeps beside its flakes: the picture it is for, the day, the generator and the step count. */
interface Sim {
  width: number;
  height: number;
  christmasDay: boolean;
  /** Mulberry32 state. */
  seed: number;
  steps: number;
}

const sims = new WeakMap<OutsideSnow, Sim>();

/** A small seeded generator (mulberry32, as in snow.ts), so the same seed always gives the same snow. */
function random(sim: Sim): number {
  sim.seed = (sim.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(sim.seed ^ (sim.seed >>> 15), 1 | sim.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function simOf(snow: OutsideSnow): Sim {
  let sim = sims.get(snow);
  if (sim === undefined) {
    sim = { ...HAND_BUILT, christmasDay: false, seed: 0, steps: 0 };
    sims.set(snow, sim);
  }
  return sim;
}

function amountsOf(sim: Sim): OutsideAmounts {
  return sim.christmasDay ? OUTSIDE_SNOW.christmasDay : OUTSIDE_SNOW.ordinary;
}

function countOf(sim: Sim): number {
  return Math.round(((sim.width * sim.height) / PIXELS_PER_FLAKE) * amountsOf(sim).amount);
}

/** A new flake, anywhere over the picture. */
function newFlake(sim: Sim): OutsideFlake {
  const x = random(sim) * sim.width;
  const y = random(sim) * sim.height;
  const v = 3 + random(sim) * 5;
  const d = random(sim);
  const p = random(sim) * 2 * Math.PI;
  return { x, y, v, d, p };
}

export function createOutsideSnow(seed: number, width: number, height: number, christmasDay: boolean): OutsideSnow {
  if (!(Number.isFinite(width) && width >= 0 && Number.isFinite(height) && height >= 0)) {
    throw new RangeError(`a picture needs a size of 0 or more, got ${width} x ${height}`);
  }
  const snow: OutsideSnow = { flakes: [] };
  const sim: Sim = { width, height, christmasDay, seed: seed >>> 0, steps: 0 };
  sims.set(snow, sim);
  for (let i = countOf(sim); i > 0; i--) snow.flakes.push(newFlake(sim));
  return snow;
}

export function stepOutsideSnow(snow: OutsideSnow): void {
  const sim = simOf(snow);
  const { fallSpeed } = amountsOf(sim);
  const time = sim.steps * STEP_SECONDS;
  for (const f of snow.flakes) {
    f.y += f.v * (0.5 + f.d) * fallSpeed * STEP_SECONDS;
    f.x += Math.sin(time + f.v) * SWAY;
    if (f.y > sim.height + WRAP_BELOW) {
      f.y = -WRAP_BELOW;
      f.x = random(sim) * sim.width;
    }
  }
  sim.steps++;
}

export function setOutsideChristmasDay(snow: OutsideSnow, on: boolean): void {
  const sim = simOf(snow);
  sim.christmasDay = on;
  // Added flakes fall from random places; removed ones come from the end, so the rest keep their place.
  const count = countOf(sim);
  while (snow.flakes.length > count) snow.flakes.pop();
  while (snow.flakes.length < count) snow.flakes.push(newFlake(sim));
}

/** The plus or the X a tumbling flake shows at `time` (ms): the swap runs off the flake's own phase, so flakes do not switch together. */
function tumbleShape(f: OutsideFlake, time: number): Shape {
  return Math.floor((time / 1000) * TUMBLE_RATE + f.p) % 2 === 1 ? PLUS : CROSS;
}

/** Mixes one colour over a picture pixel by alpha; anything outside the picture is skipped. */
function blendPixel(picture: Uint32Array, width: number, height: number, x: number, y: number, colour: number, alpha: number): void {
  if (!(x >= 0 && x < width && y >= 0 && y < height)) return;
  const i = y * width + x;
  const under = picture[i] ?? 0;
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const u = (under >> shift) & 255;
    const c = (colour >> shift) & 255;
    out = (out << 8) | Math.round(u + (c - u) * alpha);
  }
  picture[i] = out;
}

/** The flakes over the picture, behind the globe: a single pixel, or a plus and an X for the tumblers, and a sparkle for the nearest. */
export function drawOutsideSnow(
  picture: Uint32Array,
  width: number,
  layout: SceneLayout,
  snow: OutsideSnow,
  time: number,
  flakeColours: FlakeColours = { sky: SKY_FLAKE, ground: GROUND_FLAKE },
): void {
  for (const f of snow.flakes) {
    const x = Math.floor(f.x);
    const y = Math.floor(f.y);
    const colour = y >= layout.groundTop ? flakeColours.ground : flakeColours.sky;
    const shape = f.d > SPARKLE_FROM ? SPARKLE : f.d > TUMBLE_FROM ? tumbleShape(f, time) : SINGLE;
    for (const [dx, dy, share] of shape) {
      blendPixel(picture, width, layout.height, x + dx, y + dy, colour, share);
    }
  }
}
