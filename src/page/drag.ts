// XMAS-41a: the pure drag model. Positions are art pixels, time is seconds; the caller owns the clock.
export const DRAG_SETTINGS = {
  /** A release faster than this (art px/s) adds a flick burst. */
  flickThreshold: 200,
  /** The burst stops growing at this multiple of the threshold. */
  burstCap: 3,
  /** Turn (rad) per art px dragged sideways: the surface keeps up with the finger, a globe radius of 56 px is about 1 rad. */
  turnPerPixel: 0.018,
  /** Stir per art px of 2D path length, with no threshold. */
  stirPerPixel: 0.006,
  /** Snow pushed per art px of net 2D movement. */
  pushPerPixel: 2,
  /** Stir added per multiple of the threshold a flick reaches (up to burstCap). */
  burstStir: 0.35,
  /** Snow pushed per art px/s of capped flick velocity, along the flick's direction. */
  burstPush: 0.4,
  /** Lean velocity (rad/s) each art px moved sideways kicks the globe with. */
  leanPerPixel: 0.012,
  /** Largest lean either way, in rad. */
  maxLean: 0.16,
  /** Spring pulling the lean back to upright, while the finger is down or not. */
  springStiffness: 70,
  springDamping: 6,
  /** Seconds before a release over which the flick speed is measured. */
  velocityWindow: 0.1,
};

/** The spring is integrated in slices this long, so a stiff spring stays stable. */
const SPRING_SLICE = 1 / 240;
/** A longer frame is cut to this, so one long pause cannot run the spring for long. */
const SPRING_MAX_FRAME = 0.25;

export interface DragOutput {
  turn: number;
  lean: number;
  raise: number;
  push: { x: number; y: number; z: number };
}

export interface Drag {
  pointerDown(id: number, x: number, y: number, timeSec: number): void;
  pointerMove(id: number, x: number, y: number, timeSec: number): void;
  pointerUp(id: number, timeSec: number): void;
  pointerCancel(id: number): void;
  step(dtSec: number): DragOutput;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite, got ${value}`);
}

export function createDrag(initialTurn = 0, settings: Partial<typeof DRAG_SETTINGS> = {}): Drag {
  const S = { ...DRAG_SETTINGS, ...settings };
  requireFinite('turn', initialTurn);

  let turn = initialTurn;
  let lean = 0;
  let leanVel = 0;
  let raise = 0;
  let pushX = 0;
  let pushY = 0;

  // The one pointer being tracked, where it is now, and its recent samples for the flick.
  let tracked: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let samples: { x: number; y: number; t: number }[] = [];

  /** A release faster than the threshold adds a burst that grows with speed, up to the cap, along the flick. */
  function addFlickBurst(releaseT: number): void {
    const from = releaseT - S.velocityWindow;
    const base = samples.find((s) => s.t >= from && s.t < releaseT);
    if (!base) return;
    const dx = lastX - base.x;
    const dy = lastY - base.y;
    const length = Math.hypot(dx, dy);
    const speed = length / (releaseT - base.t);
    const threshold = S.flickThreshold;
    if (!(speed > threshold)) return;
    const capped = Math.min(speed, S.burstCap * threshold);
    raise += S.burstStir * (capped / threshold);
    pushX += S.burstPush * capped * (dx / length);
    pushY += S.burstPush * capped * (dy / length);
  }

  return {
    pointerDown(id, x, y, timeSec) {
      requireFinite('x', x);
      requireFinite('y', y);
      requireFinite('time', timeSec);
      if (tracked !== null) return; // a second finger is ignored
      tracked = id;
      lastX = x;
      lastY = y;
      samples = [{ x, y, t: timeSec }];
    },

    pointerMove(id, x, y, timeSec) {
      requireFinite('x', x);
      requireFinite('y', y);
      requireFinite('time', timeSec);
      if (id !== tracked) return;
      const dx = x - lastX;
      const dy = y - lastY;
      requireFinite('movement x', dx);
      requireFinite('movement y', dy);
      turn += dx * S.turnPerPixel;
      raise += Math.hypot(dx, dy) * S.stirPerPixel;
      pushX += dx * S.pushPerPixel;
      pushY += dy * S.pushPerPixel;
      leanVel += dx * S.leanPerPixel;
      lastX = x;
      lastY = y;
      samples.push({ x, y, t: timeSec });
      // A release comes at or after this move, so older samples can never fall in its window.
      const from = timeSec - S.velocityWindow;
      while (samples.length > 0 && samples[0].t < from) samples.shift();
    },

    pointerUp(id, timeSec) {
      requireFinite('time', timeSec);
      if (id !== tracked) return;
      addFlickBurst(timeSec);
      tracked = null;
      samples = [];
    },

    pointerCancel(id) {
      if (id !== tracked) return;
      tracked = null;
      samples = [];
    },

    step(dtSec) {
      if (!Number.isFinite(dtSec) || dtSec < 0) throw new RangeError(`step must be 0 or more seconds, got ${dtSec}`);
      let left = Math.min(dtSec, SPRING_MAX_FRAME);
      while (left > 0) {
        const h = Math.min(left, SPRING_SLICE);
        leanVel += (-S.springStiffness * lean - S.springDamping * leanVel) * h;
        lean += leanVel * h;
        if (Math.abs(lean) > S.maxLean) {
          lean = Math.sign(lean) * S.maxLean;
          leanVel = 0;
        }
        left -= h;
      }

      const out = { turn, lean, raise, push: { x: pushX, y: pushY, z: 0 } };
      raise = 0;
      pushX = 0;
      pushY = 0;
      return out;
    },
  };
}
