// XMAS-43a: the pure shake model. Motion readings (m/s², time in seconds) go in; the stir and the snow push built up since
// the last take() come out. The caller owns the clock: every reading carries its own timeSec.
export const SHAKE_SETTINGS = {
  /** Motion with gravity removed counts only above this (m/s²). */
  threshold: 6,
  /** Time constant (s) of the running average of gravity, for phones that give no gravity-free reading. */
  gravityTimeSec: 3,
  /** Longest gap (s) between two readings that counts. A longer gap, such as a sleep, counts only this much. */
  maxGapSec: 0.1,
  /** Seconds with no real motion data before the shake is given up on. */
  waitSec: 1.5,
  /** Stir per m/s² over the threshold, per second of motion. */
  stirPerExcess: 0.18,
  /** Snow pushed per m/s² over the threshold, per second of motion, against the direction of the jolt. */
  pushPerExcess: 0.5,
};

type Axes = { x?: number | null; y?: number | null; z?: number | null };

export interface MotionReading {
  timeSec?: number | null;
  acceleration?: Axes | null;
  accelerationIncludingGravity?: Axes | null;
}

export interface ShakeOutput {
  raise: number;
  push: { x: number; y: number; z: number };
}

export interface Shake {
  reading(r: MotionReading): void;
  take(): ShakeOutput;
  readonly active: boolean;
}

interface Vector {
  x: number;
  y: number;
  z: number;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The three axes, or null unless every one of them is a finite number. */
function vector(axes: Axes | null | undefined): Vector | null {
  const x = axes?.x;
  const y = axes?.y;
  const z = axes?.z;
  if (!isNumber(x) || !isNumber(y) || !isNumber(z)) return null;
  return { x, y, z };
}

export function createShake(settings: Partial<typeof SHAKE_SETTINGS> = {}): Shake {
  const S = { ...SHAKE_SETTINGS, ...settings };

  let active = false;
  let prevT: number | null = null;
  let average: Vector | null = null;

  // Built up since the last take().
  let raise = 0;
  let pushX = 0;
  let pushY = 0;

  /** Subtracts the slow running average from a gravity-included reading, then lets the average move towards it. */
  function removeGravity(g: Vector, dt: number): Vector {
    const avg = average ?? g;
    const blend = dt > 0 ? 1 - Math.exp(-dt / S.gravityTimeSec) : 0;
    average = {
      x: avg.x + blend * (g.x - avg.x),
      y: avg.y + blend * (g.y - avg.y),
      z: avg.z + blend * (g.z - avg.z),
    };
    return { x: g.x - avg.x, y: g.y - avg.y, z: g.z - avg.z };
  }

  return {
    get active() {
      return active;
    },

    reading(r) {
      // Motion without gravity is preferred when it has numbers.
      const own = vector(r.acceleration);
      const gravity = own ? null : vector(r.accelerationIncludingGravity);
      if (!own && !gravity) return;
      active = true;

      // Without a usable time nothing can be scaled, so nothing is counted and the clock stays where it was.
      const t = r.timeSec;
      if (!isNumber(t)) return;
      // The first reading, or one that goes back in time, only restarts the clock.
      const dt = prevT === null || t < prevT ? 0 : t - prevT;
      prevT = t;

      let motion = own;
      if (!motion && gravity) motion = removeGravity(gravity, dt);
      if (!motion) return;

      const mag = Math.hypot(motion.x, motion.y, motion.z);
      const over = mag - S.threshold;
      if (over <= 0) return;

      // Only the size of the reading counts, so a shake either way stirs alike. A long gap counts only up to maxGapSec.
      const built = over * Math.min(dt, S.maxGapSec);
      raise += built * S.stirPerExcess;
      pushX -= (motion.x / mag) * built * S.pushPerExcess;
      pushY += (motion.y / mag) * built * S.pushPerExcess;
    },

    take() {
      const out = { raise, push: { x: pushX, y: pushY, z: 0 } };
      raise = 0;
      pushX = 0;
      pushY = 0;
      return out;
    },
  };
}
