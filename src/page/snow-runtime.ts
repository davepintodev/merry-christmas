// XMAS-36b3 "Snow and the stir", page wiring: the runtime that owns the page's
// two snows. Each step checks its whole input first, then changes the snows, so
// a bad step leaves both as they were. The globe snow is made once and kept; the
// outside snow is made again only when the picture's size changes. Either snow
// switches to Christmas Day or back only when the day changes. A pure module: no
// clock, no Math.random, and every step is one 1/60 s step of each snow.
import { createGlobeSnow, setChristmasDay, stepGlobeSnow, type GlobeSnow } from '../scene/snow.ts';
import { createOutsideSnow, setOutsideChristmasDay, stepOutsideSnow, type OutsideSnow } from '../scene/outside-snow.ts';

export interface SnowRuntime {
  step(input: {
    turn: number;
    christmasDay: boolean;
    width: number;
    height: number;
    raise?: number;
    push?: { x: number; y: number; z: number };
  }): void;
  readonly snow: GlobeSnow | null;
  readonly outsideSnow: OutsideSnow | null;
}

/** Throws a RangeError for any input the snows cannot take, before either snow is touched. */
function checkInput(turn: number, raise: number, push: { x: number; y: number; z: number }, width: number, height: number): void {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be finite, got ${turn}`);
  if (!Number.isFinite(raise) || raise < 0) throw new RangeError(`raise must be 0 or more, got ${raise}`);
  if (!(Number.isFinite(push.x) && Number.isFinite(push.y) && Number.isFinite(push.z))) {
    throw new RangeError('push must be finite');
  }
  if (!(Number.isFinite(width) && width >= 0 && Number.isFinite(height) && height >= 0)) {
    throw new RangeError(`a picture needs a size of 0 or more, got ${width} x ${height}`);
  }
}

export function makeSnowRuntime(seed: number): SnowRuntime {
  let globe: GlobeSnow | null = null;
  let outside: OutsideSnow | null = null;
  /** The picture size the outside snow was made for. */
  let outsideSize = { width: 0, height: 0 };
  /** The Christmas Day state of the last step that went through. */
  let day = false;

  return {
    step(input): void {
      const { turn, christmasDay, width, height } = input;
      const raise = input.raise ?? 0;
      const push = input.push ?? { x: 0, y: 0, z: 0 };
      checkInput(turn, raise, push, width, height);

      const switched = christmasDay !== day;
      if (globe === null) globe = createGlobeSnow(seed, christmasDay);
      else if (switched) setChristmasDay(globe, christmasDay);

      if (outside === null || width !== outsideSize.width || height !== outsideSize.height) {
        outside = createOutsideSnow(seed, width, height, christmasDay);
        outsideSize = { width, height };
      } else if (switched) {
        setOutsideChristmasDay(outside, christmasDay);
      }
      day = christmasDay;

      stepGlobeSnow(globe, { turn, raise, push });
      stepOutsideSnow(outside);
    },
    get snow(): GlobeSnow | null {
      return globe;
    },
    get outsideSnow(): OutsideSnow | null {
      return outside;
    },
  };
}
