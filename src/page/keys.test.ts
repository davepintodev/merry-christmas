// XMAS-44a: the pure keyboard model. Arrows turn and stir as a drag of the same art pixels does,
// a held key is a steady slow turn, Space/Enter is a flick-sized burst. Outputs are per-step deltas.
import { describe, expect, it, vi } from 'vitest';
import { DRAG_SETTINGS as D, createDrag } from './drag.ts';
import { KEY_SETTINGS, createKeys } from './keys.ts';

const own = { pressTurn: 0.1, heldTurnRate: 1, holdDelay: 0.5, burstMultiple: 2 };
const mk = (random?: () => number) => createKeys(own, random);
const px = (turn: number) => Math.abs(turn) / D.turnPerPixel;
const burstMagnitude = D.burstPush * 2 * D.flickThreshold;

describe('settings', () => {
  it('names the starting values, with a held rate below the flick threshold and a burst within the cap', () => {
    for (const k of ['pressTurn', 'heldTurnRate', 'holdDelay', 'burstMultiple'] as const) expect(KEY_SETTINGS[k]).toBeGreaterThan(0);
    expect(KEY_SETTINGS.heldTurnRate / D.turnPerPixel).toBeLessThan(D.flickThreshold);
    expect(KEY_SETTINGS.burstMultiple).toBeLessThanOrEqual(D.burstCap);
  });
});

describe('a press', () => {
  it('turns one pressTurn with a drag-matching sign, and the delta clears after step', () => {
    const k = mk();
    k.keyDown('right');
    expect(k.step(0.016).turn).toBeCloseTo(-0.1);
    expect(k.step(0.016).turn).toBe(0);
    k.keyUp('right');
    k.keyDown('left');
    expect(k.step(0.016).turn).toBeCloseTo(0.1);
  });

  it('counts once per physical press: a repeat keyDown adds nothing, a new press after keyUp does', () => {
    const k = mk();
    k.keyDown('right');
    k.keyDown('right');
    k.keyDown('right');
    expect(k.step(0.016).turn).toBeCloseTo(-0.1);
    k.keyUp('right');
    k.keyDown('right');
    expect(k.step(0.016).turn).toBeCloseTo(-0.1);
  });

  it('stirs and pushes as a drag of the same art pixels, with no flick burst', () => {
    const k = mk();
    k.keyDown('right');
    const out = k.step(0.016);
    const drag = createDrag();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, px(0.1), 0, 10); // far too slow to flick
    drag.pointerUp(1, 11);
    const ref = drag.step(0.016);
    expect(out.turn).toBeCloseTo(ref.turn);
    expect(out.raise).toBeCloseTo(ref.raise);
    expect(out.push.x).toBeCloseTo(ref.push.x);
    expect(out.push.y).toBe(0);
    expect(out.push.z).toBe(0);
  });

  it('pushes left for the left arrow', () => {
    const k = mk();
    k.keyDown('left');
    expect(k.step(0.016).push.x).toBeCloseTo(-px(0.1) * D.pushPerPixel);
  });
});

describe('a held key', () => {
  it('turns nothing steadily before holdDelay, then heldTurnRate * dt with matching stir and push', () => {
    const k = mk();
    k.keyDown('right');
    k.step(0.2); // the press
    expect(k.step(0.2).turn).toBe(0);
    expect(k.step(0.05).turn).toBe(0); // 0.45 s held, still under the delay
    const out = k.step(0.1); // only the 0.05 s after the delay turns
    expect(out.turn).toBeCloseTo(-0.05);
    expect(out.raise).toBeCloseTo(px(0.05) * D.stirPerPixel);
    expect(out.push.x).toBeCloseTo(px(0.05) * D.pushPerPixel);
  });

  it('cancels when both arrows are held', () => {
    const k = mk();
    k.keyDown('left');
    k.keyDown('right');
    k.step(0.1);
    const out = k.step(1);
    expect(out.turn).toBeCloseTo(0);
    expect(out.push.x).toBeCloseTo(0);
  });

  it('restarts the delay on a fresh press after a short hold', () => {
    const k = mk();
    k.keyDown('right');
    k.step(0.4);
    k.keyUp('right');
    k.keyDown('right');
    k.step(0.016);
    expect(k.step(0.4).turn).toBe(0);
  });

  it('never adds a burst, however long it is held', () => {
    const k = mk();
    k.keyDown('right');
    for (let i = 0; i < 3; i++) k.step(0.25); // 0.75 s held, past the delay
    const out = k.step(0.25);
    expect(out.raise).toBeCloseTo(px(0.25) * D.stirPerPixel);
  });

  it('cuts a long frame to 0.25 s', () => {
    const k = mk();
    k.keyDown('right');
    for (let i = 0; i < 3; i++) k.step(0.25);
    expect(k.step(2).turn).toBeCloseTo(-0.25);
  });
});

describe('burst', () => {
  it('gives a flick of burstMultiple x threshold, with no turn, once per press', () => {
    const k = mk(() => 0);
    k.keyDown('burst');
    k.keyDown('burst');
    const out = k.step(0.016);
    expect(out.turn).toBe(0);
    expect(out.raise).toBeCloseTo(D.burstStir * 2);
    expect(Math.hypot(out.push.x, out.push.y)).toBeCloseTo(burstMagnitude);
    expect(k.step(0.016).raise).toBe(0);
    k.keyUp('burst');
    k.keyDown('burst');
    expect(k.step(0.016).raise).toBeCloseTo(D.burstStir * 2);
  });

  it('pushes along the random angle: 0 to the right, 0.25 to +y, 0.5 to the left', () => {
    for (const [r, x, y] of [[0, 1, 0], [0.25, 0, 1], [0.5, -1, 0]] as const) {
      const k = mk(() => r);
      k.keyDown('burst');
      const out = k.step(0.016);
      expect(out.push.x).toBeCloseTo(x * burstMagnitude);
      expect(out.push.y).toBeCloseTo(y * burstMagnitude);
      expect(out.push.z).toBe(0);
    }
  });

  it('keeps the same magnitude at any angle', () => {
    for (const r of [0.1, 0.37, 0.9, 0.999]) {
      const k = mk(() => r);
      k.keyDown('burst');
      const out = k.step(0.016);
      expect(Math.hypot(out.push.x, out.push.y)).toBeCloseTo(burstMagnitude);
    }
  });

  it('draws a new direction for each press, and a repeat keyDown draws none', () => {
    const values = [0, 0.25];
    const k = mk(() => values.shift() ?? 0);
    k.keyDown('burst');
    k.keyDown('burst');
    expect(k.step(0.016).push.x).toBeCloseTo(burstMagnitude);
    k.keyUp('burst');
    k.keyDown('burst');
    const out = k.step(0.016);
    expect(out.push.x).toBeCloseTo(0);
    expect(out.push.y).toBeCloseTo(burstMagnitude);
  });

  it('ignores the last arrow pressed', () => {
    const k = mk(() => 0);
    k.keyDown('left');
    k.keyUp('left');
    k.step(0.016);
    k.keyDown('burst');
    expect(k.step(0.016).push.x).toBeCloseTo(burstMagnitude);
  });

  it('defaults to Math.random when no random is given', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const k = mk();
      k.keyDown('burst');
      expect(k.step(0.016).push.x).toBeCloseTo(-burstMagnitude);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('step and reset', () => {
  it('throws RangeError on a bad dt', () => {
    const k = mk();
    for (const dt of [-0.1, NaN, Infinity]) expect(() => k.step(dt)).toThrow(RangeError);
  });

  it('reset drops held keys and pending deltas, and a later press counts again', () => {
    const k = mk(() => 0.25);
    k.keyDown('right');
    k.step(0.1);
    k.keyDown('burst');
    k.reset();
    const out = k.step(2);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    expect(out.push.x).toBe(0);
    expect(out.push.y).toBe(0);
    k.keyUp('right'); // late keyUp after reset is harmless
    k.keyDown('right');
    expect(k.step(0.016).turn).toBeCloseTo(-0.1);
  });
});
