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
// XMAS-45a "Pause logic": the scene can be paused. Paused, steps and drags stop and
// the frame stays as it was; the sky and the countdown still follow the clock.
// XMAS-45b "Pause button on the page": the page's pause button is wired to the scene
// here, and placed on every drawn frame at the art pixel size the scene is drawn at.
// XMAS-43b "Shake wiring and the shake button": the phone's shake stirs the snow and pushes it, through the access
// (shake-access.ts); where a tap is needed first, the shake button asks for it. A paused scene discards the shake.
// XMAS-44b "Keyboard wiring, focus and the focus ring": the globe takes focus and the arrows and Space or Enter drive
// it through keys.ts; the globe's focus target is placed over the globe's square on every drawn frame.
// XMAS-46c "Sound button and page wiring": the stir of each step drives the sound engine (sound-engine.ts), and the
// sound button is placed on every drawn frame; the scene draws nothing of the sound.
import { makeClock, phaseAt, timeLeft, type PhaseReading } from '../shared/clock.ts';
import { makeFrameSource, toRgba, type FrameSource } from './frames.ts';
import { createDrag, type Drag } from './drag.ts';
import { makeFineLayer, type FineLayer } from './fine-layer.ts';
import { blankFineTrace, createFrameTrace, type FineTrace, type FrameTrace } from './frame-trace.ts';
import { createFlakeWatch } from './flake-watch.ts';
import { attachKeyboard } from './keyboard.ts';
import { createKeys, type Keys } from './keys.ts';
import { runSceneLoop, type LoopHost, type PausableScene } from './loop.ts';
import { attachPauseButton, type PauseButton } from './pause-button.ts';
import { attachPointer } from './pointer.ts';
import { attachShakeButton, type ShakeButton } from './shake-button.ts';
import { createShakeAccess, hostFromWindow } from './shake-access.ts';
import { attachSoundButton, type SoundButton } from './sound-button.ts';
import { createSoundEngine, type SoundEngine } from './sound-engine.ts';
import { wantsPerf } from './perf-option.ts';
import { readoutLink } from './scene-perf.ts';
import { pagePixels, pictureLeft } from './pixel.ts';
import { makePoseTrack, smoothTime } from './pose.ts';
import { snowDrawList, type SnowStep } from '../scene/snow-draw-list.ts';
import { sceneLayout, type Circle } from '../scene/frame.ts';
import { glassLayer, type GlassLayer } from '../scene/glass-layer.ts';
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
/** The phone's motion, as the snow's stir and push (XMAS-43b); it listens from here on where no tap is needed. */
const shakeAccess = createShakeAccess(hostFromWindow(window));
/**
 * Whether the fine layer drew the shapes on the last frame. The scene canvas keeps
 * the shapes' bodies until it has, so a page whose layers get no 2d context still shows them.
 */
let fineDrew = fine !== null;
/** The glass the fine layer last drawn (XMAS-92b), kept while the picture's size, turn and phase reading hold: a still picture hands over the same object. */
let glassKept: { width: number; height: number; turn: number; phase: PhaseReading; glass: GlassLayer } | null = null;

/** The glass of a frame, built again only when its size, turn or phase reading changes. */
function glassFor(width: number, height: number, phase: PhaseReading, turn: number): GlassLayer {
  const kept = glassKept;
  if (kept !== null && kept.width === width && kept.height === height && kept.turn === turn && kept.phase.from === phase.from && kept.phase.to === phase.to && kept.phase.share === phase.share) return kept.glass;
  const glass = glassLayer(sceneLayout(width, height, SEED), phase, turn);
  glassKept = { width, height, turn, phase, glass };
  return glass;
}
let drag = createDrag(START_TURN);
/** The keys the globe's keyboard holds down: the turn, stir and push they give each step (XMAS-44b). */
const keys: Keys = createKeys();
/** The globe's keyboard target, once the page has its markup; null without it. */
let globeTarget: HTMLElement | null = null;
/** The globe's target as it was last placed, so an unchanged frame writes no style. */
let placedGlobe = '';
/** The art pixel size the drag was started under, and how to take its pointer back off. */
let dragScale = 0;
let detachPointer: (() => void) | null = null;
/** The pointer whose press the drag model is following, so a pause can end it; null when none. */
let pressed: number | null = null;
/** The pause button, once the page has one to wire; null without the button's markup. */
let pauseButton: PauseButton | null = null;
/** The shake button, once the page has one to wire; null without the button's markup. */
let shakeButton: ShakeButton | null = null;
/**
 * The sound engine (XMAS-46b): it makes no audio until the first unmute, and every visit starts muted. Built here
 * only so the page can drive it; nothing audio is made on load.
 */
const sound: SoundEngine = createSoundEngine({ createContext: () => new AudioContext(), random: Math.random });
/** The sound button, once the page has one to wire; null without the button's markup. */
let soundButton: SoundButton | null = null;

/** Steps taken since the scene started; the scene's own clock, not the wall clock. */
let steps = 0;
/** Whether the scene is paused (XMAS-45a): steps and drags stop, and nothing is kept for the resume. */
let paused = false;
/** The fraction the last unpaused frame was drawn at: a paused frame is that same frame. */
let shownFraction = 1;
/** The globe's turn and lean as the last two scene steps left them; the frame draws between them. */
const track = makePoseTrack({ turn: START_TURN, lean: 0 });
/** The colour, RGBA and image buffers for one picture size, kept between frames. */
let buffers: { picture: Uint32Array; rgba: Uint8ClampedArray; image: ImageData } | null = null;
/** The globe's snow as the step before the last one left it: a frame draws the flakes between it and the snow as the last step left it (XMAS-84). */
let snowBefore: { flakes: Flake[]; stir: number } | undefined;
/** The globe's turn as the last scene step left it, and the change in it that step made, wrapped into [-pi, pi]: the flakes blend round by that change (XMAS-101). */
let lastTurn: number | null = null;
let turnStep = 0;

/** An angle wrapped into [-pi, pi], as the snow wraps its spin. */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

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
 * The drag the pointer input feeds. Paused, it takes no press and no move; a press
 * in progress is ended when the pause starts (setPaused), so the resume finds no
 * drag in progress and stores nothing from the paused pointer.
 */
const pointerInput: Drag = {
  pointerDown(id, x, y, timeSec) {
    if (paused) return;
    if (pressed === null) pressed = id;
    drag.pointerDown(id, x, y, timeSec);
  },
  pointerMove(id, x, y, timeSec) {
    if (!paused) drag.pointerMove(id, x, y, timeSec);
  },
  pointerUp(id, timeSec) {
    if (id === pressed) pressed = null;
    drag.pointerUp(id, timeSec);
  },
  pointerCancel(id) {
    if (id === pressed) pressed = null;
    drag.pointerCancel(id);
  },
  turnBy: (delta) => drag.turnBy(delta),
  step: (dtSec) => drag.step(dtSec),
};

/**
 * Starts the drag on `target` for the art pixel size `scale`. A new drag replaces
 * the old one, which cancels the drag in progress: a move measured in the old
 * art pixels would jump by the difference when the size changes.
 */
function startDrag(target: HTMLCanvasElement, scale: number): void {
  detachPointer?.();
  drag = createDrag(track.latest().turn);
  pressed = null;
  dragScale = scale;
  // Pointer times are performance.now() at delivery: the browser merges queued moves, so an event's own timestamp can lag.
  detachPointer = attachPointer(target, pointerInput, (x, y) => artPoint(target, x, y), () => performance.now() / 1000);
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

/**
 * Places the globe's keyboard target over the globe's square of the picture, drawn at `scale` device pixels an
 * art pixel on a screen of device pixel ratio `ratioNow` with the canvas at `left` (CSS pixels), and shows it.
 * Its focus ring is one art pixel in CSS pixels, the same as the buttons'.
 */
function placeGlobe(target: HTMLElement, globe: Circle, scale: number, ratioNow: number, left: number): void {
  const key = `${scale} ${ratioNow} ${left} ${globe.cx} ${globe.cy} ${globe.radius}`;
  if (key === placedGlobe) return;
  placedGlobe = key;
  const cssPerArt = scale / ratioNow;
  const size = `${2 * globe.radius * cssPerArt}px`;
  target.style.left = `${left + (globe.cx - globe.radius) * cssPerArt}px`;
  target.style.top = `${(globe.cy - globe.radius) * cssPerArt}px`;
  target.style.width = size;
  target.style.height = size;
  target.style.setProperty('--art', `${cssPerArt}px`);
  target.hidden = false;
}

const scene: PausableScene = {
  get paused(): boolean {
    return paused;
  },
  setPaused(value: boolean): void {
    if (value && pressed !== null) {
      drag.pointerCancel(pressed);
      pressed = null;
    }
    // A key held as the scene pauses is let go, so nothing keeps turning or stirring on the resume (XMAS-44b).
    if (value) keys.reset();
    paused = value;
  },
  step(): void {
    // The shake read since the last step is taken here, so a paused scene discards it rather than keeping it for the resume.
    const shaken = shakeAccess.take();
    if (paused) {
      // The wind plays on through a pause, and no chime sounds (XMAS-46c).
      sound.update(0, true);
      return;
    }
    steps++;
    trace?.step();
    watch?.step();
    const { width, height } = windowPixels(ratio());
    // The held keys turn the globe as a drag's turn does, before the drag's own step reads it (XMAS-44b).
    const key = keys.step(1 / STEPS_PER_SECOND);
    drag.turnBy(key.turn);
    const out = drag.step(1 / STEPS_PER_SECOND);
    track.push({ turn: out.turn, lean: out.lean });
    turnStep = lastTurn === null ? 0 : wrapAngle(out.turn - lastTurn);
    lastTurn = out.turn;
    // The snow as this step finds it is what the frames blend from, until the next step moves it on (XMAS-84).
    snowBefore = snow.snow === null ? undefined : copyInto(snowBefore, snow.snow);
    const stir = out.raise + key.raise + shaken.raise;
    snow.step({
      turn: out.turn,
      christmasDay: timeLeft(clock()).christmasDay,
      width,
      height,
      raise: stir,
      push: {
        x: out.push.x + key.push.x + shaken.push.x,
        y: out.push.y + key.push.y + shaken.push.y,
        z: out.push.z + key.push.z + shaken.push.z,
      },
    });
    sound.update(stir, paused);
  },
  draw(fraction = 1): number | void {
    if (canvas === null || context === null) return;
    // XMAS-102: the frame's start, read only with the trace, which takes the frame's work from it.
    const drawBegin = trace === undefined ? 0 : performance.now();
    const dpr = ratio();
    const { scale, width, height, left } = resize(canvas, dpr);
    if (scale !== dragScale) startDrag(canvas, scale);
    soundButton?.place(scale, dpr);
    pauseButton?.place(scale, dpr);
    shakeButton?.place(scale, dpr);
    const size = width * height;
    if (buffers === null || buffers.picture.length !== size) {
      const picture = new Uint32Array(size);
      const rgba = new Uint8ClampedArray(size * 4);
      buffers = { picture, rgba, image: new ImageData(rgba, width, height) };
    }
    // Paused, the frame is the last unpaused one again, whatever fraction the loop asks for, so pausing does not move it on.
    if (!paused) shownFraction = fraction;
    const blended = track.blend(shownFraction);
    const time = smoothTime(steps, shownFraction);
    // The flakes as draw steps, blended from the snow before the last step: those behind the glass centre go before Santa and the shapes, those in front after.
    const globeSnow = snow.snow;
    if (globeSnow === null) {
      snowBehind.length = 0;
      snowFront.length = 0;
    } else {
      snowDrawList(globeSnow, snowBefore, shownFraction, 'behind', time, snowBehind, turnStep);
      snowDrawList(globeSnow, snowBefore, shownFraction, 'front', time, snowFront, turnStep);
    }
    // The frame leaves the shapes' bodies, Santa and the flakes to the fine layer while it drew them last time; one that cannot draw them gets them in the picture.
    const onFine = fineDrew;
    const phase = phaseAt(clock());
    const frame = frames(
      {
        time,
        drag: 0,
        phase,
        seed: SEED,
        width,
        height,
        turn: blended.turn,
        lean: blended.lean,
        snow: globeSnow ?? undefined,
        snowSteps: { behind: snowBehind, front: snowFront },
        outsideSnow: snow.outsideSnow ?? undefined,
        shapeBodies: !onFine,
        glassApart: onFine,
        shakeLive: shakeAccess.live,
      },
      buffers.picture,
    );
    if (globeTarget !== null) placeGlobe(globeTarget, frame.layout.globe, scale, dpr, left);
    // The shapes go over the scene canvas and the flakes behind (on their own layer under them), Santa among the shapes by depth, and the flakes in front over all.
    // The fine layer is timed only for the readout, which is the only thing that reads the time.
    const timed = readout !== undefined;
    const begin = timed ? performance.now() : 0;
    // The fine layer's trace is passed only on the frames it draws, so a frame that leaves it out reports none (XMAS-102).
    let fineNow: FineTrace | null = null;
    if (fine !== null && onFine) {
      fineDrew = fine.draw(
        {
          layout: frame.layout,
          width: frame.width,
          turn: blended.turn,
          lean: blended.lean,
          santaTimeMs: time,
          snowBehind,
          snowFront,
          glass: glassFor(width, height, phase, blended.turn),
        },
        { scale, ratio: dpr, left, trace: fineTrace },
      );
      fineNow = fineTrace ?? null;
    }
    const elapsed = timed ? performance.now() - begin : undefined;
    toRgba(frame.picture, buffers.rgba);
    context.putImageData(buffers.image, 0, 0);
    if (trace !== undefined) trace.frame(fineNow, performance.now() - drawBegin, drawBegin);
    watch?.frame({
      time: drawBegin,
      fraction: shownFraction,
      sceneTimeMs: time,
      turn: blended.turn,
      turnStep,
      down: pressed !== null,
      globe: globeSnow?.flakes ?? [],
      outside: snow.outsideSnow?.flakes ?? [],
      front: snowFront,
      behind: snowBehind,
    });
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

/**
 * Passes the browser's long tasks and long animation frames to the trace (XMAS-110). A browser without the API, or one
 * that refuses an entry type, reports none and the scene carries on.
 */
function observeLongWork(into: FrameTrace): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const kinds: [string, 'task' | 'frame'][] = [['longtask', 'task'], ['long-animation-frame', 'frame']];
  for (const [type, kind] of kinds) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) into.longTask(kind, entry.duration);
      });
      observer.observe({ type, buffered: false });
    } catch {
      // This browser does not report the entry type.
    }
  }
}

/** The JS heap in use in bytes, where the browser reports it (Chrome's performance.memory); undefined elsewhere (XMAS-110). */
function heapUsedBytes(): number | undefined {
  const used = (performance as unknown as { memory?: { usedJSHeapSize?: unknown } }).memory?.usedJSHeapSize;
  return typeof used === 'number' ? used : undefined;
}

const readout = wantsPerf(location.search) ? readoutLink() : undefined;
// XMAS-102: with ?perf the frame trace and the fine layer's section timings are made, and take() is handed to the page as window.__xmasTrace.
const trace = readout === undefined ? undefined : createFrameTrace(() => performance.now());
const fineTrace = readout === undefined ? undefined : blankFineTrace();
// XMAS-104: the flake watch is made beside the trace, and its take() is handed over with it.
const watch = readout === undefined ? undefined : createFlakeWatch();
if (trace !== undefined) Object.assign(window, { __xmasTrace: { take: trace.take, watch: watch?.take } });
// XMAS-110: the loop's observer is the readout's, and each callback's span and the heap reading also go to the trace.
const loopObserver = readout === undefined || trace === undefined ? undefined : {
  ...readout.observer,
  callback(startMs: number, endMs: number) {
    trace.callback(startMs, endMs);
    const used = heapUsedBytes();
    if (used !== undefined) trace.heap(used);
  },
};
if (trace !== undefined) observeLongWork(trace);

if (canvas !== null && context !== null) {
  startDrag(canvas, windowPixels(ratio()).scale);
  const soundTap = document.querySelector<HTMLButtonElement>('button#sound');
  const soundArt = document.querySelector<HTMLCanvasElement>('button#sound canvas');
  if (soundTap !== null && soundArt !== null) soundButton = attachSoundButton(soundTap, soundArt, sound);
  const button = document.querySelector<HTMLButtonElement>('button#pause');
  const buttonArt = document.querySelector<HTMLCanvasElement>('button#pause canvas');
  if (button !== null && buttonArt !== null) pauseButton = attachPauseButton(button, buttonArt, scene);
  const shakeTap = document.querySelector<HTMLButtonElement>('button#shake');
  const shakeArt = document.querySelector<HTMLCanvasElement>('button#shake canvas');
  if (shakeTap !== null && shakeArt !== null) shakeButton = attachShakeButton(shakeTap, shakeArt, shakeAccess);
  const globe = document.querySelector<HTMLElement>('#globe');
  if (globe !== null) {
    globeTarget = globe;
    attachKeyboard(globe, keys, () => paused);
  }
  runSceneLoop(host, scene, loopObserver);
  readout?.load(PERF_URL, () => trace?.peek() ?? null);
}
