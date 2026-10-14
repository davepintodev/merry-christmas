// XMAS-33 "The ?perf readout": the frame loop's observer, the one thing the
// readout hears. A readout that throws is dropped at the call, so the scene
// carries on as if it were not there.

/** The ?perf readout's ears. */
export interface LoopObserver {
  /** One drawn frame: its rAF time and the milliseconds scene.draw() took. */
  frame(time: number, workMs: number): void;
  /** The tab hid: no frames until resume. */
  pause(): void;
  /** The tab came back. */
  resume(): void;
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
