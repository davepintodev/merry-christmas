// XMAS-43b "Shake wiring and the shake button": asks for motion access where the browser needs a tap for it, listens
// for motion readings, and passes them to the shake model (shake.ts). Where no tap is needed it listens at once. Where
// it is needed, the page shows a button; a tap asks, and the answer decides whether the page ever listens. Real motion
// data keeps it listening; without any within SHAKE_SETTINGS.waitSec it gives up and stops listening.
import { createShake, SHAKE_SETTINGS, type MotionReading, type ShakeOutput } from './shake.ts';

/** The browser's motion facts and calls, as the page needs them: the window in the page, a fake in the tests. */
export interface ShakeHost {
  /** Whether the browser wants a tap before it gives motion access. */
  needsTap: boolean;
  /** Whether the browser has motion events at all. */
  available: boolean;
  /** Asks for motion access. Must be called inside the tap. */
  requestPermission(): Promise<string>;
  /** Listens for readings; returns the function that stops listening. */
  listen(handler: (reading: MotionReading) => void): () => void;
  /** Calls `fn` after `ms`; returns the function that cancels the call. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** What the page does with the shake: whether to show the button, whether it is live, and the tap. */
export interface ShakeAccess {
  /** Whether the page shows the shake button: only while a tap is still needed to ask for access. */
  readonly buttonShown: boolean;
  /** Whether real motion data has arrived: the shake is on, and the hint may say so. */
  readonly live: boolean;
  /** The button's press: asks for access now, once. Resolves when the answer is in and acted on; never rejects. */
  tap(): Promise<void>;
  /** The stir and push built up since the last take(); nothing while the page is not listening. */
  take(): ShakeOutput;
}

/** The constructor the browser exposes as DeviceMotionEvent; iOS adds requestPermission to it. */
interface MotionConstructor {
  requestPermission?: () => Promise<string>;
}

/** The host for a window: DeviceMotionEvent and its devicemotion events, with the window's timers. */
export function hostFromWindow(win: Window): ShakeHost {
  // Read as an untyped field: the permission call is not in the DOM typings, and its absence must not throw.
  const motion = (win as unknown as { DeviceMotionEvent?: MotionConstructor | null }).DeviceMotionEvent;
  return {
    needsTap: typeof motion?.requestPermission === 'function',
    available: motion !== undefined && motion !== null,
    requestPermission() {
      return motion?.requestPermission?.() ?? Promise.resolve('unavailable');
    },
    listen(handler) {
      const onMotion = (event: Event) => {
        const e = event as DeviceMotionEvent;
        handler({
          timeSec: e.timeStamp / 1000,
          acceleration: e.acceleration,
          accelerationIncludingGravity: e.accelerationIncludingGravity,
        });
      };
      win.addEventListener('devicemotion', onMotion);
      return () => win.removeEventListener('devicemotion', onMotion);
    },
    setTimer(fn, ms) {
      const id = win.setTimeout(fn, ms);
      return () => win.clearTimeout(id);
    },
  };
}

/** Asks for access now, inside the tap; a request that throws counts as a refusal, like one that rejects. */
function ask(host: ShakeHost): Promise<string> {
  try {
    return Promise.resolve(host.requestPermission());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createShakeAccess(host: ShakeHost): ShakeAccess {
  const shake = createShake();

  // Without motion events there is nothing to show and nothing to listen to.
  let buttonShown = host.available && host.needsTap;
  let asking = false;
  let listening = false;
  let live = false;
  let stopListening: (() => void) | null = null;
  let cancelWait: (() => void) | null = null;

  function reading(r: MotionReading): void {
    if (!listening) return;
    shake.reading(r);
    if (!shake.active) return;
    live = true;
    cancelWait?.();
    cancelWait = null;
  }

  function stop(): void {
    listening = false;
    cancelWait?.();
    cancelWait = null;
    stopListening?.();
    stopListening = null;
  }

  function start(): void {
    listening = true;
    try {
      stopListening = host.listen(reading);
      cancelWait = host.setTimer(() => {
        cancelWait = null;
        if (!shake.active) stop();
      }, SHAKE_SETTINGS.waitSec * 1000);
    } catch {
      // A browser that cannot listen or time after the grant is a refusal: whatever did start is undone.
      stop();
    }
  }

  function tap(): Promise<void> {
    if (!buttonShown || asking) return Promise.resolve();
    asking = true;
    // Once the answer is in, the button goes and the question is no longer pending, whatever the answer.
    const settle = (answer: string | null) => {
      buttonShown = false;
      asking = false;
      if (answer === 'granted') start();
    };
    return ask(host).then(settle, () => settle(null));
  }

  if (host.available && !host.needsTap) start();

  return {
    get buttonShown() {
      return buttonShown;
    },
    get live() {
      return live;
    },
    tap,
    take() {
      const out = shake.take();
      // Readings taken while not listening are dropped, so a stopped page adds nothing.
      return listening ? out : { raise: 0, push: { x: 0, y: 0, z: 0 } };
    },
  };
}
