// XMAS-33 "The ?perf readout": the numbers behind the readout, with no page
// in sight. createPerfStats() is fed the two launch marks, one frame() per
// drawn frame (the rAF time and the time scene.draw() took), pause()/resume()
// around a hidden tab and restartWindow() from the readout's button; a
// snapshot() is what the readout shows. Smoothness (spec 12.1) is an average
// of at least 55 fps over 30 s and no frame over 50 ms once the globe is
// ready, so the window average is frames per time, the worst frame is the
// largest gap since globe-ready, and a hidden tab's gap is never a frame.
//
// The readout's file is a separate bundle, so it cannot share the scene's
// version.ts at run time: the version arrives as a getter, read on every
// snapshot.
import { describe, expect, it } from 'vitest';
import { createPerfStats as create } from './perf-stats.ts';
import type { VersionName } from './version.ts';

/** The stats as the readout makes them: the version getter always given, the window optional. */
function createPerfStats(opts: { windowMs?: number; version?: () => VersionName } = {}) {
  const version = opts.version ?? ((): VersionName => 'full scene');
  return create(opts.windowMs === undefined ? { version } : { windowMs: opts.windowMs, version });
}

type PerfStats = ReturnType<typeof createPerfStats>;

const READY = 1200;

/** Feeds frames every `gapMs` from `from` (inclusive) to `to` (inclusive), each with `work` ms of drawing. */
function frames(stats: PerfStats, from: number, to: number, gapMs: number, work: number | ((i: number) => number) = 1): number {
  let i = 0;
  let t = from;
  for (; t <= to + 1e-9; t = from + ++i * gapMs) stats.frame(t, typeof work === 'number' ? work : work(i));
  return from + (i - 1) * gapMs; // the last frame's time
}

/** A stats object with the globe ready at READY and nothing else. */
function ready(windowMs?: number): PerfStats {
  const stats = windowMs === undefined ? createPerfStats() : createPerfStats({ windowMs });
  stats.setCountdownVisible(300);
  stats.setGlobeReady(READY);
  return stats;
}

describe('createPerfStats: before any data', () => {
  it('shows nothing measured yet: every number is null, the window is empty and not done', () => {
    const snap = createPerfStats().snapshot(0);
    expect(snap).toEqual({
      countdownVisibleMs: null,
      globeReadyMs: null,
      fpsNow: null,
      fpsWindow: null,
      windowElapsedMs: 0,
      windowDone: false,
      worstFrameMs: null,
      workMs: null,
      version: 'full scene',
    });
  });

  it('echoes the two launch marks as given, in performance-timeline ms', () => {
    const stats = createPerfStats();
    stats.setCountdownVisible(412.25);
    expect(stats.snapshot(500).countdownVisibleMs).toBe(412.25);
    expect(stats.snapshot(500).globeReadyMs).toBeNull();
    stats.setGlobeReady(987.5);
    expect(stats.snapshot(1000).globeReadyMs).toBe(987.5);
    expect(stats.snapshot(1000).countdownVisibleMs).toBe(412.25);
  });

  it('a single frame after globe-ready has no gap: no worst frame and no average yet', () => {
    const stats = ready();
    stats.frame(READY + 5, 3);
    const snap = stats.snapshot(READY + 5);
    expect(snap.worstFrameMs).toBeNull();
    expect(snap.fpsWindow).toBeNull();
  });

  it('frames before globe-ready count for nothing: long gaps then are not the worst frame', () => {
    const stats = createPerfStats();
    stats.setCountdownVisible(300);
    stats.frame(400, 50);
    stats.frame(900, 50); // a 500 ms gap while the scene was still arriving
    expect(stats.snapshot(900).worstFrameMs).toBeNull();
    expect(stats.snapshot(900).fpsWindow).toBeNull();
    stats.setGlobeReady(910);
    frames(stats, 910, 1910, 20, 2);
    const snap = stats.snapshot(1910);
    expect(snap.worstFrameMs).toBeCloseTo(20, 6);
    expect(snap.fpsWindow).toBeCloseTo(50, 1);
    expect(snap.workMs).toBeCloseTo(2, 6);
  });
});

describe('createPerfStats: the 30 s window average', () => {
  it('is frames over time: a steady 20 ms gap reads 50 fps', () => {
    const stats = ready();
    const last = frames(stats, READY + 10, READY + 10 + 2000, 20);
    expect(stats.snapshot(last).fpsWindow).toBeCloseTo(50, 1);
  });

  it('averages time, not per-frame rates: ten 10 ms and ten 30 ms gaps read 50 fps, not 66.7', () => {
    const stats = ready();
    let t = READY + 1;
    stats.frame(t, 1);
    for (let i = 0; i < 10; i++) stats.frame((t += 10), 1);
    for (let i = 0; i < 10; i++) stats.frame((t += 30), 1);
    expect(stats.snapshot(t).fpsWindow).toBeCloseTo(50, 1);
  });

  it('counts its elapsed time from the first frame after globe-ready', () => {
    const stats = ready();
    const start = READY + 16;
    const last = frames(stats, start, start + 5000, 20);
    const snap = stats.snapshot(last);
    expect(snap.windowElapsedMs).toBeGreaterThanOrEqual(4990);
    expect(snap.windowElapsedMs).toBeLessThanOrEqual(5000);
    expect(snap.windowDone).toBe(false);
  });

  it('freezes at its final value after 30 s, while the last-second rate keeps moving', () => {
    const stats = ready();
    const start = READY + 4;
    const end = frames(stats, start, start + 30_000, 20); // 50 fps for the whole window
    expect(stats.snapshot(end).fpsWindow).toBeCloseTo(50, 1);
    const later = frames(stats, end + 10, end + 5000, 10); // then 100 fps
    const snap = stats.snapshot(later);
    expect(snap.windowDone).toBe(true);
    expect(snap.windowElapsedMs).toBe(30_000);
    expect(snap.fpsWindow).toBeCloseTo(50, 1);
    expect(snap.fpsNow).toBeGreaterThan(95);
    expect(snap.fpsNow).toBeLessThan(105);
  });

  it('honours a custom window length', () => {
    const stats = ready(1000);
    const start = READY + 2;
    const end = frames(stats, start, start + 1000, 20);
    const after = frames(stats, end + 5, end + 3000, 5);
    const snap = stats.snapshot(after);
    expect(snap.windowDone).toBe(true);
    expect(snap.windowElapsedMs).toBe(1000);
    expect(snap.fpsWindow).toBeCloseTo(50, 1);
  });

  it('is not done one frame short of the window', () => {
    const stats = ready(1000);
    const last = frames(stats, READY + 1, READY + 1 + 900, 20);
    const snap = stats.snapshot(last);
    expect(snap.windowDone).toBe(false);
    expect(snap.windowElapsedMs).toBeLessThan(1000);
  });
});

describe('createPerfStats: the last-second rate', () => {
  it('follows the most recent second, not the window: 50 fps then 100 fps', () => {
    const stats = ready();
    const mid = frames(stats, READY + 1, READY + 1 + 2000, 20);
    const last = frames(stats, mid + 10, mid + 1500, 10);
    const snap = stats.snapshot(last);
    expect(snap.fpsNow).toBeGreaterThan(95);
    expect(snap.fpsNow).toBeLessThan(105);
    // 100 gaps over 2000 ms then 150 over 1500 ms: 250 frames in 3500 ms.
    expect(snap.fpsWindow).toBeCloseTo((250 / 3500) * 1000, 0);
  });
});

describe('createPerfStats: the worst frame', () => {
  it('is the largest gap between consecutive frames since globe-ready', () => {
    const stats = ready();
    let t = READY + 3;
    stats.frame(t, 1);
    for (const gap of [16, 17, 45, 16, 33, 16]) stats.frame((t += gap), 1);
    expect(stats.snapshot(t).worstFrameMs).toBe(45);
  });

  it('keeps counting after the window is done', () => {
    const stats = ready(1000);
    const end = frames(stats, READY + 1, READY + 1 + 2000, 20);
    stats.frame(end + 70, 1);
    const snap = stats.snapshot(end + 70);
    expect(snap.windowDone).toBe(true);
    expect(snap.worstFrameMs).toBe(70);
  });

  it('is never lowered by a later, smoother stretch', () => {
    const stats = ready();
    let t = READY + 1;
    stats.frame(t, 1);
    stats.frame((t += 60), 1);
    const last = frames(stats, t + 16, t + 3000, 16);
    expect(stats.snapshot(last).worstFrameMs).toBe(60);
  });
});

describe('createPerfStats: the scene work per frame', () => {
  it('is the average draw time per frame, not the last or the largest', () => {
    const stats = ready();
    const last = frames(stats, READY + 1, READY + 1 + 20_000, 20, (i) => (i % 2 === 0 ? 2 : 6));
    expect(stats.snapshot(last).workMs).toBeCloseTo(4, 1);
  });

  it('belongs to the window: it freezes with it', () => {
    const stats = ready(1000);
    const end = frames(stats, READY + 1, READY + 1 + 1000, 20, 3);
    const later = frames(stats, end + 20, end + 3000, 20, 40);
    expect(stats.snapshot(later).workMs).toBeCloseTo(3, 1);
  });
});

describe('createPerfStats: restarting the window', () => {
  it('starts a fresh window: elapsed 0, not done, no average until new frames arrive', () => {
    const stats = ready(1000);
    const end = frames(stats, READY + 1, READY + 1 + 2000, 20);
    expect(stats.snapshot(end).windowDone).toBe(true);
    stats.restartWindow(end + 5);
    const snap = stats.snapshot(end + 5);
    expect(snap.windowElapsedMs).toBeLessThan(1);
    expect(snap.windowDone).toBe(false);
    expect(snap.fpsWindow).toBeNull();
    expect(snap.workMs).toBeNull();
  });

  it('averages only frames after the restart', () => {
    const stats = ready();
    const end = frames(stats, READY + 1, READY + 1 + 5000, 20, 8); // 50 fps, 8 ms work
    stats.restartWindow(end + 10);
    const last = frames(stats, end + 20, end + 2020, 10, 2); // 100 fps, 2 ms work
    const snap = stats.snapshot(last);
    expect(Math.abs((snap.fpsWindow ?? 0) - 100)).toBeLessThan(1.5);
    expect(snap.workMs).toBeCloseTo(2, 1);
    expect(snap.windowElapsedMs).toBeGreaterThan(1900);
    expect(snap.windowElapsedMs).toBeLessThanOrEqual(2010);
  });

  it('does not reset the worst frame', () => {
    const stats = ready();
    let t = READY + 1;
    stats.frame(t, 1);
    stats.frame((t += 48), 1);
    const end = frames(stats, t + 16, t + 1000, 16);
    stats.restartWindow(end + 1);
    const last = frames(stats, end + 16, end + 1000, 16);
    expect(stats.snapshot(last).worstFrameMs).toBe(48);
  });

  it('runs a full new window after a restart and freezes again', () => {
    const stats = ready(1000);
    const end = frames(stats, READY + 1, READY + 1 + 1500, 20);
    stats.restartWindow(end);
    const end2 = frames(stats, end + 10, end + 1600, 10);
    const snap = stats.snapshot(end2);
    expect(snap.windowDone).toBe(true);
    expect(snap.windowElapsedMs).toBe(1000);
    expect(Math.abs((snap.fpsWindow ?? 0) - 100)).toBeLessThan(1.5);
  });
});

describe('createPerfStats: a hidden tab', () => {
  it('the gap across pause and resume is not a frame: not the worst frame, not window time', () => {
    const stats = ready();
    const before = frames(stats, READY + 1, READY + 1 + 2000, 20);
    stats.pause();
    stats.resume();
    const back = before + 60_000; // a minute away
    const last = frames(stats, back, back + 2000, 20);
    const snap = stats.snapshot(last);
    expect(snap.worstFrameMs).toBe(20);
    expect(snap.fpsWindow).toBeCloseTo(50, 1);
    expect(snap.windowDone).toBe(false);
    expect(snap.windowElapsedMs).toBeLessThan(30_000);
  });

  it('the first frame after resume has no gap, the second one does', () => {
    const stats = ready();
    const before = frames(stats, READY + 1, READY + 1 + 500, 16);
    stats.pause();
    stats.resume();
    stats.frame(before + 5000, 1);
    expect(stats.snapshot(before + 5000).worstFrameMs).toBe(16);
    stats.frame(before + 5000 + 40, 1);
    expect(stats.snapshot(before + 5040).worstFrameMs).toBe(40);
  });

  it('pause and resume before any frame change nothing', () => {
    const stats = ready();
    stats.pause();
    stats.resume();
    const last = frames(stats, READY + 1, READY + 1 + 1000, 20);
    expect(stats.snapshot(last).worstFrameMs).toBe(20);
    expect(stats.snapshot(last).fpsWindow).toBeCloseTo(50, 1);
  });
});

describe('createPerfStats: the version running', () => {
  it('reads the version getter it was given on every snapshot', () => {
    let now: VersionName = 'full scene';
    let calls = 0;
    const stats = createPerfStats({
      version: () => {
        calls++;
        return now;
      },
    });
    expect(stats.snapshot(0).version).toBe('full scene');
    now = 'lighter version';
    expect(stats.snapshot(0).version).toBe('lighter version');
    now = 'every second frame';
    expect(stats.snapshot(0).version).toBe('every second frame');
    expect(calls).toBe(3);
  });

  it('shows what the getter says even when it is not the full scene from the start', () => {
    const stats = createPerfStats({ version: () => 'lighter version' });
    expect(stats.snapshot(0).version).toBe('lighter version');
  });
});
