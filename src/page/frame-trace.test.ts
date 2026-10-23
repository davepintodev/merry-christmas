// XMAS-102 phase 1: the ?perf reporter's per-second split of a frame's cost.
// The trace sums what each drawn frame reports (per-layer ms, draws, canvas
// sizes), counts sim steps per frame and the gap between frames, and take()
// hands over one second and starts the next.
import { describe, expect, it } from 'vitest';
import { createFrameTrace, type FineTrace, type FrameTrace, type TraceSecond } from './frame-trace.ts';

function fine(over: Partial<FineTrace> = {}): FineTrace {
  return {
    glassMs: 1, behindMs: 2, shapesMs: 3, frontMs: 4, baseMs: 5, shapesCalls: 10, behindFlakes: 4, frontFlakes: 3,
    shapesRedrawn: true, glassPainted: true, baseBuilt: false, santaMs: 0, santaPaints: 0, santaSame: 0, shapesClipMs: 0, shapesDrawMs: 0, shapesSameInputs: 0,
    totalMs: 0, inputsMs: 0, shadowsMs: 0, facesMs: 0, shapesRestMs: 0,
    width: 800, height: 600, baseWidth: 400, baseHeight: 50, ...over,
  };
}

describe('createFrameTrace', () => {
  it('reports nothing until a frame is drawn, and nothing twice for the same second', () => {
    const trace = createFrameTrace(() => 0);
    expect(trace.take()).toBeNull();
    trace.step();
    expect(trace.take()).toBeNull();
    trace.frame(fine(), 6, 1000);
    expect(trace.take()).not.toBeNull();
    expect(trace.take()).toBeNull();
  });

  it('splits a second: per-layer ms sum and max, draw calls, flakes, canvas sizes, steps per frame and frame gaps', () => {
    const trace = createFrameTrace(() => 0);
    trace.frame(fine(), 6, 1000);
    trace.step(); trace.step(); trace.step(); // a catch-up burst
    trace.frame(fine({ glassMs: 5, shapesMs: 1, shapesCalls: 0, behindFlakes: 1, frontFlakes: 0, shapesRedrawn: false, glassPainted: false, baseBuilt: true, width: 900, height: 700 }), 4, 1050);
    trace.step();
    trace.frame(fine({ baseMs: 0.5 }), 8, 1066);
    const s = trace.take();
    expect(s).toMatchObject({
      frames: 3, steps: 4, maxStepsPerFrame: 3, maxGapMs: 50,
      workMs: { sum: 18, max: 8 },
      glassMs: { sum: 7, max: 5 },
      behindMs: { sum: 6, max: 2 },
      shapesMs: { sum: 7, max: 3 },
      frontMs: { sum: 12, max: 4 },
      baseMs: { sum: 10.5, max: 5 },
      shapesRedraws: 2, shapesCalls: 20, behindFlakes: 9, frontFlakes: 6, glassPaints: 2, baseBuilds: 1,
      width: 800, height: 600, baseWidth: 400, baseHeight: 50,
    });
  });

  it('starts a new second clean but keeps the last frame time, so the gap spans the boundary', () => {
    const trace = createFrameTrace(() => 0);
    trace.frame(fine(), 1, 1000);
    expect(trace.take()?.maxGapMs).toBe(0);
    trace.step(); trace.step();
    trace.frame(null, 2, 1017);
    const s = trace.take();
    expect(s).toMatchObject({ frames: 1, steps: 2, maxStepsPerFrame: 2, maxGapMs: 17, shapesRedraws: 0, shapesCalls: 0, behindFlakes: 0, frontFlakes: 0, width: 0, height: 0, baseWidth: 0, baseHeight: 0 });
    expect(s?.glassMs).toEqual({ sum: 0, max: 0 });
  });

  it('sums Santa\'s paints and repeats over a second, and spreads his ms (XMAS-107)', () => {
    const trace = createFrameTrace(() => 0);
    trace.frame(fine({ santaMs: 0.5, santaPaints: 1, santaSame: 0 }), 1, 1000);
    trace.frame(fine({ santaMs: 1.5, santaPaints: 1, santaSame: 1 }), 1, 1016);
    trace.frame(fine({ santaMs: 0, santaPaints: 0, santaSame: 0 }), 1, 1033);
    expect(trace.take()).toMatchObject({ santaMs: { sum: 2, max: 1.5 }, santaPaints: 2, santaSame: 1 });
    trace.frame(null, 1, 1050);
    expect(trace.take()).toMatchObject({ santaMs: { sum: 0, max: 0 }, santaPaints: 0, santaSame: 0 });
  });

  it('spreads the shapes clip and drawImage ms and sums same-input redraws over a second (XMAS-108)', () => {
    const trace = createFrameTrace(() => 0);
    trace.frame(fine({ shapesClipMs: 0.5, shapesDrawMs: 2, shapesSameInputs: 1 }), 1, 1000);
    trace.frame(fine({ shapesClipMs: 1.5, shapesDrawMs: 1, shapesSameInputs: 1 }), 1, 1016);
    trace.frame(fine({ shapesClipMs: 0, shapesDrawMs: 0, shapesSameInputs: 0 }), 1, 1033);
    expect(trace.take()).toMatchObject({ shapesClipMs: { sum: 2, max: 1.5 }, shapesDrawMs: { sum: 3, max: 2 }, shapesSameInputs: 2 });
    trace.frame(null, 1, 1050);
    expect(trace.take()).toMatchObject({ shapesClipMs: { sum: 0, max: 0 }, shapesDrawMs: { sum: 0, max: 0 }, shapesSameInputs: 0 });
  });
});

/** A frame must be drawn for take() to hand a second over. */
const take = (t: FrameTrace): TraceSecond => {
  t.frame(null, 1, 0);
  return t.take() as TraceSecond;
};

// XMAS-110 (?perf only): time the whole animation callback and the gap between callbacks,
// count long tasks, long frames and heap drops.
describe('FrameTrace callback timing', () => {
  it('sums and maxes the callback span, and the gap from the previous callback end (none for the first)', () => {
    const t = createFrameTrace(() => 0);
    t.callback(100, 110); // first: no gap
    t.callback(120, 150); // gap 10, span 30
    t.callback(151, 156); // gap 1, span 5
    const s = take(t);
    expect(s.callbackMs).toEqual({ sum: 45, max: 30 });
    expect(s.outsideMs).toEqual({ sum: 11, max: 10 });
  });

  it('the gap spans a take boundary, and the next second starts clean', () => {
    const t = createFrameTrace(() => 0);
    t.callback(0, 10);
    take(t);
    t.callback(40, 45);
    const s = take(t);
    expect(s.callbackMs).toEqual({ sum: 5, max: 5 });
    expect(s.outsideMs).toEqual({ sum: 30, max: 30 });
  });

  it('counts long tasks and long frames apart, with their longest, and resets on take', () => {
    const t = createFrameTrace(() => 0);
    t.longTask('task', 60);
    t.longTask('frame', 20);
    t.longTask('task', 90);
    const s = take(t);
    expect(s.longTasks).toEqual({ count: 2, max: 90 });
    expect(s.longFrames).toEqual({ count: 1, max: 20 });
    expect(take(t).longTasks).toEqual({ count: 0, max: 0 });
  });

  it('counts a heap drop only when a reading is lower than the one before; the first counts none', () => {
    const t = createFrameTrace(() => 0);
    t.heap(5_000_000);
    t.heap(6_000_000);
    t.heap(2_000_000); // GC
    t.heap(2_000_000); // equal: not a drop
    t.heap(1_000_000); // GC
    expect(take(t).heapDrops).toBe(2);
    expect(take(t).heapDrops).toBe(0);
  });
});
