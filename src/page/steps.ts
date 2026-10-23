// XMAS-31b "Scene core", page runtime: the scene's fixed clock of 60 steps a
// second, whatever the screen's refresh rate. makeStepper(start) counts whole
// steps from `start`; due(now) says how many steps to run for a frame at
// `now` and remembers them, so no step is run twice or skipped.
// reset(now) starts counting again from `now` (after a hidden tab), so a long
// gap is not replayed as a burst of steps.
// XMAS-79 "Smooth between steps": fraction(now) says how far `now` is into the
// step not yet run, so the scene can draw partway between two steps.
export const STEPS_PER_SECOND = 60;
export const STEP_MS = 1000 / STEPS_PER_SECOND;

/**
 * Whole-millisecond frame times land a hair either side of a step boundary
 * once rounded to a double (six steps are 100.00000000000001 ms, not 100), so
 * boundaries compare with a tolerance far below any real frame.
 */
const EPSILON_MS = 1e-9;

export interface Stepper {
  /** Steps due for a frame at `now`: whole steps since the last call, never negative. */
  due(now: number): number;
  /** Starts counting again from `now`, keeping no part-step from before. */
  reset(now: number): void;
  /**
   * How far `now` is into the next step not yet run, from 0 to 1. Call it after
   * due(now) for the same frame; time going backwards gives 0.
   */
  fraction(now: number): number;
}

function finite(time: number, what: string): void {
  if (!Number.isFinite(time)) throw new RangeError(`${what} must be a finite number of milliseconds, got ${time}`);
}

export function makeStepper(start: number): Stepper {
  finite(start, 'start');
  let base = start;
  let taken = 0;

  /** Whole steps from `base` up to `now`; time going backwards counts none. */
  function counted(now: number): number {
    let total = Math.max(0, Math.floor((now - base) / STEP_MS));
    // The division is only a guess when `base` and `now` are large and close
    // together, so walk to the exact boundary either way; each loop sees at
    // most a step or two.
    while (base + (total + 1) * STEP_MS <= now + EPSILON_MS) total++;
    while (total > 0 && base + total * STEP_MS > now + EPSILON_MS) total--;
    return total;
  }

  return {
    due(now: number): number {
      finite(now, 'a frame time');
      const total = counted(now);
      const due = Math.max(0, total - taken);
      taken = Math.max(taken, total);
      return due;
    },
    reset(now: number): void {
      finite(now, 'a frame time');
      base = now;
      taken = 0;
    },
    fraction(now: number): number {
      finite(now, 'a frame time');
      // Measured from the last step taken, with the same tolerance as counted(),
      // so a frame exactly on a boundary reads 0 rather than a sliver either side.
      const into = now - (base + taken * STEP_MS);
      if (into <= EPSILON_MS) return 0;
      return Math.min(1, into / STEP_MS);
    },
  };
}
