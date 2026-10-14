// XMAS-31b "Scene core", page runtime: the scene file the countdown loads
// lazily. Draws on <canvas id="scene">, one canvas pixel per art pixel,
// scaled up by CSS to the page's one art pixel size (pagePixels), on the
// scene's fixed 60-steps-a-second clock, and marks `globe-ready` when the
// first frame is drawn.
import { makeClock, phaseAt } from '../shared/clock.ts';
import { autoTurn } from '../scene/turn.ts';
import { makeFrameSource, toRgba, type FrameSource } from './frames.ts';
import { runSceneLoop, type LoopHost, type LoopScene } from './loop.ts';
import { pagePixels } from './pixel.ts';
import { STEP_MS } from './steps.ts';

/** The only source of randomness for a page: fixed, so every visit draws the same sky. */
const SEED = 1;

const clock = makeClock(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene');
const context = canvas === null ? null : canvas.getContext('2d');
const frames: FrameSource = makeFrameSource();

/** Steps taken since the scene started; the scene's own clock, not the wall clock. */
let steps = 0;
/** The colour, RGBA and image buffers for one picture size, kept between frames. */
let buffers: { picture: Uint32Array; rgba: Uint8ClampedArray; image: ImageData } | null = null;

/** The device pixel ratio as pagePixels reads it: a nonsense value counts as 1. */
function ratio(): number {
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** One picture size in canvas pixels and CSS pixels; the canvas is re-sized only when it changes. */
function resize(target: HTMLCanvasElement, ratioNow: number): { width: number; height: number } {
  const { scale, width, height } = pagePixels({ width: window.innerWidth, height: window.innerHeight }, ratioNow);
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
    const frame = frames({ time, drag: 0, phase: phaseAt(clock()), seed: SEED, width, height, turn: autoTurn(time) }, buffers.picture);
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

if (canvas !== null && context !== null) runSceneLoop(host, scene);
