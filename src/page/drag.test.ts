// XMAS-41a "The drag model": a pure model of a finger or mouse on the globe.
// Positions are art pixels, time is seconds; the test drives every clock.
import { describe, expect, it } from 'vitest';
import { createDrag, DRAG_SETTINGS, type Drag } from './drag.ts';

const S = {
  turnPerPixel: 0.01,
  stirPerPixel: 0.1,
  pushPerPixel: 0.5,
  burstStir: 2,
  burstPush: 100,
  leanPerPixel: 0.01,
  maxLean: 0.3,
  springStiffness: 60,
  springDamping: 12,
  velocityWindow: 0.1,
};
const T = DRAG_SETTINGS.flickThreshold;
const FRAME = 1 / 60;

function make(initialTurn = 0): Drag {
  return createDrag(initialTurn, S);
}

/** Drags 0 -> speed*0.05 over 0.05 s, consumes the drag's own output, releases, and returns the release step. */
function flick(speed: number, drag = make()) {
  return flick2d(speed, 0, drag);
}

/** The same flick with a velocity of (vx, vy) art px/s. */
function flick2d(vx: number, vy: number, drag = make()) {
  drag.pointerDown(1, 0, 0, 0);
  drag.pointerMove(1, vx * 0.05, vy * 0.05, 0.05);
  drag.step(0);
  drag.pointerUp(1, 0.05);
  return drag.step(0);
}

/** Drags right 3 px a frame for 20 frames, stepping each frame; returns the lean at the end. */
function dragRight(drag: Drag): number {
  drag.pointerDown(1, 0, 0, 0);
  let lean = 0;
  for (let i = 1; i <= 20; i++) {
    drag.pointerMove(1, i * 3, 0, i * FRAME);
    lean = drag.step(FRAME).lean;
  }
  return lean;
}

describe('named settings', () => {
  it('names the flick threshold and burst cap from the ticket', () => {
    expect(DRAG_SETTINGS.flickThreshold).toBe(200);
    expect(DRAG_SETTINGS.burstCap).toBe(3);
    expect(DRAG_SETTINGS.burstPush).toBeGreaterThan(0);
    for (const key of ['turnPerPixel', 'leanPerPixel', 'maxLean', 'springStiffness', 'springDamping'] as const) {
      expect(DRAG_SETTINGS[key]).toBeGreaterThan(0);
    }
  });
});

describe('turning', () => {
  it('starts at the initial turn and has no automatic turn', () => {
    const drag = make(1.25);
    expect(drag.step(1).turn).toBe(1.25);
    expect(drag.step(5).turn).toBe(1.25);
  });

  it('turns in proportion to the horizontal distance, rightward negative (it carries the front surface right, XMAS-67)', () => {
    const drag = make(1);
    drag.pointerDown(1, 10, 0, 0);
    drag.pointerMove(1, 40, 0, 0.5);
    expect(drag.step(FRAME).turn).toBeCloseTo(1 - 30 * S.turnPerPixel, 9);
  });

  it('turns by the horizontal movement only: a vertical drag does not turn, a diagonal turns by its x', () => {
    const vertical = make();
    vertical.pointerDown(1, 0, 0, 0);
    vertical.pointerMove(1, 0, 40, 0.5);
    expect(vertical.step(FRAME).turn).toBe(0);
    const diagonal = make();
    diagonal.pointerDown(1, 0, 0, 0);
    diagonal.pointerMove(1, 30, 40, 0.5);
    expect(diagonal.step(FRAME).turn).toBeCloseTo(-30 * S.turnPerPixel, 9);
  });

  it('turns the other way for a leftward drag', () => {
    const drag = make();
    drag.pointerDown(1, 50, 0, 0);
    drag.pointerMove(1, 20, 0, 0.5);
    expect(drag.step(FRAME).turn).toBeCloseTo(30 * S.turnPerPixel, 9);
  });

  it('accumulates across several moves and back-and-forth', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 30, 0, 0.2);
    drag.pointerMove(1, 10, 0, 0.4);
    drag.pointerMove(1, 15, 0, 0.6);
    expect(drag.step(FRAME).turn).toBeCloseTo(-15 * S.turnPerPixel, 9);
  });

  it('keeps the turn after release and starts the next drag from it', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 20, 0, 1);
    drag.pointerUp(1, 3);
    const held = drag.step(FRAME).turn;
    expect(drag.step(2).turn).toBe(held);
    drag.pointerDown(1, 100, 0, 10);
    drag.pointerMove(1, 110, 0, 11);
    expect(drag.step(FRAME).turn).toBeCloseTo(held - 10 * S.turnPerPixel, 9);
  });

  it('does not turn when the pointer is not down', () => {
    const drag = make(2);
    drag.pointerMove(1, 500, 0, 1);
    expect(drag.step(FRAME).turn).toBe(2);
  });
});

describe('stirring from distance', () => {
  it('raises in proportion to the distance moved', () => {
    const a = make();
    a.pointerDown(1, 0, 0, 0);
    a.pointerMove(1, 10, 0, 1);
    const b = make();
    b.pointerDown(1, 0, 0, 0);
    b.pointerMove(1, 20, 0, 1);
    const ra = a.step(FRAME).raise;
    const rb = b.step(FRAME).raise;
    expect(ra).toBeCloseTo(10 * S.stirPerPixel, 9);
    expect(rb).toBeCloseTo(2 * ra, 9);
  });

  it('has no threshold: a one-pixel drag still stirs', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 0.25, 0, 1);
    expect(drag.step(FRAME).raise).toBeCloseTo(0.25 * S.stirPerPixel, 9);
  });

  it('stirs by total path length, so leftward and back-and-forth both count', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, -10, 0, 1);
    drag.pointerMove(1, 5, 0, 2);
    expect(drag.step(FRAME).raise).toBeCloseTo(25 * S.stirPerPixel, 9);
  });

  it('adds up the same however the distance is split into moves', () => {
    const one = make();
    one.pointerDown(1, 0, 0, 0);
    one.pointerMove(1, 30, 0, 1);
    const many = make();
    many.pointerDown(1, 0, 0, 0);
    for (let i = 1; i <= 6; i++) many.pointerMove(1, i * 5, 0, i * 0.1);
    expect(many.step(FRAME).raise).toBeCloseTo(one.step(FRAME).raise, 9);
  });

  it('stirs for a purely vertical drag, in proportion to its length', () => {
    const drag = make();
    drag.pointerDown(1, 5, 5, 0);
    drag.pointerMove(1, 5, 25, 1);
    expect(drag.step(FRAME).raise).toBeCloseTo(20 * S.stirPerPixel, 9);
  });

  it('stirs by the 2D path length of a diagonal drag', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 3, 4, 1);
    expect(drag.step(FRAME).raise).toBeCloseTo(5 * S.stirPerPixel, 9);
  });

  it('stirs by total 2D path length, so up-and-down and mixed moves all count', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 0, -10, 1);
    drag.pointerMove(1, 0, 5, 2);
    drag.pointerMove(1, 6, 13, 3);
    expect(drag.step(FRAME).raise).toBeCloseTo((10 + 15 + 10) * S.stirPerPixel, 9);
  });

  it('does not stir for a press with no movement, or a move to the same place', () => {
    const drag = make();
    drag.pointerDown(1, 7, 0, 0);
    drag.pointerMove(1, 7, 0, 0.5);
    drag.pointerMove(1, 7, 0, 0.6);
    const out = drag.step(FRAME);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
    expect(out.turn).toBe(0);
  });

  it('does not stir when moving with nothing pressed', () => {
    const drag = make();
    drag.pointerMove(1, 100, 0, 1);
    expect(drag.step(FRAME).raise).toBe(0);
  });

  it('consumes the stir: a second step with no new input raises nothing', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 40, 0, 1);
    expect(drag.step(FRAME).raise).toBeGreaterThan(0);
    expect(drag.step(FRAME).raise).toBe(0);
  });

  it('sums the moves that arrive between two steps', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 10, 0, 0.1);
    drag.pointerMove(1, 20, 0, 0.2);
    expect(drag.step(FRAME).raise).toBeCloseTo(20 * S.stirPerPixel, 9);
  });
});

describe('pushing the snow', () => {
  it('pushes toward the drag direction, rightward positive x', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 10, 0, 0.5);
    const { push } = drag.step(FRAME);
    expect(push.x).toBeCloseTo(10 * S.pushPerPixel, 9);
    expect(push.y).toBe(0);
    expect(push.z).toBe(0);
  });

  it('pushes the other way for a leftward drag', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, -10, 0, 0.5);
    expect(drag.step(FRAME).push.x).toBeCloseTo(-10 * S.pushPerPixel, 9);
  });

  it('pushes along a purely vertical drag: y follows its sign, x and z stay 0', () => {
    const down = make();
    down.pointerDown(1, 0, 0, 0);
    down.pointerMove(1, 0, 10, 0.5);
    const d = down.step(FRAME).push;
    expect(d.y).toBeCloseTo(10 * S.pushPerPixel, 9);
    expect(d.x).toBe(0);
    expect(d.z).toBe(0);
    const up = make();
    up.pointerDown(1, 0, 0, 0);
    up.pointerMove(1, 0, -10, 0.5);
    const u = up.step(FRAME).push;
    expect(u.y).toBeCloseTo(-10 * S.pushPerPixel, 9);
    expect(u.x).toBe(0);
    expect(u.z).toBe(0);
  });

  it('pushes a diagonal drag by both components, signs following each direction', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, -6, 8, 0.5);
    const { push } = drag.step(FRAME);
    expect(push.x).toBeCloseTo(-6 * S.pushPerPixel, 9);
    expect(push.y).toBeCloseTo(8 * S.pushPerPixel, 9);
    expect(push.z).toBe(0);
  });

  it('nets out a there-and-back vertical drag between steps', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 0, 10, 0.1);
    drag.pointerMove(1, 0, 0, 0.2);
    expect(drag.step(FRAME).push.y).toBeCloseTo(0, 9);
  });

  it('grows with the distance and is consumed by the step', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 10, 0, 0.5);
    const first = drag.step(FRAME).push.x;
    drag.pointerMove(1, 40, 0, 1);
    const second = drag.step(FRAME).push.x;
    expect(second).toBeCloseTo(3 * first, 9);
    expect(drag.step(FRAME).push).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('nets out a there-and-back drag between steps', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 10, 0, 0.1);
    drag.pointerMove(1, 0, 0, 0.2);
    expect(drag.step(FRAME).push.x).toBeCloseTo(0, 9);
  });
});

describe('the lean', () => {
  it('leans into a rightward drag and the other way for a leftward one', () => {
    const right = make();
    right.pointerDown(1, 0, 0, 0);
    const left = make();
    left.pointerDown(1, 0, 0, 0);
    let r = 0;
    let l = 0;
    for (let i = 1; i <= 20; i++) {
      right.pointerMove(1, i * 3, 0, i * FRAME);
      left.pointerMove(1, -i * 3, 0, i * FRAME);
      r = right.step(FRAME).lean;
      l = left.step(FRAME).lean;
    }
    expect(r).toBeGreaterThan(0);
    expect(l).toBeLessThan(0);
    expect(l).toBeCloseTo(-r, 6);
  });

  it('is zero before any drag', () => {
    expect(make().step(FRAME).lean).toBe(0);
  });

  it('is kicked by motion: a single move leans the globe on the next step', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 20, 0, FRAME);
    expect(drag.step(FRAME).lean).toBeGreaterThan(0);
  });

  it('does not lean while the finger is held still after pressing', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    for (let i = 0; i < 30; i++) expect(drag.step(FRAME).lean).toBe(0);
  });

  it('springs back toward upright while the finger is still down and still', () => {
    const drag = make();
    const peak = dragRight(drag);
    expect(peak).toBeGreaterThan(0.01);
    // no move, no release: the lean is not aimed at the offset from the press point
    let lean = peak;
    for (let i = 0; i < 60; i++) lean = drag.step(FRAME).lean;
    expect(Math.abs(lean)).toBeLessThan(peak * 0.5);
    for (let i = 0; i < 60 * 4; i++) lean = drag.step(FRAME).lean;
    expect(Math.abs(lean)).toBeLessThan(1e-3);
  });

  it('keeps leaning only while the motion continues', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    let still = 0;
    for (let i = 1; i <= 120; i++) {
      drag.pointerMove(1, i * 3, 0, i * FRAME);
      drag.step(FRAME);
    }
    for (let i = 0; i < 60 * 3; i++) still = drag.step(FRAME).lean;
    expect(Math.abs(still)).toBeLessThan(1e-3);
  });

  it('never exceeds the maximum lean, however hard the drag', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    for (let i = 1; i <= 120; i++) {
      drag.pointerMove(1, i * 500, 0, i * FRAME);
      expect(Math.abs(drag.step(FRAME).lean)).toBeLessThanOrEqual(S.maxLean + 1e-9);
    }
  });

  it('is capped at the maximum lean in the other direction too', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    for (let i = 1; i <= 120; i++) {
      drag.pointerMove(1, -i * 500, 0, i * FRAME);
      const lean = drag.step(FRAME).lean;
      expect(lean).toBeGreaterThanOrEqual(-S.maxLean - 1e-9);
    }
  });

  it('springs back to nearly upright within 5 s of release, and stays there', () => {
    const drag = make();
    const peak = dragRight(drag);
    expect(peak).toBeGreaterThan(0.01);
    drag.pointerUp(1, 21 * FRAME);
    let lean = peak;
    for (let i = 0; i < 60 * 5; i++) lean = drag.step(FRAME).lean;
    expect(Math.abs(lean)).toBeLessThan(1e-3);
    for (let i = 0; i < 60; i++) expect(Math.abs(drag.step(FRAME).lean)).toBeLessThan(1e-3);
  });

  it('springs back after a cancel too', () => {
    const drag = make();
    dragRight(drag);
    drag.pointerCancel(1);
    let lean = 1;
    for (let i = 0; i < 60 * 5; i++) lean = drag.step(FRAME).lean;
    expect(Math.abs(lean)).toBeLessThan(1e-3);
  });

  it('moves gradually on release rather than snapping upright', () => {
    const drag = make();
    const peak = dragRight(drag);
    drag.pointerUp(1, 21 * FRAME);
    const next = drag.step(FRAME).lean;
    expect(next).not.toBe(0);
    expect(Math.abs(next)).toBeLessThan(Math.abs(peak) * 1.5);
  });

  it('does not blow up with a long frame, with the finger down or after release', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 100, 0, 0.1);
    for (let i = 0; i < 5; i++) {
      const lean = drag.step(2).lean;
      expect(Number.isFinite(lean)).toBe(true);
      expect(Math.abs(lean)).toBeLessThanOrEqual(S.maxLean + 1e-9);
    }
    drag.pointerMove(1, 300, 0, 0.2);
    drag.pointerUp(1, 0.2);
    for (let i = 0; i < 20; i++) {
      const lean = drag.step(2).lean;
      expect(Number.isFinite(lean)).toBe(true);
      expect(Math.abs(lean)).toBeLessThanOrEqual(S.maxLean + 1e-9);
    }
  });
});

describe('the flick', () => {
  it('adds no burst at exactly the threshold speed', () => {
    const out = flick(T);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('adds no burst below the threshold', () => {
    expect(flick(T * 0.5).raise).toBe(0);
  });

  it('adds a burst already worth a full unit of stir just above the threshold, not starting at zero', () => {
    const out = flick(T * 1.01);
    expect(out.raise).toBeGreaterThanOrEqual(S.burstStir);
    expect(out.raise).toBeLessThan(flick(T * 2).raise);
    expect(out.push.x).toBeGreaterThan(0);
  });

  it('raises by burstStir times the speed in multiples of the threshold', () => {
    expect(flick(T * 2).raise).toBeCloseTo(S.burstStir * 2, 9);
    expect(flick(T * 1.25).raise).toBeCloseTo(S.burstStir * 1.25, 9);
    expect(flick(T * 2.4).raise).toBeCloseTo(2 * flick(T * 1.2).raise, 9);
  });

  it('adds a bigger burst for a faster flick', () => {
    const a = flick(T * 1.5).raise;
    const b = flick(T * 2).raise;
    const c = flick(T * 2.5).raise;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('caps the burst at three times the threshold speed', () => {
    const atCap = flick(T * 3).raise;
    expect(atCap).toBeCloseTo(S.burstStir * 3, 9);
    expect(atCap).toBeGreaterThan(flick(T * 2.9).raise);
    expect(flick(T * 3.5).raise).toBeCloseTo(atCap, 9);
    expect(flick(T * 50).raise).toBeCloseTo(atCap, 9);
  });

  it('honours a custom burst cap and threshold', () => {
    const run = (speed: number) =>
      flick(speed, createDrag(0, { ...S, flickThreshold: 100, burstCap: 2 })).raise;
    expect(run(100)).toBe(0);
    expect(run(150)).toBeGreaterThan(0);
    expect(run(1000)).toBeCloseTo(run(200), 9);
    expect(run(200)).toBeGreaterThan(run(190));
  });

  it('pushes the burst in the flick direction, left and right', () => {
    const right = flick(T * 2);
    expect(right.push.x).toBeGreaterThan(0);
    expect(right.push.y).toBe(0);
    expect(right.push.z).toBe(0);
    const left = flick(-T * 2);
    expect(left.push.x).toBeLessThan(0);
    expect(left.push.x).toBeCloseTo(-right.push.x, 9);
    expect(left.raise).toBeCloseTo(right.raise, 9);
  });

  it('grows the burst push with speed, in proportion to the velocity, in the flick direction', () => {
    const slow = flick(T * 1.2).push.x;
    const fast = flick(T * 2.4).push.x;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeCloseTo(2 * slow, 9);
  });

  it('stops growing the burst push at the cap', () => {
    const atCap = flick(T * 3).push.x;
    expect(atCap).toBeGreaterThan(flick(T * 2.9).push.x);
    expect(flick(T * 3.5).push.x).toBeCloseTo(atCap, 9);
    expect(flick(T * 50).push.x).toBeCloseTo(atCap, 9);
    expect(flick(-T * 50).push.x).toBeCloseTo(-atCap, 9);
  });

  it('scales the burst push with the burstPush setting', () => {
    const base = flick(T * 2, createDrag(0, { ...S, burstPush: 50 })).push.x;
    const double = flick(T * 2, createDrag(0, { ...S, burstPush: 100 })).push.x;
    expect(base).toBeGreaterThan(0);
    expect(double).toBeCloseTo(2 * base, 9);
  });

  it('flicks vertically: a purely vertical flick above the threshold bursts and pushes along y', () => {
    const down = flick2d(0, T * 2);
    expect(down.raise).toBeCloseTo(flick(T * 2).raise, 9);
    expect(down.push.y).toBeCloseTo(flick(T * 2).push.x, 9);
    expect(down.push.x).toBeCloseTo(0, 9);
    expect(down.push.z).toBe(0);
    const up = flick2d(0, -T * 2);
    expect(up.push.y).toBeCloseTo(-down.push.y, 9);
    expect(up.push.x).toBeCloseTo(0, 9);
  });

  it('measures flick speed as the 2D speed: a diagonal flick pushes along its direction', () => {
    const out = flick2d(T * 1.2, -T * 1.6); // speed 2T
    expect(out.raise).toBeCloseTo(flick(T * 2).raise, 9);
    expect(out.push.x).toBeGreaterThan(0);
    expect(out.push.y).toBeLessThan(0);
    expect(out.push.y / out.push.x).toBeCloseTo(-1.6 / 1.2, 9);
    expect(Math.hypot(out.push.x, out.push.y)).toBeCloseTo(flick(T * 2).push.x, 9);
  });

  it('bursts when only the combined 2D speed is above the threshold', () => {
    const out = flick2d(T * 0.8, T * 0.8); // each component is below, the speed is 1.13 T
    expect(out.raise).toBeGreaterThan(0);
    expect(flick2d(T * 0.6, T * 0.6).raise).toBe(0); // 0.85 T
  });

  it('caps a diagonal flick like a horizontal one', () => {
    const out = flick2d(T * 30, T * 40);
    expect(out.raise).toBeCloseTo(flick(T * 3).raise, 9);
    expect(Math.hypot(out.push.x, out.push.y)).toBeCloseTo(flick(T * 3).push.x, 9);
  });

  it('adds the burst on top of the drag, not instead of it', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 20, 0, 0.05);
    const dragOnly = drag.step(0).raise;
    const drag2 = make();
    drag2.pointerDown(1, 0, 0, 0);
    drag2.pointerMove(1, 20, 0, 0.05);
    drag2.pointerUp(1, 0.05);
    expect(drag2.step(0).raise).toBeGreaterThan(dragOnly);
  });

  it('is consumed by the step, so it fires once', () => {
    const drag = make();
    expect(flick(T * 2, drag).raise).toBeGreaterThan(0);
    const again = drag.step(FRAME);
    expect(again.raise).toBe(0);
    expect(again.push).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('gives no burst when the finger stopped before release', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 20, 0, 0.05); // 400 px/s
    drag.step(0);
    drag.pointerUp(1, 0.5); // held still for 0.45 s, longer than the window
    expect(drag.step(0).raise).toBe(0);
  });

  it('gives no burst when a fast drag slowed down before release', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 40, 0, 0.1); // 400 px/s early on
    drag.pointerMove(1, 41, 0, 0.25);
    drag.pointerMove(1, 42, 0, 0.4); // ~7 px/s over the last window
    drag.step(0);
    drag.pointerUp(1, 0.4);
    expect(drag.step(0).raise).toBe(0);
  });

  it('measures speed over the last window only, so a slow start does not hide a flick', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 1, 0, 1);
    drag.pointerMove(1, 2, 0, 2);
    drag.pointerMove(1, 2 + T * 3 * 0.05, 0, 2.05);
    drag.step(0);
    drag.pointerUp(1, 2.05);
    expect(drag.step(0).raise).toBeGreaterThan(0);
  });

  it('gives no burst for a leftward-then-rightward reversal that ends slow', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, -50, 0, 0.1);
    drag.pointerMove(1, -49, 0, 0.3);
    drag.step(0);
    drag.pointerUp(1, 0.3);
    expect(drag.step(0).raise).toBe(0);
  });

  it('gives no burst for a press and release without moving', () => {
    const drag = make();
    drag.pointerDown(1, 5, 0, 0);
    drag.pointerUp(1, 0.01);
    const out = drag.step(FRAME);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('gives no burst when the release has no time elapsed since the last move (no division by zero)', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 30, 0, 0);
    drag.step(0);
    drag.pointerUp(1, 0);
    const out = drag.step(0);
    expect(Number.isFinite(out.raise)).toBe(true);
    expect(Number.isFinite(out.push.x)).toBe(true);
  });

  it('gives no burst on cancel', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 100, 0, 0.05);
    drag.step(0);
    drag.pointerCancel(1);
    const out = drag.step(0);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('ending a drag', () => {
  it('ignores moves after release', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 10, 0, 1);
    drag.pointerUp(1, 1);
    const turn = drag.step(FRAME).turn;
    drag.pointerMove(1, 500, 0, 2);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(turn);
    expect(out.raise).toBe(0);
  });

  it('ignores moves after cancel', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerCancel(1);
    drag.pointerMove(1, 500, 0, 1);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
  });

  it('keeps the turn made before a cancel', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 20, 0, 1);
    drag.pointerCancel(1);
    expect(drag.step(FRAME).turn).toBeCloseTo(-20 * S.turnPerPixel, 9);
  });

  it('ignores an up, cancel or move for an unknown pointer when nothing is down', () => {
    const drag = make(3);
    drag.pointerUp(9, 1);
    drag.pointerCancel(9);
    drag.pointerMove(9, 10, 0, 1);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(3);
    expect(out.raise).toBe(0);
    expect(out.lean).toBe(0);
  });

  it('can start a fresh drag after release', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerUp(1, 0.5);
    drag.step(FRAME);
    drag.pointerDown(2, 0, 0, 1);
    drag.pointerMove(2, 10, 0, 1.5);
    expect(drag.step(FRAME).raise).toBeCloseTo(10 * S.stirPerPixel, 9);
  });
});

describe('two pointers', () => {
  it('tracks only the first pointer down; moves of a second finger are ignored', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 100, 0, 0.1);
    drag.pointerMove(2, 300, 0, 0.2);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    drag.pointerMove(1, 10, 0, 0.3);
    expect(drag.step(FRAME).turn).toBeCloseTo(-10 * S.turnPerPixel, 9);
  });

  it('does not end the drag when the second finger lifts', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 100, 0, 0.1);
    drag.pointerUp(2, 0.2);
    drag.pointerMove(1, 10, 0, 0.3);
    expect(drag.step(FRAME).turn).toBeCloseTo(-10 * S.turnPerPixel, 9);
  });

  it('does not end the drag when the second finger is cancelled', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 100, 0, 0.1);
    drag.pointerCancel(2);
    drag.pointerMove(1, 10, 0, 0.3);
    expect(drag.step(FRAME).turn).toBeCloseTo(-10 * S.turnPerPixel, 9);
  });

  it('gives no burst when a second finger lifts while the first is still', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 0, 0, 0);
    drag.pointerMove(2, 100, 0, 0.05);
    drag.pointerUp(2, 0.05);
    expect(drag.step(0).raise).toBe(0);
  });

  it('ends the drag when the tracked pointer lifts, and a finger still down does not take over', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 100, 0, 0.1);
    drag.pointerUp(1, 0.2);
    drag.step(FRAME);
    drag.pointerMove(2, 200, 0, 0.3);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('flicks from the tracked pointer even if a second finger is still down', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 500, 0, 0);
    drag.pointerMove(1, T * 2 * 0.05, 0, 0.05);
    drag.step(0);
    drag.pointerUp(1, 0.05);
    expect(drag.step(0).raise).toBeGreaterThan(0);
  });

  it('ignores a repeated down of the tracked id as a new drag start without breaking it', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerDown(2, 50, 0, 0.1);
    drag.pointerMove(1, 20, 0, 0.2);
    drag.pointerUp(1, 0.3);
    drag.pointerUp(2, 0.4);
    expect(drag.step(FRAME).turn).toBeCloseTo(-20 * S.turnPerPixel, 9);
  });
});

describe('invalid input', () => {
  it.each([NaN, Infinity, -Infinity])('throws a RangeError for a non-finite x of %s', (bad) => {
    const drag = make();
    expect(() => drag.pointerDown(1, bad, 0, 0)).toThrow(RangeError);
    drag.pointerDown(1, 0, 0, 0);
    expect(() => drag.pointerMove(1, bad, 0, 0.1)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('throws a RangeError for a non-finite y of %s', (bad) => {
    const drag = make();
    expect(() => drag.pointerDown(1, 0, bad, 0)).toThrow(RangeError);
    drag.pointerDown(1, 0, 0, 0);
    expect(() => drag.pointerMove(1, 0, bad, 0.1)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('throws a RangeError for a non-finite time of %s', (bad) => {
    const drag = make();
    expect(() => drag.pointerDown(1, 0, 0, bad)).toThrow(RangeError);
    drag.pointerDown(1, 0, 0, 0);
    expect(() => drag.pointerMove(1, 1, 0, bad)).toThrow(RangeError);
    expect(() => drag.pointerUp(1, bad)).toThrow(RangeError);
  });

  it('leaves the drag untouched after a rejected move, whichever argument was bad', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    expect(() => drag.pointerMove(1, NaN, 5, 0.1)).toThrow(RangeError);
    expect(() => drag.pointerMove(1, 5, NaN, 0.1)).toThrow(RangeError);
    expect(() => drag.pointerMove(1, 5, 5, NaN)).toThrow(RangeError);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
    drag.pointerMove(1, 10, 0, 0.2);
    expect(drag.step(FRAME).turn).toBeCloseTo(-10 * S.turnPerPixel, 9);
  });

  it('leaves nothing tracked after a rejected down', () => {
    const drag = make();
    expect(() => drag.pointerDown(1, 0, NaN, 0)).toThrow(RangeError);
    drag.pointerMove(1, 50, 0, 0.1);
    expect(drag.step(FRAME).turn).toBe(0);
    drag.pointerDown(2, 0, 0, 0.2);
    drag.pointerMove(2, 10, 0, 0.3);
    expect(drag.step(FRAME).turn).toBeCloseTo(-10 * S.turnPerPixel, 9);
  });

  it('keeps the drag going after a rejected up, with no burst', () => {
    const drag = make();
    drag.pointerDown(1, 0, 0, 0);
    drag.pointerMove(1, 40, 0, 0.05);
    drag.step(0);
    expect(() => drag.pointerUp(1, NaN)).toThrow(RangeError);
    expect(drag.step(0).raise).toBe(0);
    drag.pointerMove(1, 50, 0, 0.1);
    expect(drag.step(0).turn).toBeCloseTo(-50 * S.turnPerPixel, 9);
  });

  it.each([NaN, Infinity, -1])('throws a RangeError for a step of %s seconds', (bad) => {
    expect(() => make().step(bad)).toThrow(RangeError);
  });

  it('throws a RangeError for a non-finite initial turn', () => {
    expect(() => createDrag(NaN, S)).toThrow(RangeError);
  });
});

describe('turnBy (XMAS-44b)', () => {
  it('adds the turn to the next step only, with no stir or burst', () => {
    const drag = make(1);
    drag.turnBy(0.3);
    drag.turnBy(-0.1);
    const out = drag.step(FRAME);
    expect(out.turn).toBeCloseTo(1.2, 9);
    expect(out.raise).toBe(0);
    expect(drag.step(FRAME).turn).toBeCloseTo(1.2, 9);
  });
});
