// XMAS-31b "Scene core", page runtime: the scene's frame loop on the main
// thread. runSceneLoop(host, scene) draws one frame per screen refresh
// (host.requestFrame, i.e. requestAnimationFrame), runs the scene's fixed
// 60-steps-a-second clock before each draw, records `globe-ready` once right
// after the first draw, stops asking for frames while the tab is hidden and
// resumes when it comes back, without replaying the time away.
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
}

export interface LoopScene {
  /** One step of the scene's own 60-steps-a-second clock. */
  step(): void;
  /** Draws the scene as it stands. */
  draw(): void;
}

export interface SceneLoop {
  /** Ends the loop: the waiting frame request is dropped and no new one is made. */
  stop(): void;
}

export function runSceneLoop(host: LoopHost, scene: LoopScene): SceneLoop {
  let handle: number | null = null;
  let stepper: Stepper | null = null;
  let startClock = true; // the first frame starts the clock; a return from hidden restarts it
  let running = true;
  let marked = false;

  function schedule(): void {
    if (!running || host.hidden() || handle !== null) return;
    handle = host.requestFrame(frame);
  }

  function frame(time: number): void {
    handle = null;
    if (!running || host.hidden()) return;
    if (startClock || stepper === null) {
      stepper = makeStepper(time);
      startClock = false;
    }
    const steps = stepper.due(time);
    for (let i = 0; i < steps; i++) scene.step();
    scene.draw();
    if (!marked) {
      marked = true;
      host.mark('globe-ready');
    }
    schedule();
  }

  function visibility(): void {
    if (!running) return;
    startClock = true;
    if (host.hidden()) {
      if (handle !== null) host.cancelFrame(handle);
      handle = null;
      return;
    }
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
