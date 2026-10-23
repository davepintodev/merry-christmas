// XMAS-33 "The ?perf readout": the frame loop's observer, the one thing the
// readout hears. A readout that throws is dropped at the call, so the scene
// carries on as if it were not there.

/** The ?perf readout's ears. */
export interface LoopObserver {
  /** One drawn frame: its rAF time, the milliseconds scene.draw() took, and the part of that the fine layer took (0 without one). */
  frame(time: number, workMs: number, layerMs?: number): void;
  /** The tab hid: no frames until resume. */
  pause(): void;
  /** The tab came back. */
  resume(): void;
  /**
   * One animation callback, from its start to its end on the host clock: the steps and the draw (XMAS-110). Optional, so a
   * readout file that does not time callbacks still fits.
   */
  callback?(startMs: number, endMs: number): void;
}

/** Runs one observer call, if there is an observer; an error from it is ignored. */
export function observeSafely(observer: LoopObserver | undefined, call: (watch: LoopObserver) => void): void {
  if (observer === undefined) return;
  try {
    call(observer);
  } catch {
    // The readout is decoration: a broken one is left alone.
  }
}
