// XMAS-32d "The globe", changed by XMAS-41b2, 84, 45a and 92b: page wiring of
// src/page/scene.ts. The page file runs on import; here the browser bits it
// touches are stand-ins (a fake canvas that holds its listeners and a test-driven
// clock), the loop is captured instead of run, the snow runtime records each step
// and the frame source records what it is asked for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leanBox, rowShift } from '../scene/lean.ts';
import { sceneLayout, type SceneInput } from '../scene/frame.ts';
import { snowDrawList, type SnowStep as DrawnFlake } from '../scene/snow-draw-list.ts';
import { GLOBE_SNOW, type GlobeSnow } from '../scene/snow.ts';
import type { FineFrame } from './fine-layer.ts';
import { glassLayer } from '../scene/glass-layer.ts';
import { DRAG_SETTINGS } from './drag.ts';
import type { LoopScene } from './loop.ts';
import { STEP_MS } from './steps.ts';
import { phaseAt } from '../shared/clock.ts';

type SnowStep = { turn: number; raise?: number; push?: { x: number; y: number; z: number }; width: number; height: number };
type Listener = (event: unknown) => void;

const captured = vi.hoisted(() => ({
  scene: null as LoopScene | null,
  inputs: [] as SceneInput[],
  snowSteps: [] as SnowStep[],
  listenersAtLoopStart: -1,
  loopStarts: 0,
  /** XMAS-84: draw with the real frame source, and a stand-in fine layer that records its frames. */
  realFrames: false,
  fineResult: true,
  fineFrames: [] as unknown[],
  puts: [] as Uint8ClampedArray[],
}));

const canvasRef = vi.hoisted(() => ({ current: null as null | { listenerCount(): number } }));

vi.mock('./loop.ts', () => ({
  runSceneLoop: (_host: unknown, scene: LoopScene) => {
    captured.scene = scene;
    captured.loopStarts++;
    captured.listenersAtLoopStart = canvasRef.current?.listenerCount() ?? -1;
    return { stop: () => undefined };
  },
}));

// The real snow runtime, with each step it is given recorded.
vi.mock('./snow-runtime.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./snow-runtime.ts')>();
  return {
    ...actual,
    makeSnowRuntime: (...args: Parameters<typeof actual.makeSnowRuntime>) => {
      const runtime = actual.makeSnowRuntime(...args);
      const step = runtime.step.bind(runtime);
      runtime.step = (input: SnowStep) => {
        captured.snowSteps.push({ ...input, push: input.push === undefined ? undefined : { ...input.push } });
        step(input as never);
      };
      return runtime;
    },
  };
});

vi.mock('./fine-layer.ts', () => ({
  makeFineLayer: () => ({
    draw: (frame: unknown) => {
      captured.fineFrames.push(frame);
      return captured.fineResult;
    },
  }),
}));

vi.mock('./frames.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./frames.ts')>();
  return {
    ...actual,
    makeFrameSource: () => {
      const real = actual.makeFrameSource();
      return (input: SceneInput, target?: Uint32Array) => {
        captured.inputs.push({ ...input });
        if (captured.realFrames) return real(input, target);
        const picture = target ?? new Uint32Array(input.width * input.height);
        return { width: input.width, height: input.height, picture, layout: undefined as never };
      };
    },
  };
});

class FakeImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

/** Client pixels are three times art pixels, with the canvas's corner at (10, 20). */
const SCALE = 3;
const LEFT = 10;
const TOP = 20;

class FakeCanvas {
  width = 0;
  height = 0;
  style = { width: '', height: '' };
  readonly listeners = new Map<string, Set<Listener>>();
  getContext = () => ({ putImageData: (image: FakeImageData) => void captured.puts.push(Uint8ClampedArray.from(image.data)) });
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  setPointerCapture = () => undefined;
  releasePointerCapture = () => undefined;
  getBoundingClientRect() {
    return { left: LEFT, top: TOP, width: this.width * SCALE, height: this.height * SCALE };
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
  fire(type: string, init: { id?: number; artX: number; artY: number; button?: number }): void {
    const event = {
      pointerId: init.id ?? 1,
      clientX: LEFT + init.artX * SCALE,
      clientY: TOP + init.artY * SCALE,
      button: init.button ?? 0,
      pointerType: 'mouse',
      preventDefault: () => undefined,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

let canvas: FakeCanvas;
let nowMs = 0;

beforeEach(() => {
  Object.assign(captured, { scene: null, inputs: [], snowSteps: [], realFrames: false, fineResult: true, fineFrames: [], puts: [], listenersAtLoopStart: -1, loopStarts: 0 });
  vi.resetModules();
  nowMs = 0;
  canvas = new FakeCanvas();
  canvasRef.current = canvas;
  vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
  // The page's markup here is the scene canvas alone: no pause button, so the scene runs without one (XMAS-45b).
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === 'canvas#scene' ? canvas : null), hidden: false, addEventListener: () => undefined });
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('performance', { now: () => nowMs, mark: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  canvasRef.current = null;
});


async function loadScene(search = ''): Promise<LoopScene> {
  vi.stubGlobal('location', { search });
  await import('./scene.ts');
  const scene = captured.scene;
  if (scene === null) expect.fail('the page did not start the scene loop');
  return scene;
}

/** Pins Date (before the scene module reads Date.now); the clock is real otherwise. */
function fakeDate(at: Date): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
}

function last(): SceneInput {
  const input = captured.inputs[captured.inputs.length - 1];
  if (input === undefined) expect.fail('no frame was drawn');
  return input;
}

/** A loaded scene, drawn once so the canvas is sized and client pixels convert to art pixels. */
async function loadDragScene(): Promise<LoopScene> {
  const scene = await loadScene();
  scene.draw();
  captured.inputs = [];
  return scene;
}

function drawn(scene: LoopScene): SceneInput {
  scene.draw();
  return last();
}

const turnOf = (scene: LoopScene): number => drawn(scene).turn ?? Number.NaN;

function lastSnow(): SnowStep {
  const step = captured.snowSteps[captured.snowSteps.length - 1];
  if (step === undefined) expect.fail('the snow was not stepped');
  return step;
}

const stepN = (scene: LoopScene, n: number): void => {
  for (let k = 0; k < n; k++) scene.step();
};

const snowKey = (i: SceneInput): string => JSON.stringify([i.snow?.flakes ?? null, i.outsideSnow?.flakes ?? null]);

/** A drag of (dx, dy) art pixels over `seconds`, in `moves` equal moves, released at the end. */
function dragBy(dx: number, dy: number, seconds: number, moves = 10, release = true): void {
  const t0 = nowMs;
  canvas.fire('pointerdown', { artX: 100, artY: 100 });
  for (let k = 1; k <= moves; k++) {
    nowMs = t0 + (seconds * 1000 * k) / moves;
    canvas.fire('pointermove', { artX: 100 + (dx * k) / moves, artY: 100 + (dy * k) / moves });
  }
  if (release) canvas.fire('pointerup', { artX: 100 + dx, artY: 100 + dy });
}

/** A held sideways drag, then six steps, so the globe leans (left for a negative dx). */
function leanBy(scene: LoopScene, dx = -40): void {
  dragBy(dx, 0, 0.3, 10, false);
  stepN(scene, 6);
}

/** The globe's starting turn, in radians (the old automatic turn's start). */
const START_TURN = 0.5;

describe('the scene page no longer turns the globe by itself', () => {
  it('asks for the first frame at the starting turn, and passes the same turn however many steps go by', async () => {
    const scene = await loadScene();
    scene.draw();
    expect(last().time).toBe(0);
    expect(last().turn, 'a turn is passed').toBeDefined();
    expect(last().turn).toBeCloseTo(START_TURN, 12);
    for (const steps of [1, 59, 60, 600, 3600]) {
      stepN(scene, steps);
      scene.draw();
      const input = last();
      expect(input.turn ?? Number.NaN, `time ${input.time}`).toBeCloseTo(START_TURN, 12);
    }
    expect(last().time).toBeCloseTo(4320 * STEP_MS, 9);
  });
});

describe('the scene page wires the snow', () => {
  it('passes both snows to the frame source once a step has run', async () => {
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const input = last();
    expect(input.snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
    expect(input.outsideSnow?.flakes.length).toBeGreaterThan(0);
    expect(input.outsideSnow?.flakes.length).toBe(Math.round(((input.width * input.height) / 700) * 2.5));
  });

  it('steps the snow once per step, not per draw, and moves the same snow on in place', async () => {
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const first = last();
    const afterOne = snowKey(first);
    scene.draw();
    scene.draw();
    expect(snowKey(last()), 'drawing does not move the snow').toBe(afterOne);
    scene.step();
    scene.draw();
    const afterTwo = snowKey(last());
    expect(afterTwo).not.toBe(afterOne);
    scene.step();
    scene.step();
    scene.draw();
    expect(snowKey(last())).not.toBe(afterTwo);
    stepN(scene, 30);
    scene.draw();
    expect(first.snow, 'a snow is passed').toBeDefined();
    expect(last().snow).toBe(first.snow);
  });

  it('draws the same snow after the same steps on a fresh page (fixed seed)', async () => {
    const run = async (): Promise<string> => {
      captured.inputs = [];
      vi.resetModules();
      const scene = await loadScene();
      stepN(scene, 100);
      scene.draw();
      return snowKey(last());
    };
    const [a, b] = [await run(), await run()];
    expect(a).not.toBe('[null,null]');
    expect(a).toBe(b);
  });

  it.each([
    ['Christmas Day', '2026-12-25T10:00:00', GLOBE_SNOW.christmasDay.flakes],
    ['the day before', '2026-12-24T23:59:59', GLOBE_SNOW.ordinary.flakes],
    ['the day after', '2026-12-26T00:00:00', GLOBE_SNOW.ordinary.flakes],
  ])('uses the amounts for %s (%s)', async (_day, now, flakes) => {
    const scene = await loadScene(`?now=${now}`);
    scene.step();
    scene.draw();
    expect(last().snow?.flakes.length).toBe(flakes);
  });

  it('changes the amounts live when the clock crosses midnight into Christmas Day and out of it', async () => {
    fakeDate(new Date(2026, 11, 24, 23, 59, 58));
    const scene = await loadScene('?now=2026-12-24T23:59:58');
    for (const [at, flakes] of [
      [new Date(2026, 11, 24, 23, 59, 58), 340],
      [new Date(2026, 11, 25, 0, 0, 1), 500],
      [new Date(2026, 11, 26, 0, 0, 1), 340],
    ] as const) {
      vi.setSystemTime(at);
      scene.step();
      scene.draw();
      expect(last().snow?.flakes.length, at.toISOString()).toBe(flakes);
    }
  });
});

// XMAS-41b2 "Drag input": the page makes one drag, hands the pointer to it, steps it once per
// scene step and feeds turn and lean to the frame and raise and push to the snow.
describe('the pointer is attached by the page', () => {
  it('listens on the scene canvas for the five pointer events, attached before the loop starts (so before the first frame and before globe-ready can be marked)', async () => {
    await loadScene();
    expect(captured.loopStarts).toBe(1);
    expect(captured.listenersAtLoopStart).toBe(5);
    expect([...canvas.listeners.keys()].sort()).toEqual(['lostpointercapture', 'pointercancel', 'pointerdown', 'pointermove', 'pointerup']);
  });
});

describe('a change of art scale mid-drag', () => {
  it('ends the old drag without a jump, attaches the listeners once, and a fresh drag works', async () => {
    const scene = await loadDragScene();
    const start = turnOf(scene);
    canvas.fire('pointerdown', { artX: 100, artY: 100 });
    nowMs = 100;
    canvas.fire('pointermove', { artX: 120, artY: 100 });
    scene.step();
    const held = turnOf(scene);
    expect(held).toBeCloseTo(start - 20 * DRAG_SETTINGS.turnPerPixel, 9);

    vi.stubGlobal('window', { ...window, innerWidth: 3200, innerHeight: 2400 });
    scene.draw(); // sees the new scale and starts a fresh drag
    expect(canvas.listenerCount()).toBe(5);
    for (const set of canvas.listeners.values()) expect(set.size).toBe(1);

    nowMs = 200;
    canvas.fire('pointermove', { artX: 300, artY: 140 });
    canvas.fire('pointerup', { artX: 300, artY: 140 });
    captured.snowSteps = [];
    scene.step();
    expect(turnOf(scene)).toBeCloseTo(held, 9);
    expect(lastSnow().raise ?? 0).toBe(0);
    expect(lastSnow().push ?? { x: 0, y: 0, z: 0 }).toEqual({ x: 0, y: 0, z: 0 });

    dragBy(10, 0, 0.5);
    scene.step();
    expect(turnOf(scene)).toBeLessThan(held);
  });
});

describe('a drag turns the globe', () => {
  it.each([
    ['sideways', 40],
    ['the other way', -25],
  ])('turns it by the turn per art pixel for each art pixel moved %s (client to art pixels), feeds the snow that turn, and keeps it after the finger lifts', async (_way, dx) => {
    const scene = await loadDragScene();
    const before = turnOf(scene);
    dragBy(dx, 0, 0.5);
    scene.step();
    const after = turnOf(scene);
    expect(after).toBeCloseTo(before - dx * DRAG_SETTINGS.turnPerPixel, 9);
    expect(lastSnow().turn).toBeCloseTo(after, 12);
    stepN(scene, 1200);
    expect(turnOf(scene), 'no auto turn, no spring-back').toBeCloseTo(after, 12);
  });

  it('the turn moves only when the scene steps, not when it draws', async () => {
    const scene = await loadDragScene();
    const before = turnOf(scene);
    dragBy(40, 0, 0.5, 10, false);
    expect(turnOf(scene)).toBeCloseTo(before, 12);
    scene.step();
    expect(turnOf(scene)).toBeLessThan(before);
  });

  it('a second finger does not move the globe', async () => {
    const scene = await loadDragScene();
    const before = turnOf(scene);
    canvas.fire('pointerdown', { id: 1, artX: 100, artY: 100 });
    canvas.fire('pointerdown', { id: 2, artX: 300, artY: 100 });
    nowMs = 100;
    canvas.fire('pointermove', { id: 2, artX: 380, artY: 100 });
    canvas.fire('pointermove', { id: 1, artX: 110, artY: 100 });
    scene.step();
    expect(turnOf(scene)).toBeCloseTo(before - 10 * DRAG_SETTINGS.turnPerPixel, 9);
  });
});

describe('the globe leans into a drag and springs back', () => {
  it.each([
    ['sideways', 40],
    ['the other way', -40],
  ])('leans with a drag %s, and the lean returns to upright', async (_way, dx) => {
    const scene = await loadDragScene();
    expect(drawn(scene).lean ?? 0).toBe(0);
    leanBy(scene, dx);
    expect(Math.sign(drawn(scene).lean ?? 0) * (drawn(scene).lean ?? 0)).toBeGreaterThan(0.01);
    expect(Math.sign(drawn(scene).lean ?? 0)).toBe(Math.sign(dx));
    canvas.fire('pointerup', { artX: 100 + dx, artY: 100 });
    stepN(scene, 600);
    expect(Math.abs(drawn(scene).lean ?? 1)).toBeLessThan(0.005);
  });

  it('never leans past the largest lean', async () => {
    const scene = await loadDragScene();
    dragBy(900, 0, 0.1, 5, false);
    for (let k = 0; k < 20; k++) {
      scene.step();
      expect(Math.abs(drawn(scene).lean ?? 0)).toBeLessThanOrEqual(DRAG_SETTINGS.maxLean + 1e-9);
    }
  });
});

describe('the snow gets the stir and the push, once per step', () => {
  it('steps the snow once per scene step, with no stir or push when nothing is dragged', async () => {
    const scene = await loadDragScene();
    stepN(scene, 5);
    expect(captured.snowSteps).toHaveLength(5);
    for (const step of captured.snowSteps) {
      expect(step.raise ?? 0).toBe(0);
      expect(step.push?.x ?? 0).toBe(0);
      expect(step.push?.y ?? 0).toBe(0);
    }
  });

  it('raises the stir in proportion to the path length, with no threshold, on the first step after the move only', async () => {
    const scene = await loadDragScene();
    dragBy(3, 4, 5, 3, false); // 5 art px of path, slowly
    scene.draw();
    scene.draw();
    scene.draw();
    expect(captured.snowSteps, 'frames do not step the snow or the drag').toHaveLength(0);
    stepN(scene, 3);
    expect(captured.snowSteps).toHaveLength(3);
    expect(captured.snowSteps[0]?.raise ?? 0).toBeCloseTo(5 * DRAG_SETTINGS.stirPerPixel, 9);
    expect(captured.snowSteps.slice(1).map((s) => s.raise ?? 0), 'several steps in one frame spend the stir once').toEqual([0, 0]);
    scene.draw();
    scene.draw();
    expect(captured.snowSteps).toHaveLength(3);
  });

  it('stirs for a one-pixel drag too', async () => {
    const scene = await loadDragScene();
    dragBy(1, 0, 1, 1, false);
    scene.step();
    expect(lastSnow().raise ?? 0).toBeGreaterThan(0);
  });

  it('pushes the snow the way the finger went, once', async () => {
    const scene = await loadDragScene();
    dragBy(10, -6, 5, 2, false);
    scene.step();
    expect(lastSnow().push?.x ?? 0).toBeCloseTo(10 * DRAG_SETTINGS.pushPerPixel, 9);
    expect(lastSnow().push?.y ?? 0).toBeCloseTo(-6 * DRAG_SETTINGS.pushPerPixel, 9);
    scene.step();
    expect(lastSnow().push?.x ?? 0).toBe(0);
    expect(lastSnow().push?.y ?? 0).toBe(0);
  });

  it('a fast flick on release raises the stir more than a slow drag of the same distance', async () => {
    const slow = await loadDragScene();
    dragBy(40, 0, 2);
    slow.step();
    const slowRaise = lastSnow().raise ?? 0;

    captured.snowSteps = [];
    vi.resetModules();
    canvas = new FakeCanvas();
    canvasRef.current = canvas;
    nowMs = 0;
    const fast = await loadDragScene();
    dragBy(40, 0, 0.04); // 1000 art px/s at the release
    fast.step();
    const fastRaise = lastSnow().raise ?? 0;
    expect(slowRaise).toBeCloseTo(40 * DRAG_SETTINGS.stirPerPixel, 9); // no burst below the threshold
    expect(fastRaise).toBeGreaterThan(slowRaise + 0.1);
  });

  it('a release just under the threshold adds no burst; the page reads the clock in seconds', async () => {
    const scene = await loadDragScene();
    dragBy(18, 0, 0.1); // 180 art px/s
    scene.step();
    expect(lastSnow().raise ?? 0).toBeCloseTo(18 * DRAG_SETTINGS.stirPerPixel, 9);
  });
});

// XMAS-84 "Snow inside the glass on the fine layer": the flakes go to the fine layer as draw
// steps blended between the last two steps, and when the fine layer has no 2d context they go
// on the scene canvas in the right order and with the lean.
describe('the scene page draws the globe snow (XMAS-84)', () => {
  const copy = (snow: GlobeSnow | undefined): GlobeSnow => JSON.parse(JSON.stringify(snow)) as GlobeSnow;
  const xy = (steps: readonly DrawnFlake[]): number[][] => steps.map((s) => [s.x, s.y]);
  const lastFine = (): FineFrame => {
    const frame = captured.fineFrames[captured.fineFrames.length - 1] as FineFrame | undefined;
    if (frame === undefined) expect.fail('the fine layer was not drawn');
    return frame;
  };

  it('with two steps of snow draws the flakes blended by the fraction between the last two steps', async () => {
    captured.realFrames = true;
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const before = copy(last().snow);
    scene.step();
    scene.draw(0.5);
    const now = copy(last().snow);
    const fine = lastFine();
    for (const side of ['behind', 'front'] as const) {
      const got = side === 'behind' ? fine.snowBehind : fine.snowFront;
      const want = snowDrawList(now, before, 0.5, side);
      expect(want.length).toBeGreaterThan(0);
      expect(xy(got ?? [])).toEqual(xy(want));
      // The blend is not the current place: the flakes did move between the steps.
      expect(xy(got ?? [])).not.toEqual(xy(snowDrawList(now, undefined, 0.5, side)));
    }
    // The step before the last at fraction 0 and the last at fraction 1.
    for (const fraction of [0, 1]) {
      scene.draw(fraction);
      expect(xy(lastFine().snowFront ?? []), `fraction ${fraction}`).toEqual(xy(snowDrawList(now, before, fraction, 'front')));
    }
  });

  it('with no step yet draws no flakes; with only one step of snow draws them at the current position, whatever the fraction', async () => {
    captured.realFrames = true;
    const scene = await loadScene();
    scene.draw();
    expect(lastFine().snowBehind ?? []).toEqual([]);
    expect(lastFine().snowFront ?? []).toEqual([]);
    scene.step();
    scene.draw(0.5);
    const now = copy(last().snow);
    expect(xy(lastFine().snowFront ?? [])).toEqual(xy(snowDrawList(now, undefined, 0.5, 'front')));
    expect(xy(lastFine().snowBehind ?? [])).toEqual(xy(snowDrawList(now, undefined, 0.5, 'behind')));
  });

  describe('with no 2d context on the fine layer', () => {
    const BEHIND = 0xaebcf0;
    const WHITE = 0xffffff;
    const pixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number): number => ((rgba[(y * width + x) * 4] ?? 0) << 16) | ((rgba[(y * width + x) * 4 + 1] ?? 0) << 8) | (rgba[(y * width + x) * 4 + 2] ?? 0);
    const lastPut = (): Uint8ClampedArray => captured.puts[captured.puts.length - 1] ?? expect.fail('nothing was put on the scene canvas');

    /** Steps once, then sets every flake to one given flake, in place, and draws twice (the first frame leaves the shape bodies out). */
    async function drawWith(flake: { x: number; y: number; z: number }, lean = false): Promise<{ input: SceneInput; rgba: Uint8ClampedArray }> {
      captured.realFrames = true;
      captured.fineResult = false;
      const scene = await loadDragScene();
      if (lean) leanBy(scene);
      else scene.step();
      scene.draw();
      const flakes = last().snow?.flakes ?? expect.fail('no snow');
      flakes.forEach((f, i) => {
        f.resting = false;
        // Only the first flake is the one under test; the rest sit far outside the glass.
        Object.assign(f, i === 0 ? flake : { x: 5000, y: 5000, z: flake.z });
      });
      scene.draw();
      return { input: last(), rgba: lastPut() };
    }

    it('lets a shape cover a flake behind the glass centre', async () => {
      const { input, rgba } = await drawWith({ x: 0, y: 0, z: -10 });
      const layout = sceneLayout(input.width, input.height, 1);
      const { rgba: bare } = await drawWith({ x: 5000, y: 0, z: -10 });
      const at = [layout.globe.cx, layout.globe.cy] as const;
      expect(pixel(bare, input.width, ...at), 'a shape is at the centre of the glass').not.toBe(BEHIND);
      expect(pixel(rgba, input.width, ...at), 'the flake behind does not paint over the shape').toBe(pixel(bare, input.width, ...at));
    });

    it('draws a flake in front of the glass centre over what is there', async () => {
      const { input, rgba } = await drawWith({ x: 0, y: 0, z: 10 });
      const layout = sceneLayout(input.width, input.height, 1);
      expect(pixel(rgba, input.width, layout.globe.cx, layout.globe.cy)).toBe(WHITE);
    });

    it('shifts a flake with the rows of the leaning glass, as the glass moves', async () => {
      const { input, rgba } = await drawWith({ x: 10, y: -5, z: 10 }, true);
      const layout = sceneLayout(input.width, input.height, 1);
      const row = Math.floor(layout.globe.cy - 5);
      const shift = rowShift(input.lean ?? 0, leanBox(input.width, layout).bottom, row);
      expect(Math.abs(shift), 'the lean moves this row').toBeGreaterThanOrEqual(1);
      const x = Math.floor(layout.globe.cx + 10);
      expect(pixel(rgba, input.width, x + shift, row)).toBe(WHITE);
      expect(pixel(rgba, input.width, x, row)).not.toBe(WHITE);
    });
  });
});

// XMAS-45a "Pause logic": LoopScene gains setPaused(paused) and a readonly `paused`.
// Paused, steps do nothing, frames show one still frame, the sky still follows the clock.
type Pausable = LoopScene & { setPaused(paused: boolean): void; readonly paused: boolean };

describe('pausing the scene (XMAS-45a)', () => {
  const pausable = async (search = ''): Promise<Pausable> => (await loadScene(search)) as Pausable;
  const santaAt = (): number => (captured.fineFrames[captured.fineFrames.length - 1] as { santaTimeMs: number }).santaTimeMs;

  it('freezes snow, time (stars, reflections) and Santa on one still frame, and resumes from the same frame', async () => {
    const scene = await pausable();
    scene.step();
    scene.draw(1);
    const t1 = last().time;
    scene.step();
    scene.draw(1);
    const t2 = last().time;
    scene.setPaused(true);
    const stepsBefore = captured.snowSteps.length;
    scene.draw(0.2);
    const still = { time: last().time, snow: snowKey(last()), santa: santaAt() };
    stepN(scene, 30);
    for (const fraction of [0, 0.5, 1]) {
      scene.draw(fraction);
      expect({ time: last().time, snow: snowKey(last()), santa: santaAt() }).toEqual(still);
    }
    expect(captured.snowSteps).toHaveLength(stepsBefore);
    scene.setPaused(false);
    scene.step();
    scene.draw(1);
    expect(last().time - t2).toBeCloseTo(t2 - t1, 9);
    expect(snowKey(last())).not.toBe(still.snow);
  });

  it('ignores a drag, one in progress at the pause, and keeps a pause that is set twice', async () => {
    const scene = await pausable();
    scene.draw();
    const before = turnOf(scene);
    canvas.fire('pointerdown', { artX: 100, artY: 100 });
    scene.setPaused(true);
    scene.setPaused(true);
    nowMs = 100;
    canvas.fire('pointermove', { artX: 140, artY: 100 });
    canvas.fire('pointerup', { artX: 140, artY: 100 });
    dragBy(40, 0, 0.5);
    scene.step();
    expect(turnOf(scene)).toBeCloseTo(before, 12);
    expect(captured.snowSteps).toHaveLength(0);
    scene.setPaused(false);
    scene.step();
    expect(lastSnow().raise ?? 0).toBe(0);
    expect(turnOf(scene)).toBeCloseTo(before, 12);
  });

  it('cancels a press held across a pause, so moving the same pointer after the resume does not turn or stir', async () => {
    const scene = await pausable();
    scene.step();
    scene.draw();
    const before = turnOf(scene);
    canvas.fire('pointerdown', { artX: 100, artY: 100 });
    scene.setPaused(true);
    scene.setPaused(false);
    nowMs = 100;
    canvas.fire('pointermove', { artX: 160, artY: 60 });
    stepN(scene, 2);
    expect(turnOf(scene)).toBeCloseTo(before, 12);
    expect(lastSnow().raise ?? 0).toBe(0);
  });

  it('keeps the sky following the phases while paused', async () => {
    fakeDate(new Date(2026, 11, 20, 7, 0, 0));
    const scene = await pausable('?now=2026-12-20T07:00:00');
    scene.setPaused(true);
    scene.draw();
    const morning = last().phase;
    expect(morning).toEqual(phaseAt(new Date(2026, 11, 20, 7, 0, 0)));
    vi.setSystemTime(new Date(2026, 11, 20, 23, 0, 0));
    scene.draw();
    expect(last().phase).toEqual(phaseAt(new Date(2026, 11, 20, 23, 0, 0)));
    expect(last().phase).not.toEqual(morning);
  });

  it('paused across midnight keeps the frame still and shows the heavier snow only on resume; the next midnight too', async () => {
    fakeDate(new Date(2026, 11, 24, 23, 59, 58));
    const scene = await pausable('?now=2026-12-24T23:59:58');
    scene.step();
    scene.draw();
    scene.setPaused(true);
    const still = snowKey(last());
    vi.setSystemTime(new Date(2026, 11, 25, 0, 0, 1));
    scene.step();
    scene.draw();
    expect(snowKey(last())).toBe(still);
    expect(last().snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
    scene.setPaused(false);
    scene.step();
    scene.draw();
    expect(last().snow?.flakes.length).toBe(GLOBE_SNOW.christmasDay.flakes);
    scene.setPaused(true);
    vi.setSystemTime(new Date(2026, 11, 26, 0, 0, 1));
    scene.step();
    scene.draw();
    expect(last().snow?.flakes.length).toBe(GLOBE_SNOW.christmasDay.flakes);
    scene.setPaused(false);
    scene.step();
    scene.draw();
    expect(last().snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
  });

  it('exposes paused, starting unpaused on every visit, and remembers nothing', async () => {
    const scene = await pausable();
    expect(scene.paused).toBe(false);
    scene.setPaused(true);
    expect(scene.paused).toBe(true);
    scene.setPaused(false);
    expect(scene.paused).toBe(false);
    scene.setPaused(true);
    vi.resetModules();
    expect((await pausable()).paused).toBe(false);
  });

  it('never reads the reduce-motion setting or any storage', async () => {
    const matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => undefined }));
    const store = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('window', { ...window, matchMedia });
    vi.stubGlobal('matchMedia', matchMedia);
    vi.stubGlobal('localStorage', store);
    vi.stubGlobal('sessionStorage', store);
    const scene = await pausable();
    scene.setPaused(true);
    scene.step();
    scene.draw();
    scene.setPaused(false);
    scene.step();
    scene.draw();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });
});

// XMAS-92b "The glass as one smooth shear on its own layer": with the fine layer on the frame
// leaves the glass out (glassApart) and the fine layer gets the glass for the frame's turn; with
// no fine layer the glass stays in the picture. The real frame source runs, as the glass layer
// is built from the frame's layout.
describe('the scene page gives the glass to the fine layer (XMAS-92b)', () => {
  const glassOfFrame = (): FineFrame['glass'] => (captured.fineFrames[captured.fineFrames.length - 1] as FineFrame | undefined)?.glass;

  it('with the fine layer on asks for the frame with glassApart true and hands the fine layer that turn\'s glass', async () => {
    captured.realFrames = true;
    const scene = await loadDragScene();
    leanBy(scene);
    scene.draw();
    const input = last();
    expect(input.glassApart).toBe(true);
    const want = glassLayer(sceneLayout(input.width, input.height, input.seed), input.phase, input.turn ?? Number.NaN);
    const got = glassOfFrame();
    expect(got, 'a glass is passed').toBeDefined();
    expect(got).toEqual(want);
    expect(got?.pixels.some((c) => c !== 0)).toBe(true);
  });

  const drawTwiceAt = async (at: Date, advanceMs: number): Promise<[FineFrame['glass'], FineFrame['glass']]> => {
    fakeDate(at);
    captured.realFrames = true;
    const scene = await loadDragScene();
    leanBy(scene);
    scene.draw();
    const first = glassOfFrame();
    vi.setSystemTime(at.getTime() + advanceMs);
    scene.draw();
    expect(captured.fineFrames.length).toBeGreaterThanOrEqual(2);
    return [first, glassOfFrame()];
  };

  it.each([
    ['at the same turn and phase reading hand it the same glass object (kept, not rebuilt)', new Date(2026, 11, 20, 7, 0, 0), 0, true],
    ['inside a sky blend, a later one gets a rebuilt glass (the phase share moves)', new Date(2026, 11, 20, 6, 30, 0), 5000, false],
    ['inside a sky blend, one at the same instant keeps the glass', new Date(2026, 11, 20, 6, 30, 0), 0, true],
  ])('two draws %s', async (_title, at, advanceMs, kept) => {
    const [first, second] = await drawTwiceAt(at, advanceMs);
    expect(first).toBeDefined();
    if (kept) expect(second).toBe(first);
    else expect(second).not.toBe(first);
  });

  it('a different turn hands a different glass (it is built for the frame, not once)', async () => {
    captured.realFrames = true;
    const scene = await loadDragScene();
    scene.draw();
    const before = glassOfFrame();
    leanBy(scene, -120);
    scene.draw();
    expect(glassOfFrame()?.pixels).not.toEqual(before?.pixels);
  });

  it('with the fine layer off (no 2d context) leaves glassApart unset and passes no glass', async () => {
    captured.realFrames = true;
    captured.fineResult = false;
    const scene = await loadDragScene();
    scene.draw(); // the first frame tries the fine layer and learns it cannot draw
    captured.inputs = [];
    const drawsBefore = captured.fineFrames.length;
    scene.draw();
    expect(last().glassApart ?? false).toBe(false);
    expect(captured.fineFrames.length, 'the fine layer is not asked again').toBe(drawsBefore);
  });
});
