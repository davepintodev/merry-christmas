// XMAS-44a: the pure keyboard model. Arrows turn and stir as a drag of the same art pixels does,
// a held key is a steady slow turn, Space/Enter is a flick-sized burst. Outputs are per-step deltas.
import { DRAG_SETTINGS as D } from './drag.ts';

export const KEY_SETTINGS = {
  /** Turn (rad) one press of an arrow gives: a small fixed step, about 5 art px of drag. */
  pressTurn: 0.1,
  /** Turn rate (rad/s) while an arrow is held: well under the flick threshold in drag speed. */
  heldTurnRate: 1,
  /** Seconds an arrow must be held before it turns steadily. */
  holdDelay: 0.4,
  /** The Space or Enter burst, as a multiple of the flick threshold (up to burstCap). */
  burstMultiple: 2,
};

export type Key = 'left' | 'right' | 'burst';

export interface KeyOutput {
  turn: number;
  raise: number;
  push: { x: number; y: number; z: number };
}

export interface Keys {
  keyDown(key: Key): void;
  keyUp(key: Key): void;
  step(dtSec: number): KeyOutput;
  reset(): void;
}

/** A right arrow sends the globe the way a drag to the right does, with the push to the right. */
const DIRECTION = { left: -1, right: 1 } as const;

/** A longer frame is cut to this for held keys, so one stall cannot turn the globe far. */
const MAX_FRAME = 0.25;

export function createKeys(settings: Partial<typeof KEY_SETTINGS> = {}, random: () => number = Math.random): Keys {
  const S = { ...KEY_SETTINGS, ...settings };

  // The keys now held down, and how long each arrow has been held.
  const down = new Set<Key>();
  const heldFor = { left: 0, right: 0 };

  let turn = 0;
  let raise = 0;
  let pushX = 0;
  let pushY = 0;

  /** Turns by angle (rad, positive) in direction, stirring and pushing as a drag of the same art pixels. */
  function turnBy(direction: number, angle: number): void {
    const px = angle / D.turnPerPixel;
    turn -= direction * angle;
    raise += px * D.stirPerPixel;
    pushX += direction * px * D.pushPerPixel;
  }

  return {
    keyDown(key) {
      if (down.has(key)) return; // a repeat without keyUp is not a new press
      down.add(key);
      if (key === 'burst') {
        // Each press pushes in its own random direction in the screen plane, at the same size.
        const multiple = Math.min(S.burstMultiple, D.burstCap);
        const magnitude = D.burstPush * multiple * D.flickThreshold;
        const angle = random() * 2 * Math.PI;
        raise += D.burstStir * multiple;
        pushX += magnitude * Math.cos(angle);
        pushY += magnitude * Math.sin(angle);
        return;
      }
      heldFor[key] = 0;
      turnBy(DIRECTION[key], S.pressTurn);
    },

    keyUp(key) {
      down.delete(key);
    },

    step(dtSec) {
      if (!Number.isFinite(dtSec) || dtSec < 0) throw new RangeError(`step must be 0 or more seconds, got ${dtSec}`);
      // A held arrow turns steadily only for the part of this (capped) step after holdDelay; both held cancel.
      const frame = Math.min(dtSec, MAX_FRAME);
      let net = 0;
      for (const key of ['left', 'right'] as const) {
        if (!down.has(key)) continue;
        heldFor[key] += frame;
        const steady = Math.min(frame, Math.max(0, heldFor[key] - S.holdDelay));
        net += DIRECTION[key] * steady;
      }
      if (net !== 0) turnBy(Math.sign(net), Math.abs(net) * S.heldTurnRate);

      const out = { turn, raise, push: { x: pushX, y: pushY, z: 0 } };
      turn = 0;
      raise = 0;
      pushX = 0;
      pushY = 0;
      return out;
    },

    reset() {
      down.clear();
      turn = 0;
      raise = 0;
      pushX = 0;
      pushY = 0;
    },
  };
}
