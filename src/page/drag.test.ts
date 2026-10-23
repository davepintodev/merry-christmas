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
const NONE = { x: 0, y: 0, z: 0 };
type Move = [x: number, y: number, t: number];

function make(initialTurn = 0): Drag {
  return createDrag(initialTurn, S);
}

/** A drag with pointer 1 pressed at (x, y) at t = 0. */
function pressed(x = 0, y = 0, initialTurn = 0): Drag {
  const drag = make(initialTurn);
  drag.pointerDown(1, x, y, 0);
  return drag;
}

function moveAll(drag: Drag, moves: Move[], id = 1): Drag {
  for (const [x, y, t] of moves) drag.pointerMove(id, x, y, t);
  return drag;
}

/** Steps `frames` frames of `dt` and checks the lean is finite and within the cap each time. */
function expectBoundedLean(drag: Drag, frames: number, dt: number) {
  for (let i = 0; i < frames; i++) {
    const lean = drag.step(dt).lean;
    expect(Number.isFinite(lean)).toBe(true);
    expect(Math.abs(lean)).toBeLessThanOrEqual(S.maxLean + 1e-9);
  }
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

describe('turning', () => {
  it('starts at the initial turn and has no automatic turn', () => {
    const drag = make(1.25);
    expect(drag.step(1).turn).toBe(1.25);
    expect(drag.step(5).turn).toBe(1.25);
  });

  // Rightward is negative: it carries the front surface right (XMAS-67).
  it.each([
    ['rightward', 10, 40, -30],
    ['leftward', 50, 20, 30],
  ])('turns in proportion to the horizontal distance, %s', (_name, x0, x1, pixels) => {
    const drag = pressed(x0, 0, 1);
    drag.pointerMove(1, x1, 0, 0.5);
    expect(drag.step(FRAME).turn).toBeCloseTo(1 + pixels * S.turnPerPixel, 9);
  });

  it('turns by the horizontal movement only: a vertical drag does not turn, a diagonal turns by its x', () => {
    const vertical = pressed();
    vertical.pointerMove(1, 0, 40, 0.5);
    expect(vertical.step(FRAME).turn).toBe(0);
    const diagonal = pressed();
    diagonal.pointerMove(1, 30, 40, 0.5);
    expect(diagonal.step(FRAME).turn).toBeCloseTo(-30 * S.turnPerPixel, 9);
  });

  it('accumulates across several moves and back-and-forth', () => {
    const drag = moveAll(pressed(), [[30, 0, 0.2], [10, 0, 0.4], [15, 0, 0.6]]);
    expect(drag.step(FRAME).turn).toBeCloseTo(-15 * S.turnPerPixel, 9);
  });

  it('keeps the turn after release and starts the next drag from it', () => {
    const drag = pressed();
    drag.pointerMove(1, 20, 0, 1);
    drag.pointerUp(1, 3);
    const held = drag.step(FRAME).turn;
    expect(drag.step(2).turn).toBe(held);
    drag.pointerDown(1, 100, 0, 10);
    drag.pointerMove(1, 110, 0, 11);
    expect(drag.step(FRAME).turn).toBeCloseTo(held - 10 * S.turnPerPixel, 9);
  });

  it('does not turn or stir when the pointer is not down', () => {
    const drag = make(2);
    drag.pointerMove(1, 500, 0, 1);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(2);
    expect(out.raise).toBe(0);
  });
});

describe('stirring from distance', () => {
  // Stir is the total 2D path length, whatever the direction or how it is split into moves.
  const sixMoves: Move[] = Array.from({ length: 6 }, (_, i) => [(i + 1) * 5, 0, (i + 1) * 0.1]);
  it.each<[string, [number, number], Move[], number]>([
    ['10 px rightward', [0, 0], [[10, 0, 1]], 10],
    ['20 px rightward, twice the 10 px stir', [0, 0], [[20, 0, 1]], 20],
    ['a quarter pixel, no threshold', [0, 0], [[0.25, 0, 1]], 0.25],
    ['leftward and back-and-forth both count', [0, 0], [[-10, 0, 1], [5, 0, 2]], 25],
    ['the same however the distance is split into moves', [0, 0], sixMoves, 30],
    ['a purely vertical drag', [5, 5], [[5, 25, 1]], 20],
    ['a diagonal drag by its 2D length', [0, 0], [[3, 4, 1]], 5],
    ['up-and-down and mixed moves all count', [0, 0], [[0, -10, 1], [0, 5, 2], [6, 13, 3]], 10 + 15 + 10],
    ['moves that arrive between two steps are summed', [0, 0], [[10, 0, 0.1], [20, 0, 0.2]], 20],
  ])('raises in proportion to the path length: %s', (_name, [x0, y0], moves, pixels) => {
    const drag = moveAll(pressed(x0, y0), moves);
    expect(drag.step(FRAME).raise).toBeCloseTo(pixels * S.stirPerPixel, 9);
  });

  it('does not stir for a press with no movement, or a move to the same place', () => {
    const drag = moveAll(pressed(7), [[7, 0, 0.5], [7, 0, 0.6]]);
    const out = drag.step(FRAME);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual(NONE);
    expect(out.turn).toBe(0);
  });

  it('consumes the stir: a second step with no new input raises nothing', () => {
    const drag = pressed();
    drag.pointerMove(1, 40, 0, 1);
    expect(drag.step(FRAME).raise).toBeGreaterThan(0);
    expect(drag.step(FRAME).raise).toBe(0);
  });
});

describe('pushing the snow', () => {
  it.each([
    ['rightward, positive x', 10, 0],
    ['leftward, negative x', -10, 0],
    ['down, positive y', 0, 10],
    ['up, negative y', 0, -10],
    ['diagonal, each sign following its direction', -6, 8],
  ])('pushes toward the drag direction: %s', (_name, dx, dy) => {
    const drag = pressed();
    drag.pointerMove(1, dx, dy, 0.5);
    const { push } = drag.step(FRAME);
    if (dx === 0) expect(push.x).toBe(0);
    else expect(push.x).toBeCloseTo(dx * S.pushPerPixel, 9);
    if (dy === 0) expect(push.y).toBe(0);
    else expect(push.y).toBeCloseTo(dy * S.pushPerPixel, 9);
    expect(push.z).toBe(0);
  });

  it.each(['x', 'y'] as const)('nets out a there-and-back drag along %s between steps', (axis) => {
    const out = moveAll(pressed(), [[axis === 'x' ? 10 : 0, axis === 'y' ? 10 : 0, 0.1], [0, 0, 0.2]]).step(FRAME);
    expect(out.push[axis]).toBeCloseTo(0, 9);
  });

  it('grows with the distance and is consumed by the step', () => {
    const drag = pressed();
    drag.pointerMove(1, 10, 0, 0.5);
    const first = drag.step(FRAME).push.x;
    drag.pointerMove(1, 40, 0, 1);
    const second = drag.step(FRAME).push.x;
    expect(second).toBeCloseTo(3 * first, 9);
    expect(drag.step(FRAME).push).toEqual(NONE);
  });
});

describe('the lean', () => {
  it('leans into a rightward drag and the other way for a leftward one', () => {
    const right = pressed();
    const left = pressed();
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

  it('is zero before any drag, and while the finger is held still after pressing', () => {
    expect(make().step(FRAME).lean).toBe(0);
    const drag = pressed();
    for (let i = 0; i < 30; i++) expect(drag.step(FRAME).lean).toBe(0);
  });

  it('is kicked by motion: a single move leans the globe on the next step', () => {
    const drag = pressed();
    drag.pointerMove(1, 20, 0, FRAME);
    expect(drag.step(FRAME).lean).toBeGreaterThan(0);
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
    const drag = pressed();
    let still = 0;
    for (let i = 1; i <= 120; i++) {
      drag.pointerMove(1, i * 3, 0, i * FRAME);
      drag.step(FRAME);
    }
    for (let i = 0; i < 60 * 3; i++) still = drag.step(FRAME).lean;
    expect(Math.abs(still)).toBeLessThan(1e-3);
  });

  it.each([1, -1])('never exceeds the maximum lean, however hard the drag (direction %i)', (dir) => {
    const drag = pressed();
    for (let i = 1; i <= 120; i++) {
      drag.pointerMove(1, dir * i * 500, 0, i * FRAME);
      expect(Math.abs(drag.step(FRAME).lean)).toBeLessThanOrEqual(S.maxLean + 1e-9);
    }
  });

  it.each<[string, (drag: Drag) => void]>([
    ['release', (drag) => drag.pointerUp(1, 21 * FRAME)],
    ['cancel', (drag) => drag.pointerCancel(1)],
  ])('springs back to nearly upright within 5 s of %s, and stays there', (_name, end) => {
    const drag = make();
    expect(dragRight(drag)).toBeGreaterThan(0.01);
    end(drag);
    let lean = 1;
    for (let i = 0; i < 60 * 5; i++) lean = drag.step(FRAME).lean;
    expect(Math.abs(lean)).toBeLessThan(1e-3);
    for (let i = 0; i < 60; i++) expect(Math.abs(drag.step(FRAME).lean)).toBeLessThan(1e-3);
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
    const drag = pressed();
    drag.pointerMove(1, 100, 0, 0.1);
    expectBoundedLean(drag, 5, 2);
    drag.pointerMove(1, 300, 0, 0.2);
    drag.pointerUp(1, 0.2);
    expectBoundedLean(drag, 20, 2);
  });
});

describe('the flick', () => {
  it.each([T, T * 0.5])('adds no burst at or below the threshold speed (%f)', (speed) => {
    const out = flick(speed);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual(NONE);
  });

  it('adds a burst already worth a full unit of stir just above the threshold, not starting at zero', () => {
    const out = flick(T * 1.01);
    expect(out.raise).toBeGreaterThanOrEqual(S.burstStir);
    expect(out.raise).toBeLessThan(flick(T * 2).raise);
    expect(out.push.x).toBeGreaterThan(0);
  });

  it('raises by burstStir times the speed in multiples of the threshold, bigger for a faster flick', () => {
    expect(flick(T * 2).raise).toBeCloseTo(S.burstStir * 2, 9);
    expect(flick(T * 1.25).raise).toBeCloseTo(S.burstStir * 1.25, 9);
    expect(flick(T * 2.4).raise).toBeCloseTo(2 * flick(T * 1.2).raise, 9);
    const a = flick(T * 1.5).raise;
    const b = flick(T * 2).raise;
    const c = flick(T * 2.5).raise;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('caps the burst and its push at three times the threshold speed', () => {
    const atCap = flick(T * 3);
    expect(atCap.raise).toBeCloseTo(S.burstStir * 3, 9);
    expect(atCap.raise).toBeGreaterThan(flick(T * 2.9).raise);
    expect(atCap.push.x).toBeGreaterThan(flick(T * 2.9).push.x);
    for (const speed of [T * 3.5, T * 50]) {
      expect(flick(speed).raise).toBeCloseTo(atCap.raise, 9);
      expect(flick(speed).push.x).toBeCloseTo(atCap.push.x, 9);
    }
    expect(flick(-T * 50).push.x).toBeCloseTo(-atCap.push.x, 9);
  });

  it('honours a custom burst cap and threshold', () => {
    const run = (speed: number) =>
      flick(speed, createDrag(0, { ...S, flickThreshold: 100, burstCap: 2 })).raise;
    expect(run(100)).toBe(0);
    expect(run(150)).toBeGreaterThan(0);
    expect(run(1000)).toBeCloseTo(run(200), 9);
    expect(run(200)).toBeGreaterThan(run(190));
  });

  it('pushes the burst in the flick direction, left and right, in proportion to the velocity', () => {
    const right = flick(T * 2);
    expect(right.push.x).toBeGreaterThan(0);
    expect(right.push.y).toBe(0);
    expect(right.push.z).toBe(0);
    const left = flick(-T * 2);
    expect(left.push.x).toBeLessThan(0);
    expect(left.push.x).toBeCloseTo(-right.push.x, 9);
    expect(left.raise).toBeCloseTo(right.raise, 9);
    const slow = flick(T * 1.2).push.x;
    const fast = flick(T * 2.4).push.x;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeCloseTo(2 * slow, 9);
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
    expect(flick2d(T * 0.8, T * 0.8).raise).toBeGreaterThan(0); // each component is below, the speed is 1.13 T
    expect(flick2d(T * 0.6, T * 0.6).raise).toBe(0); // 0.85 T
  });

  it('caps a diagonal flick like a horizontal one', () => {
    const out = flick2d(T * 30, T * 40);
    expect(out.raise).toBeCloseTo(flick(T * 3).raise, 9);
    expect(Math.hypot(out.push.x, out.push.y)).toBeCloseTo(flick(T * 3).push.x, 9);
  });

  it('adds the burst on top of the drag, not instead of it', () => {
    const dragOnly = pressed();
    dragOnly.pointerMove(1, 20, 0, 0.05);
    const released = pressed();
    released.pointerMove(1, 20, 0, 0.05);
    released.pointerUp(1, 0.05);
    expect(released.step(0).raise).toBeGreaterThan(dragOnly.step(0).raise);
  });

  it('is consumed by the step, so it fires once', () => {
    const drag = make();
    expect(flick(T * 2, drag).raise).toBeGreaterThan(0);
    const again = drag.step(FRAME);
    expect(again.raise).toBe(0);
    expect(again.push).toEqual(NONE);
  });

  it('measures speed over the last window only, so a slow start does not hide a flick', () => {
    const drag = moveAll(pressed(), [[1, 0, 1], [2, 0, 2], [2 + T * 3 * 0.05, 0, 2.05]]);
    drag.step(0);
    drag.pointerUp(1, 2.05);
    expect(drag.step(0).raise).toBeGreaterThan(0);
  });

  // `end` is the release time, or null for a cancel.
  it.each<[string, Move[], number | null]>([
    ['the finger stopped before release (400 px/s, then held still longer than the window)', [[20, 0, 0.05]], 0.5],
    ['a fast drag slowed down before release (~7 px/s over the last window)', [[40, 0, 0.1], [41, 0, 0.25], [42, 0, 0.4]], 0.4],
    ['a leftward-then-rightward reversal that ends slow', [[-50, 0, 0.1], [-49, 0, 0.3]], 0.3],
    ['a press and release without moving', [], 0.01],
    ['a cancel', [[100, 0, 0.05]], null],
  ])('gives no burst when %s', (_name, moves, end) => {
    const drag = moveAll(pressed(), moves);
    drag.step(0);
    if (end === null) drag.pointerCancel(1);
    else drag.pointerUp(1, end);
    const out = drag.step(0);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual(NONE);
  });

  it('gives a finite result when the release has no time elapsed since the last move (no division by zero)', () => {
    const drag = pressed();
    drag.pointerMove(1, 30, 0, 0);
    drag.step(0);
    drag.pointerUp(1, 0);
    const out = drag.step(0);
    expect(Number.isFinite(out.raise)).toBe(true);
    expect(Number.isFinite(out.push.x)).toBe(true);
  });
});

describe('ending a drag', () => {
  it.each<[string, (drag: Drag) => void]>([
    ['release', (drag) => drag.pointerUp(1, 1)],
    ['cancel', (drag) => drag.pointerCancel(1)],
  ])('keeps the turn made before a %s and ignores moves after it', (_name, end) => {
    const drag = pressed();
    drag.pointerMove(1, 20, 0, 1);
    end(drag);
    const turn = drag.step(FRAME).turn;
    expect(turn).toBeCloseTo(-20 * S.turnPerPixel, 9);
    drag.pointerMove(1, 500, 0, 2);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(turn);
    expect(out.raise).toBe(0);
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
    const drag = pressed();
    drag.pointerUp(1, 0.5);
    drag.step(FRAME);
    drag.pointerDown(2, 0, 0, 1);
    drag.pointerMove(2, 10, 0, 1.5);
    expect(drag.step(FRAME).raise).toBeCloseTo(10 * S.stirPerPixel, 9);
  });
});

describe('two pointers', () => {
  it.each<[string, (drag: Drag) => void]>([
    ['moves', (drag) => drag.pointerMove(2, 300, 0, 0.2)],
    ['lifts', (drag) => drag.pointerUp(2, 0.2)],
    ['is cancelled', (drag) => drag.pointerCancel(2)],
  ])('tracks only the first pointer down: a second finger that %s does not affect or end the drag', (_name, act) => {
    const drag = pressed();
    drag.pointerDown(2, 100, 0, 0.1);
    act(drag);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    drag.pointerMove(1, 10, 0, 0.3);
    expect(drag.step(FRAME).turn).toBeCloseTo(-10 * S.turnPerPixel, 9);
  });

  it('gives no burst when a second finger lifts while the first is still', () => {
    const drag = pressed();
    drag.pointerDown(2, 0, 0, 0);
    drag.pointerMove(2, 100, 0, 0.05);
    drag.pointerUp(2, 0.05);
    expect(drag.step(0).raise).toBe(0);
  });

  it('ends the drag when the tracked pointer lifts, and a finger still down does not take over', () => {
    const drag = pressed();
    drag.pointerDown(2, 100, 0, 0.1);
    drag.pointerUp(1, 0.2);
    drag.step(FRAME);
    drag.pointerMove(2, 200, 0, 0.3);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual(NONE);
  });

  it('flicks from the tracked pointer even if a second finger is still down', () => {
    const drag = pressed();
    drag.pointerDown(2, 500, 0, 0);
    drag.pointerMove(1, T * 2 * 0.05, 0, 0.05);
    drag.step(0);
    drag.pointerUp(1, 0.05);
    expect(drag.step(0).raise).toBeGreaterThan(0);
  });

  it('ignores a repeated down of the tracked id as a new drag start without breaking it', () => {
    const drag = pressed();
    drag.pointerDown(2, 50, 0, 0.1);
    drag.pointerMove(1, 20, 0, 0.2);
    drag.pointerUp(1, 0.3);
    drag.pointerUp(2, 0.4);
    expect(drag.step(FRAME).turn).toBeCloseTo(-20 * S.turnPerPixel, 9);
  });
});

describe('invalid input', () => {
  it.each([NaN, Infinity, -Infinity])('throws a RangeError for a non-finite x, y or time of %s', (bad) => {
    const drag = make();
    expect(() => drag.pointerDown(1, bad, 0, 0)).toThrow(RangeError);
    expect(() => drag.pointerDown(1, 0, bad, 0)).toThrow(RangeError);
    expect(() => drag.pointerDown(1, 0, 0, bad)).toThrow(RangeError);
    drag.pointerDown(1, 0, 0, 0);
    expect(() => drag.pointerMove(1, bad, 0, 0.1)).toThrow(RangeError);
    expect(() => drag.pointerMove(1, 0, bad, 0.1)).toThrow(RangeError);
    expect(() => drag.pointerMove(1, 1, 0, bad)).toThrow(RangeError);
    expect(() => drag.pointerUp(1, bad)).toThrow(RangeError);
  });

  it('leaves the drag untouched after a rejected move, whichever argument was bad', () => {
    const drag = pressed();
    expect(() => drag.pointerMove(1, NaN, 5, 0.1)).toThrow(RangeError);
    expect(() => drag.pointerMove(1, 5, NaN, 0.1)).toThrow(RangeError);
    expect(() => drag.pointerMove(1, 5, 5, NaN)).toThrow(RangeError);
    const out = drag.step(FRAME);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
    expect(out.push).toEqual(NONE);
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
    const drag = pressed();
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
