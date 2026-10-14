// XMAS-31b "Scene core", page runtime: the scene file the countdown loads
// lazily. Draws on <canvas id="scene">, one canvas pixel per art pixel,
// scaled up by CSS to the page's one art pixel size (pagePixels), on the
// scene's fixed 60-steps-a-second clock, and marks `globe-ready` when the
// first frame is drawn.
// XMAS-33 "The ?perf readout": with the hidden ?perf option the scene loads
// the readout's file and passes the loop an observer; without it, nothing of
// the readout is loaded or timed.
import { makeClock, phaseAt, timeLeft } from '../shared/clock.ts';
import { autoTurn } from '../scene/turn.ts';
import { makeFrameSource, toRgba, type FrameSource } from './frames.ts';
import { runSceneLoop, type LoopHost, type LoopScene } from './loop.ts';
import { wantsPerf } from './perf-option.ts';
import { readoutLink } from './scene-perf.ts';
import { pagePixels } from './pixel.ts';
import { makeSnowRuntime } from './snow-runtime.ts';
import { STEP_MS } from './steps.ts';

/** The only source of randomness for a page: fixed, so every visit draws the same sky. */
const SEED = 1;

// The readout file's URL. tools/countdown-plugin.ts fills this in: the build
// names the emitted /assets/perf-<hash>.js, the dev server the source file.
const PERF_URL = '%PERF_URL%';

const clock = makeClock(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene');
const context = canvas === null ? null : canvas.getContext('2d');
const frames: FrameSource = makeFrameSource();
const snow = makeSnowRuntime(SEED);

/** Steps taken since the scene started; the scene's own clock, not the wall clock. */
let steps = 0;
/** The colour, RGBA and image buffers for one picture size, kept between frames. */
let buffers: { picture: Uint32Array; rgba: Uint8ClampedArray; image: ImageData } | null = null;

/** The device pixel ratio as pagePixels reads it: a nonsense value counts as 1. */
function ratio(): number {
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** The window's picture as pagePixels sizes it: the scale and the size in canvas pixels, read without touching the canvas. */
function windowPixels(ratioNow: number): { scale: number; width: number; height: number } {
  return pagePixels({ width: window.innerWidth, height: window.innerHeight }, ratioNow);
}

/** One picture size in canvas pixels and CSS pixels; the canvas is re-sized only when it changes. */
function resize(target: HTMLCanvasElement, ratioNow: number): { width: number; height: number } {
  const { scale, width, height } = windowPixels(ratioNow);
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const cssWidth = `${(width * scale) / ratioNow}px`;
  const cssHeight = `${(height * scale) / ratioNow}px`;
  if (target.style.width !== cssWidth) target.style.width = cssWidth;
  if (target.style.height !== cssHeight) target.style.height = cssHeight;
  return { width, height };
}

const scene: LoopScene = {
  step(): void {
    steps++;
    const { width, height } = windowPixels(ratio());
    snow.step({ turn: autoTurn(steps * STEP_MS), christmasDay: timeLeft(clock()).christmasDay, width, height });
  },
  draw(): void {
    if (canvas === null || context === null) return;
    const dpr = ratio();
    const { width, height } = resize(canvas, dpr);
    const size = width * height;
    if (buffers === null || buffers.picture.length !== size) {
      const picture = new Uint32Array(size);
      const rgba = new Uint8ClampedArray(size * 4);
      buffers = { picture, rgba, image: new ImageData(rgba, width, height) };
    }
    const time = steps * STEP_MS;
    const frame = frames(
      {
        time,
        drag: 0,
        phase: phaseAt(clock()),
        seed: SEED,
        width,
        height,
        turn: autoTurn(time),
        snow: snow.snow ?? undefined,
        outsideSnow: snow.outsideSnow ?? undefined,
      },
      buffers.picture,
    );
    toRgba(frame.picture, buffers.rgba);
    context.putImageData(buffers.image, 0, 0);
  },
};

const host: LoopHost = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  hidden: () => document.hidden,
  onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
  mark: (name) => performance.mark(name),
};

const readout = wantsPerf(location.search) ? readoutLink() : undefined;

if (canvas !== null && context !== null) {
  runSceneLoop(host, scene, readout?.observer);
  readout?.load(PERF_URL);
}
