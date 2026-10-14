// XMAS-36a "Snow and the stir", slice 1: the globe-snow simulation (spec
// 8.1-8.3). Ported from the approved prototype (prototype/snow-behaviour).
// A pure module: no Math.random, no clock. One stepGlobeSnow call is one 1/60 s
// step. Coordinates are art px relative to the globe centre, y grows downward,
// z > 0 is toward the viewer.

export interface SnowAmounts {
  flakes: number;
  airShare: number;
  /** Art px per second. */
  fallSpeed: number;
}

export const GLOBE_SNOW: { ordinary: SnowAmounts; christmasDay: SnowAmounts } = {
  ordinary: { flakes: 340, airShare: 0.3, fallSpeed: 6.5 },
  christmasDay: { flakes: 500, airShare: 0.5, fallSpeed: 6.5 },
};

export const SNOW_SETTINGS: {
  radius: number;
  settleSeconds: number;
  swirlLag: number;
  turbulence: number;
  settleBelow: number;
  throwAbove: number;
  maxStir: number;
} = {
  radius: 56,
  settleSeconds: 6.5,
  swirlLag: 1.3,
  turbulence: 60,
  settleBelow: 0.25,
  throwAbove: 0.12,
  maxStir: 1.6,
};

/** z > 0 is toward the viewer; y grows downward; relative to the globe centre. */
export interface Flake {
  x: number;
  y: number;
  z: number;
  resting: boolean;
  phase: number;
}

export interface GlobeSnow {
  readonly flakes: readonly Flake[];
  stir: number;
}

export interface SnowInput {
  /** Absolute globe angle, radians. */
  turn: number;
  /** Added to stir this step, 0 and up. */
  raise: number;
  /** Impulse in px/s. */
  push: { x: number; y: number; z: number };
}

const STEP_SECONDS = 1 / 60;
/** The snow stays this far inside the glass. */
export const GLASS_LIMIT = SNOW_SETTINGS.radius - 3;
/** The floor line sits this share of the radius below the centre. */
const FLOOR_Y = Math.round(SNOW_SETTINGS.radius * 0.45);
/** A lying flake's centre sits one px above the floor line. */
const REST_Y = FLOOR_Y - 1;
/** The stir fades by e^-3 over settleSeconds. */
const SETTLE_E_FOLDS = 3;
/** Side-to-side sway, and how fast a stirred air flake rises per unit of stir, in px/s. */
const SWAY = 2.5;
const RISE_PER_STIR = 20;
/** A lying flake lifts off with a chance of stir x this, a second. */
const LIFT_CHANCE_PER_STIR = 4;
const LIFT_SPREAD = 50;
const LIFT_SPEED = 90;
/** Each air flake's own fall pace, a share of the fall speed. */
const PACE_MIN = 0.6;
const PACE_SPREAD = 0.8;
/** Air velocity eases toward its target this many times a second. */
const VELOCITY_EASE = 4;
/** Share of the stir from the water spinning past the flakes. */
const STIR_FROM_SPIN = 0.12;
/** The water's spin catches up with the globe this many times a second. */
const SWIRL_EASE = 2.5;
/** A push fades by e^-3 a second. */
const SLOSH_DECAY = 3;
const GLASS_BOUNCE = 0.4;
const FLOOR_BOUNCE = 0.4;
/** Restarts: a share of the shortfall a second, from the upper dome. */
const RESTART_RATE = 0.8;
const RESTART_TRIES = 40;
const DOME_SPREAD = 0.8;
const DOME_DEPTH = 0.1;

interface Motion {
  vx: number;
  vy: number;
  vz: number;
  /** Multiplies the fall speed for this flake. */
  pace: number;
}

interface Sim {
  /** The same array as the globe's flakes. */
  flakes: Flake[];
  /** Parallel to flakes. */
  motion: Motion[];
  christmasDay: boolean;
  /** Mulberry32 state. */
  seed: number;
  steps: number;
  /** The last turn seen; null until the first step. */
  turn: number | null;
  /** The water's spin, rad/s. */
  swirl: number;
  slosh: { x: number; y: number; z: number };
}

const sims = new WeakMap<GlobeSnow, Sim>();

/** A small seeded generator (mulberry32), so the same seed always gives the same snow. */
function random(sim: Sim): number {
  sim.seed = (sim.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(sim.seed ^ (sim.seed >>> 15), 1 | sim.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function simOf(snow: GlobeSnow): Sim {
  const sim = sims.get(snow);
  if (!sim) throw new Error('not a globe made by createGlobeSnow');
  return sim;
}

/** Adds one flake: lying on the floor, or in the air anywhere above it. */
function addFlake(sim: Sim, inAir: boolean, fallSpeed: number): void {
  const a = random(sim) * 2 * Math.PI;
  let y = REST_Y;
  let reach = Math.sqrt(GLASS_LIMIT ** 2 - REST_Y ** 2);
  if (inAir) {
    y = -GLASS_LIMIT + random(sim) * (REST_Y + GLASS_LIMIT);
    reach = Math.sqrt(GLASS_LIMIT ** 2 - y * y);
  }
  const r = Math.sqrt(random(sim)) * reach;
  const phase = random(sim) * 2 * Math.PI;
  const pace = PACE_MIN + random(sim) * PACE_SPREAD;
  sim.flakes.push({ x: r * Math.cos(a), y, z: r * Math.sin(a), resting: !inAir, phase });
  // An air flake starts already falling at its own pace, so it does not speed up from rest.
  sim.motion.push({ vx: 0, vy: inAir ? fallSpeed * pace : 0, vz: 0, pace });
}

/** A lying flake starts again from the top of the dome. */
function restart(sim: Sim, i: number): void {
  const f = sim.flakes[i];
  const a = random(sim) * 2 * Math.PI;
  const r = Math.sqrt(random(sim)) * GLASS_LIMIT * DOME_SPREAD;
  const top = -Math.sqrt(GLASS_LIMIT ** 2 - r * r) + 1;
  f.x = r * Math.cos(a);
  f.z = r * Math.sin(a);
  f.y = top + random(sim) * (REST_Y - top) * DOME_DEPTH;
  f.resting = false;
  const m = sim.motion[i];
  m.vx = 0;
  m.vy = 0;
  m.vz = 0;
}

/** An angle wrapped into [-pi, pi]. */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** Turns a flake about the upright axis by angle (radians). */
function spin(f: Flake, angle: number): void {
  if (angle === 0) return;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = f.x;
  f.x = x * c - f.z * s;
  f.z = x * s + f.z * c;
}

export function createGlobeSnow(seed: number, christmasDay: boolean): GlobeSnow {
  const flakes: Flake[] = [];
  const snow: GlobeSnow = { flakes, stir: 0 };
  const sim: Sim = {
    flakes,
    motion: [],
    christmasDay,
    seed: seed >>> 0,
    steps: 0,
    turn: null,
    swirl: 0,
    slosh: { x: 0, y: 0, z: 0 },
  };
  sims.set(snow, sim);
  const amounts = christmasDay ? GLOBE_SNOW.christmasDay : GLOBE_SNOW.ordinary;
  const airTarget = Math.round(amounts.flakes * amounts.airShare);
  for (let i = 0; i < amounts.flakes; i++) addFlake(sim, i < airTarget, amounts.fallSpeed);
  return snow;
}

export function stepGlobeSnow(snow: GlobeSnow, input: SnowInput): void {
  const sim = simOf(snow);
  const { turn, raise, push } = input;
  // Everything is checked before anything changes, so a bad input leaves the snow as it was.
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be finite, got ${turn}`);
  if (!Number.isFinite(raise) || raise < 0) throw new RangeError(`raise must be 0 or more, got ${raise}`);
  if (!Number.isFinite(push.x) || !Number.isFinite(push.y) || !Number.isFinite(push.z)) {
    throw new RangeError('push must be finite');
  }
  const amounts = sim.christmasDay ? GLOBE_SNOW.christmasDay : GLOBE_SNOW.ordinary;
  const t = sim.steps * STEP_SECONDS;

  // The globe's spin, and the water's lag behind it. The first step is the baseline, so it gives no spin.
  // The change is wrapped into [-pi, pi], so a turn that crosses pi is not a spin the other way round.
  const omega = sim.turn === null ? 0 : wrapAngle(turn - sim.turn) / STEP_SECONDS;
  sim.turn = turn;
  const shear = omega - sim.swirl;
  sim.swirl += shear * Math.min(1, STEP_SECONDS * SWIRL_EASE);

  const stirFade = Math.exp((-SETTLE_E_FOLDS * STEP_SECONDS) / SNOW_SETTINGS.settleSeconds);
  snow.stir =
    Math.min(SNOW_SETTINGS.maxStir, snow.stir + raise + Math.abs(shear) * STEP_SECONDS * STIR_FROM_SPIN * SNOW_SETTINGS.swirlLag) *
    stirFade;
  const stir = snow.stir;

  sim.slosh.x += push.x;
  sim.slosh.y += push.y;
  sim.slosh.z += push.z;

  const tb = stir * SNOW_SETTINGS.turbulence;
  const ease = Math.min(1, STEP_SECONDS * VELOCITY_EASE);
  const turnAir = sim.swirl * SNOW_SETTINGS.swirlLag * STEP_SECONDS;
  const turnRest = omega * STEP_SECONDS;
  const { x: sx, y: sy, z: sz } = sim.slosh;

  for (let i = 0; i < sim.flakes.length; i++) {
    const f = sim.flakes[i];
    const m = sim.motion[i];
    if (f.resting) {
      spin(f, turnRest);
      if (stir <= SNOW_SETTINGS.throwAbove || random(sim) >= stir * STEP_SECONDS * LIFT_CHANCE_PER_STIR) continue;
      f.resting = false;
      m.vx = (random(sim) - 0.5) * LIFT_SPREAD * stir;
      m.vy = -random(sim) * LIFT_SPEED * stir;
      m.vz = (random(sim) - 0.5) * LIFT_SPREAD * stir;
    } else {
      spin(f, turnAir);
    }

    const p = f.phase;
    const ux = sx + tb * Math.sin(0.09 * f.y + 0.07 * f.z + t * 2.1 + p) + Math.sin(t * 1.3 + p * 7) * SWAY;
    const uy = sy + tb * Math.sin(0.09 * f.z + 0.07 * f.x + t * 1.7 + p * 1.3) - stir * RISE_PER_STIR + amounts.fallSpeed * m.pace;
    const uz = sz + tb * Math.sin(0.09 * f.x + 0.07 * f.y + t * 1.9 + p * 0.7) + Math.cos(t * 1.1 + p * 7) * SWAY;
    m.vx += (ux - m.vx) * ease;
    m.vy += (uy - m.vy) * ease;
    m.vz += (uz - m.vz) * ease;
    f.x += m.vx * STEP_SECONDS;
    f.y += m.vy * STEP_SECONDS;
    f.z += m.vz * STEP_SECONDS;

    const len = Math.hypot(f.x, f.y, f.z);
    if (len > GLASS_LIMIT) {
      const nx = f.x / len;
      const ny = f.y / len;
      const nz = f.z / len;
      const out = m.vx * nx + m.vy * ny + m.vz * nz;
      f.x = nx * GLASS_LIMIT;
      f.y = ny * GLASS_LIMIT;
      f.z = nz * GLASS_LIMIT;
      if (out > 0) {
        const kick = (1 + GLASS_BOUNCE) * out;
        m.vx -= kick * nx;
        m.vy -= kick * ny;
        m.vz -= kick * nz;
      }
    }

    if (f.y > REST_Y) {
      f.y = REST_Y;
      if (stir < SNOW_SETTINGS.settleBelow) {
        f.resting = true;
        m.vx = 0;
        m.vy = 0;
        m.vz = 0;
      } else {
        m.vy = -Math.abs(m.vy) * FLOOR_BOUNCE;
      }
    }
  }

  const slosh = Math.exp(-SLOSH_DECAY * STEP_SECONDS);
  sim.slosh.x *= slosh;
  sim.slosh.y *= slosh;
  sim.slosh.z *= slosh;

  // Left alone, a steady share keeps falling: lying flakes start again from the dome.
  const want = sim.flakes.length * amounts.airShare;
  const air = airCount(snow);
  if (air < want) {
    const due = (want - air) * STEP_SECONDS * RESTART_RATE;
    const whole = Math.floor(due);
    let n = whole + (random(sim) < due - whole ? 1 : 0);
    for (let tries = 0; n > 0 && tries < RESTART_TRIES; tries++) {
      const i = Math.floor(random(sim) * sim.flakes.length);
      if (sim.flakes[i].resting) {
        restart(sim, i);
        n--;
      }
    }
  }

  sim.steps++;
}

export function setChristmasDay(snow: GlobeSnow, on: boolean): void {
  const sim = simOf(snow);
  sim.christmasDay = on;
  const amounts = on ? GLOBE_SNOW.christmasDay : GLOBE_SNOW.ordinary;
  // Added flakes lie on the floor; removed ones come from the end, so the rest keep their place.
  while (sim.flakes.length > amounts.flakes) {
    sim.flakes.pop();
    sim.motion.pop();
  }
  while (sim.flakes.length < amounts.flakes) addFlake(sim, false, amounts.fallSpeed);
}

export function airCount(snow: GlobeSnow): number {
  let n = 0;
  for (const f of snow.flakes) if (!f.resting) n++;
  return n;
}
