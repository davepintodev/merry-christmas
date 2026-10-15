// XMAS-31b "Scene core", page runtime: the scene file the countdown loads
// lazily. Draws on <canvas id="scene">, one canvas pixel per art pixel,
// scaled up by CSS to the page's one art pixel size (pagePixels), on the
// scene's fixed 60-steps-a-second clock, and marks `globe-ready` when the
// first frame is drawn.
// XMAS-33 "The ?perf readout": with the hidden ?perf option the scene loads
// the readout's file and passes the loop an observer; without it, nothing of
// the readout is loaded or timed.
// XMAS-41b2 "Drag input": a drag on the globe turns and leans it and stirs the
// snow. The pointer is attached before the loop starts, so before globe-ready.
import { makeClock, phaseAt, timeLeft } from '../shared/clock.ts';
import { makeFrameSource, toRgba, type FrameSource } from './frames.ts';
import { createDrag } from './drag.ts';
import { runSceneLoop, type LoopHost, type LoopScene } from './loop.ts';
import { attachPointer } from './pointer.ts';
import { wantsPerf } from './perf-option.ts';
import { readoutLink } from './scene-perf.ts';
import { pagePixels } from './pixel.ts';
import { makeSnowRuntime } from './snow-runtime.ts';
import { STEPS_PER_SECOND, STEP_MS } from './steps.ts';

/** The only source of randomness for a page: fixed, so every visit draws the same sky. */
const SEED = 1;

/** Where the globe starts, in radians, so the house is not square on at time 0. */
const START_TURN = 0.5;

// The readout file's URL. tools/countdown-plugin.ts fills this in: the build
// names the emitted /assets/perf-<hash>.js, the dev server the source file.
const PERF_URL = '%PERF_URL%';

const clock = makeClock(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('canvas#scene');
const context = canvas === null ? null : canvas.getContext('2d');
const frames: FrameSource = makeFrameSource();
const snow = makeSnowRuntime(SEED);
let drag = createDrag(START_TURN);
/** The art pixel size the drag was started under, and how to take its pointer back off. */
let dragScale = 0;
let detachPointer: (() => void) | null = null;

/** Steps taken since the scene started; the scene's own clock, not the wall clock. */
let steps = 0;
/** The globe's turn and lean as the last scene step left them; the frame draws these. */
let pose = { turn: START_TURN, lean: 0 };
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

/** A client point as art pixels: one art pixel is `scale` physical pixels, so `scale / ratio` CSS pixels. */
function artPoint(target: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const box = target.getBoundingClientRect();
  const dpr = ratio();
  const cssPerArt = windowPixels(dpr).scale / dpr;
  return { x: (clientX - box.left) / cssPerArt, y: (clientY - box.top) / cssPerArt };
}

/**
 * Starts the drag on `target` for the art pixel size `scale`. A new drag replaces
 * the old one, which cancels the drag in progress: a move measured in the old
 * art pixels would jump by the difference when the size changes.
 */
function startDrag(target: HTMLCanvasElement, scale: number): void {
  detachPointer?.();
  drag = createDrag(pose.turn);
  dragScale = scale;
  // Pointer times are performance.now() at delivery: the browser merges queued moves, so an event's own timestamp can lag.
  detachPointer = attachPointer(target, drag, (x, y) => artPoint(target, x, y), () => performance.now() / 1000);
}

/** One picture size in canvas pixels and CSS pixels; the canvas is re-sized only when it changes. */
function resize(target: HTMLCanvasElement, ratioNow: number): { scale: number; width: number; height: number } {
  const { scale, width, height } = windowPixels(ratioNow);
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const cssWidth = `${(width * scale) / ratioNow}px`;
  const cssHeight = `${(height * scale) / ratioNow}px`;
  if (target.style.width !== cssWidth) target.style.width = cssWidth;
  if (target.style.height !== cssHeight) target.style.height = cssHeight;
  // Left edge on a whole device pixel, so every art pixel stays a whole number of device pixels (crisp at fractional ratios).
  // The layout keeps `left: 50%` so the box does not jump when the scene arrives; the rounding goes into the translate.
  // That assumes no scrollbar, so `left: 50%` is innerWidth / 2 (index.html sets overflow hidden).
  const left = Math.round(((window.innerWidth - (width * scale) / ratioNow) / 2) * ratioNow) / ratioNow;
  const transform = `translateX(${left - window.innerWidth / 2}px)`;
  if (target.style.transform !== transform) target.style.transform = transform;
  return { scale, width, height };
}

const scene: LoopScene = {
  step(): void {
    steps++;
    const { width, height } = windowPixels(ratio());
    const out = drag.step(1 / STEPS_PER_SECOND);
    pose = { turn: out.turn, lean: out.lean };
    snow.step({
      turn: out.turn,
      christmasDay: timeLeft(clock()).christmasDay,
      width,
      height,
      raise: out.raise,
      push: out.push,
    });
  },
  draw(): void {
    if (canvas === null || context === null) return;
    const dpr = ratio();
    const { scale, width, height } = resize(canvas, dpr);
    if (scale !== dragScale) startDrag(canvas, scale);
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
        turn: pose.turn,
        lean: pose.lean,
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
  startDrag(canvas, windowPixels(ratio()).scale);
  runSceneLoop(host, scene, readout?.observer);
  readout?.load(PERF_URL);
}
