// XMAS-31b "Scene core", page runtime: the scene's frame loop on the main
// thread. runSceneLoop(host, scene) draws one frame per screen refresh
// (host.requestFrame, i.e. requestAnimationFrame), runs the scene's fixed
// 60-steps-a-second clock before each draw, records `globe-ready` once right
// after the first draw, stops asking for frames while the tab is hidden and
// resumes when it comes back, without replaying the time away.
// XMAS-33 "The ?perf readout": an optional observer hears each drawn frame
// (its rAF time and how long scene.draw() alone took) and the hide and show.
// Without one the loop makes no timing call at all.
// XMAS-79 "Smooth between steps": draw gets how far the frame's time is into
// the next step, so the scene can draw partway between two steps.
import { observeSafely, type LoopObserver } from './loop-observer.ts';
import { makeStepper, type Stepper } from './steps.ts';

/** The page bits the loop needs, so tests can drive it without a browser. */
export interface LoopHost {
  /** requestAnimationFrame. */
  requestFrame(callback: (time: number) => void): number;
  /** cancelAnimationFrame. */
  cancelFrame(handle: number): void;
  /** document.hidden. */
  hidden(): boolean;
  /** The page's visibilitychange subscription. */
  onVisibilityChange(listener: () => void): void;
  /** performance.mark. */
  mark(name: string): void;
  /** performance.now, for the draw timing; the loop falls back to performance.now when absent. */
  now?(): number;
}

export interface LoopScene {
  /** One step of the scene's own 60-steps-a-second clock. */
  step(): void;
  /**
   * Draws the scene as it stands, `fraction` (0 to 1) of the way from its last
   * step to the next one, for the same frame time the steps were counted for.
   * Left out, it draws the last step as it stood (fraction 1).
   * Returns the milliseconds the fine layer took inside the draw, when the scene times them.
   */
  draw(fraction?: number): number | void;
}

/** A scene the page can pause (XMAS-45a). The loop itself never pauses it. */
export interface PausableScene extends LoopScene {
  /** Paused, step() advances nothing and draw() shows the same still frame; setting it twice is harmless. */
  setPaused(paused: boolean): void;
  /** Whether the scene is paused. Starts false on every visit. */
  readonly paused: boolean;
}

export interface SceneLoop {
  /** Ends the loop: the waiting frame request is dropped and no new one is made. */
  stop(): void;
}

export function runSceneLoop(host: LoopHost, scene: LoopScene, observer?: LoopObserver): SceneLoop {
  let handle: number | null = null;
  let stepper: Stepper | null = null;
  let startClock = true; // the first frame starts the clock; a return from hidden restarts it
  let running = true;
  let marked = false;

  function clock(): number {
    return host.now ? host.now() : performance.now();
  }

  function schedule(): void {
    if (!running || host.hidden() || handle !== null) return;
    handle = host.requestFrame(frame);
  }

  function frame(time: number): void {
    handle = null;
    if (!running || host.hidden()) return;
    // XMAS-110: the whole callback, steps and draw, is timed on the host clock only when there is an observer.
    const callbackBegin = observer === undefined ? 0 : clock();
    if (startClock || stepper === null) {
      stepper = makeStepper(time);
      startClock = false;
    }
    const steps = stepper.due(time);
    for (let i = 0; i < steps; i++) scene.step();
    const fraction = stepper.fraction(time);
    if (observer === undefined) {
      scene.draw(fraction);
    } else {
      const begin = clock();
      const layerMs = scene.draw(fraction);
      const workMs = clock() - begin;
      observeSafely(observer, (watch) => watch.frame(time, workMs, typeof layerMs === 'number' ? layerMs : 0));
    }
    if (!marked) {
      marked = true;
      host.mark('globe-ready');
    }
    if (observer !== undefined) {
      const callbackEnd = clock();
      observeSafely(observer, (watch) => watch.callback?.(callbackBegin, callbackEnd));
    }
    schedule();
  }

  function visibility(): void {
    if (!running) return;
    startClock = true;
    if (host.hidden()) {
      if (handle !== null) host.cancelFrame(handle);
      handle = null;
      // The future pause button must call the observer's pause() and resume() too.
      observeSafely(observer, (watch) => watch.pause());
      return;
    }
    observeSafely(observer, (watch) => watch.resume());
    schedule();
  }

  host.onVisibilityChange(visibility);
  schedule();

  return {
    stop(): void {
      running = false;
      if (handle !== null) host.cancelFrame(handle);
      handle = null;
    },
  };
}
