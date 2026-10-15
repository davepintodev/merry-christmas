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
// XMAS-79 "Smooth between steps": the globe, its lean and Santa are drawn partway
// between the last two steps, so motion follows real time and not whole steps.
// XMAS-81 "Fine layer on the page: the shapes": the scene canvas leaves the shapes'
// bodies out and fine-layer.ts draws them on the screen's own pixel grid over it.
import { makeClock, phaseAt, timeLeft } from '../shared/clock.ts';
import { makeFrameSource, toRgba, type FrameSource } from './frames.ts';
import { createDrag } from './drag.ts';
import { makeFineLayer, type FineLayer } from './fine-layer.ts';
import { runSceneLoop, type LoopHost, type LoopScene } from './loop.ts';
import { attachPointer } from './pointer.ts';
import { wantsPerf } from './perf-option.ts';
import { readoutLink } from './scene-perf.ts';
import { pagePixels, pictureLeft } from './pixel.ts';
import { makePoseTrack, smoothTime } from './pose.ts';
import { snowDrawList, type SnowStep } from '../scene/snow-draw-list.ts';
import { makeSnowRuntime } from './snow-runtime.ts';
import { STEPS_PER_SECOND } from './steps.ts';
import type { Flake, GlobeSnow } from '../scene/snow.ts';

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
const fine: FineLayer | null = canvas === null ? null : makeFineLayer(canvas);
const frames: FrameSource = makeFrameSource();
const snow = makeSnowRuntime(SEED);
/**
 * Whether the fine layer drew the shapes on the last frame. The scene canvas keeps
 * the shapes' bodies until it has, so a page whose layers get no 2d context still shows them.
 */
let fineDrew = fine !== null;
let drag = createDrag(START_TURN);
/** The art pixel size the drag was started under, and how to take its pointer back off. */
let dragScale = 0;
let detachPointer: (() => void) | null = null;

/** Steps taken since the scene started; the scene's own clock, not the wall clock. */
let steps = 0;
/** The globe's turn and lean as the last two scene steps left them; the frame draws between them. */
const track = makePoseTrack({ turn: START_TURN, lean: 0 });
/** The colour, RGBA and image buffers for one picture size, kept between frames. */
let buffers: { picture: Uint32Array; rgba: Uint8ClampedArray; image: ImageData } | null = null;
/** The globe's snow as the step before the last one left it: a frame draws the flakes between it and the snow as the last step left it (XMAS-84). */
let snowBefore: { flakes: Flake[]; stir: number } | undefined;

/** The draw steps of the flakes behind the glass centre and in front, their step objects kept between frames. */
const snowBehind: SnowStep[] = [];
const snowFront: SnowStep[] = [];

/** Copies the snow's flakes into `into` (its flake objects are reused), so a step that moves the snow on leaves the copy as it was. */
function copyInto(into: { flakes: Flake[]; stir: number } | undefined, snowNow: GlobeSnow): { flakes: Flake[]; stir: number } {
  const copy = into ?? { flakes: [], stir: 0 };
  snowNow.flakes.forEach((flake, i) => {
    const kept = copy.flakes[i];
    if (kept === undefined) copy.flakes[i] = { ...flake };
    else Object.assign(kept, flake);
  });
  copy.flakes.length = snowNow.flakes.length;
  copy.stir = snowNow.stir;
  return copy;
}

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
  drag = createDrag(track.latest().turn);
  dragScale = scale;
  // Pointer times are performance.now() at delivery: the browser merges queued moves, so an event's own timestamp can lag.
  detachPointer = attachPointer(target, drag, (x, y) => artPoint(target, x, y), () => performance.now() / 1000);
}

/** One picture size in canvas pixels and CSS pixels, and its left edge in CSS pixels; the canvas is re-sized only when it changes. */
function resize(target: HTMLCanvasElement, ratioNow: number): { scale: number; width: number; height: number; left: number } {
  const { scale, width, height } = windowPixels(ratioNow);
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const cssWidth = `${(width * scale) / ratioNow}px`;
  const cssHeight = `${(height * scale) / ratioNow}px`;
  if (target.style.width !== cssWidth) target.style.width = cssWidth;
  if (target.style.height !== cssHeight) target.style.height = cssHeight;
  // Left edge on a whole device pixel (pictureLeft), so every art pixel stays a whole number of device pixels (crisp at fractional ratios).
  // The layout keeps `left: 50%` so the box does not jump when the scene arrives; the rounding goes into the translate.
  // That assumes no scrollbar, so `left: 50%` is innerWidth / 2 (index.html sets overflow hidden).
  const left = pictureLeft(window.innerWidth, width, scale, ratioNow);
  const transform = `translateX(${left - window.innerWidth / 2}px)`;
  if (target.style.transform !== transform) target.style.transform = transform;
  return { scale, width, height, left };
}

const scene: LoopScene = {
  step(): void {
    steps++;
    const { width, height } = windowPixels(ratio());
    const out = drag.step(1 / STEPS_PER_SECOND);
    track.push({ turn: out.turn, lean: out.lean });
    // The snow as this step finds it is what the frames blend from, until the next step moves it on (XMAS-84).
    snowBefore = snow.snow === null ? undefined : copyInto(snowBefore, snow.snow);
    snow.step({
      turn: out.turn,
      christmasDay: timeLeft(clock()).christmasDay,
      width,
      height,
      raise: out.raise,
      push: out.push,
    });
  },
  draw(fraction = 1): number | void {
    if (canvas === null || context === null) return;
    const dpr = ratio();
    const { scale, width, height, left } = resize(canvas, dpr);
    if (scale !== dragScale) startDrag(canvas, scale);
    const size = width * height;
    if (buffers === null || buffers.picture.length !== size) {
      const picture = new Uint32Array(size);
      const rgba = new Uint8ClampedArray(size * 4);
      buffers = { picture, rgba, image: new ImageData(rgba, width, height) };
    }
    const blended = track.blend(fraction);
    const time = smoothTime(steps, fraction);
    // The flakes as draw steps, blended from the snow before the last step: those behind the glass centre go before Santa and the shapes, those in front after.
    const globeSnow = snow.snow;
    if (globeSnow === null) {
      snowBehind.length = 0;
      snowFront.length = 0;
    } else {
      snowDrawList(globeSnow, snowBefore, fraction, 'behind', time, snowBehind);
      snowDrawList(globeSnow, snowBefore, fraction, 'front', time, snowFront);
    }
    const frame = frames(
      {
        time,
        drag: 0,
        phase: phaseAt(clock()),
        seed: SEED,
        width,
        height,
        turn: blended.turn,
        lean: blended.lean,
        snow: globeSnow ?? undefined,
        snowSteps: { behind: snowBehind, front: snowFront },
        outsideSnow: snow.outsideSnow ?? undefined,
        shapeBodies: !fineDrew,
      },
      buffers.picture,
    );
    // The shapes go over the scene canvas, then the flakes behind and Santa over them, then Santa and the flakes in front.
    // The fine layer is timed only for the readout, which is the only thing that reads the time.
    const timed = readout !== undefined;
    const begin = timed ? performance.now() : 0;
    if (fine !== null && frame.front !== undefined) {
      fineDrew = fine.draw(
        { layout: frame.layout, width: frame.width, turn: blended.turn, lean: blended.lean, front: frame.front, behind: frame.behind, snowBehind, snowFront },
        { scale, ratio: dpr, left },
      );
    }
    const elapsed = timed ? performance.now() - begin : undefined;
    toRgba(frame.picture, buffers.rgba);
    context.putImageData(buffers.image, 0, 0);
    return elapsed;
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
