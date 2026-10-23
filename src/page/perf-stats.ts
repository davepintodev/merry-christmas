// XMAS-33 "The ?perf readout": the numbers behind the readout, with no page
// in sight. The page feeds it the two launch marks, one frame() per drawn
// frame (the rAF time and the time scene.draw() took), pause()/resume()
// around a hidden tab and restartWindow() from the readout's button; a
// snapshot() is what the readout shows. Smoothness (spec 12.1) is an average
// of at least 55 fps over 30 s and no frame over 50 ms once the globe is
// ready, so the window average is frames per time, the worst frame is the
// largest gap since globe-ready, and a hidden tab's gap is never a frame.
import type { VersionName } from './version.ts';

/** The window the average covers: 30 s. */
export const WINDOW_MS = 30_000;

/** How far back the last-second rate looks. */
const RECENT_MS = 1000;

export interface PerfSnapshot {
  countdownVisibleMs: number | null;
  globeReadyMs: number | null;
  fpsNow: number | null;
  fpsWindow: number | null;
  windowElapsedMs: number;
  windowDone: boolean;
  worstFrameMs: number | null;
  workMs: number | null;
  version: VersionName;
}

/** `version` is read afresh by every snapshot(), so a version the scene switches to later shows. */
export function createPerfStats({ windowMs = WINDOW_MS, version }: { windowMs?: number; version: () => VersionName }) {
  let countdownVisibleMs: number | null = null;
  let globeReadyMs: number | null = null;
  let lastFrame: number | null = null; // the last counted frame; null means the next frame starts afresh
  let windowFrom = -Infinity; // when the window last restarted: time before it is not window time
  let windowElapsed = 0; // window time so far, never more than windowMs
  let windowFrames = 0; // frames in the window; a gap cut by the window's end counts for its share
  let workTotal = 0;
  let workCount = 0;
  let worst: number | null = null;
  let recent: number[] = []; // frame times in the last second

  /** Adds the part of one gap, from start to end, that falls in the window. */
  function countWindow(start: number, end: number): void {
    const span = end - Math.max(start, windowFrom);
    const take = Math.min(span, windowMs - windowElapsed);
    if (take <= 0) return;
    windowElapsed = Math.min(windowMs, windowElapsed + take);
    windowFrames += take / (end - start);
  }

  /** A hidden tab's gap is not a frame: the next frame starts afresh. */
  function breakFrames(): void {
    lastFrame = null;
    recent = [];
  }

  return {
    setCountdownVisible(ms: number): void {
      countdownVisibleMs = ms;
    },
    setGlobeReady(ms: number): void {
      globeReadyMs = ms;
    },
    frame(time: number, workMs: number): void {
      if (globeReadyMs === null) return; // nothing counts before the globe is ready
      if (windowElapsed < windowMs) {
        workTotal += workMs;
        workCount++;
      }
      if (lastFrame !== null) {
        const gap = time - lastFrame;
        worst = Math.max(worst ?? gap, gap);
        countWindow(lastFrame, time);
      }
      lastFrame = time;
      recent = recent.filter((t) => t >= time - RECENT_MS);
      recent.push(time);
    },
    pause: breakFrames,
    resume: breakFrames,
    restartWindow(time: number): void {
      windowFrom = time;
      windowElapsed = 0;
      windowFrames = 0;
      workTotal = 0;
      workCount = 0;
    },
    snapshot(time: number): PerfSnapshot {
      const lastSecond = recent.filter((t) => t >= time - RECENT_MS);
      const span = lastSecond.length > 1 ? (lastSecond[lastSecond.length - 1] ?? 0) - (lastSecond[0] ?? 0) : 0;
      return {
        countdownVisibleMs,
        globeReadyMs,
        fpsNow: span > 0 ? ((lastSecond.length - 1) / span) * 1000 : null,
        fpsWindow: windowElapsed > 0 ? (windowFrames / windowElapsed) * 1000 : null,
        windowElapsedMs: windowElapsed,
        windowDone: windowElapsed >= windowMs,
        worstFrameMs: worst,
        workMs: workCount > 0 ? workTotal / workCount : null,
        version: version(),
      };
    },
  };
}
