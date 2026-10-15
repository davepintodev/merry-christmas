// XMAS-32d "The globe", slice 4, changed by XMAS-41b2: the automatic turn is
// gone (the visitor's drag turns it), so with no
// drag the globe stays at its starting turn. The page file runs
// on import; here the browser bits it touches are stand-ins, the loop is
// captured instead of run, and the frame source records what it is asked for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leanBox } from '../scene/lean.ts';
import { rowShift } from '../scene/lean.ts';
import { sceneLayout, type SceneInput } from '../scene/frame.ts';
import { snowDrawList, type SnowStep as DrawnFlake } from '../scene/snow-draw-list.ts';
import type { GlobeSnow } from '../scene/snow.ts';
import type { FineFrame } from './fine-layer.ts';
import { GLOBE_SNOW } from '../scene/snow.ts';
import { DRAG_SETTINGS } from './drag.ts';
import type { LoopScene } from './loop.ts';
import { STEP_MS } from './steps.ts';

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
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
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
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
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
  captured.scene = null;
  captured.inputs = [];
  vi.resetModules();
  captured.snowSteps = [];
  captured.realFrames = false;
  captured.fineResult = true;
  captured.fineFrames = [];
  captured.puts = [];
  captured.listenersAtLoopStart = -1;
  captured.loopStarts = 0;
  nowMs = 0;
  canvas = new FakeCanvas();
  canvasRef.current = canvas;
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
  });
  vi.stubGlobal('document', { querySelector: () => canvas, hidden: false, addEventListener: () => undefined });
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('performance', { now: () => nowMs, mark: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  canvasRef.current = null;
});

async function loadScene(search = ''): Promise<LoopScene> {
  vi.stubGlobal('location', { search });
  await import('./scene.ts');
  const scene = captured.scene;
  if (scene === null) expect.fail('the page did not start the scene loop');
  return scene;
}

function last(): SceneInput {
  const input = captured.inputs[captured.inputs.length - 1];
  if (input === undefined) expect.fail('no frame was drawn');
  return input;
}

/** The globe's starting turn, in radians (the old automatic turn's start). */
const START_TURN = 0.5;

describe('the scene page no longer turns the globe by itself', () => {
  it('asks for the first frame at the starting turn', async () => {
    const scene = await loadScene();
    scene.draw();
    const input = last();
    expect(input.time).toBe(0);
    expect(input.turn, 'a turn is passed').toBeDefined();
    expect(input.turn).toBeCloseTo(START_TURN, 12);
  });

  it('passes the same turn on every frame however many steps go by', async () => {
    const scene = await loadScene();
    for (const steps of [1, 59, 60, 600, 3600]) {
      for (let k = 0; k < steps; k++) scene.step();
      scene.draw();
      const input = last();
      expect(input.turn ?? Number.NaN, `time ${input.time}`).toBeCloseTo(START_TURN, 12);
    }
    expect(last().time).toBeCloseTo(4320 * STEP_MS, 9);
  });
});

describe('the scene page wires the snow', () => {
  const snowKey = (i: SceneInput): string => JSON.stringify([i.snow?.flakes ?? null, i.outsideSnow?.flakes ?? null]);

  it('passes both snows to the frame source once a step has run', async () => {
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const input = last();
    expect(input.snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
    expect(input.outsideSnow?.flakes.length).toBeGreaterThan(0);
    expect(input.outsideSnow?.flakes.length).toBe(Math.round(((input.width * input.height) / 700) * 2.5));
  });

  it('steps the snow once per step, not per draw', async () => {
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const afterOne = snowKey(last());
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
  });

  it('is the same snow on every frame, moved on in place', async () => {
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const first = last();
    for (let k = 0; k < 30; k++) scene.step();
    scene.draw();
    expect(first.snow, 'a snow is passed').toBeDefined();
    expect(last().snow).toBe(first.snow);
  });

  it('draws the same snow after the same steps on a fresh page (fixed seed)', async () => {
    const run = async (): Promise<string> => {
      captured.inputs = [];
      vi.resetModules();
      const scene = await loadScene();
      for (let k = 0; k < 100; k++) scene.step();
      scene.draw();
      return snowKey(last());
    };
    const [a, b] = [await run(), await run()];
    expect(a).not.toBe('[null,null]');
    expect(a).toBe(b);
  });

  it('uses the Christmas Day amounts on Christmas Day', async () => {
    const scene = await loadScene('?now=2026-12-25T10:00:00');
    scene.step();
    scene.draw();
    expect(last().snow?.flakes.length).toBe(GLOBE_SNOW.christmasDay.flakes);
  });

  it('uses the ordinary amounts the day before and the day after', async () => {
    for (const now of ['2026-12-24T23:59:59', '2026-12-26T00:00:00']) {
      captured.inputs = [];
      vi.resetModules();
      const scene = await loadScene(`?now=${now}`);
      scene.step();
      scene.draw();
      expect(last().snow?.flakes.length, now).toBe(GLOBE_SNOW.ordinary.flakes);
    }
  });

  it('changes the amounts live when the clock crosses midnight into Christmas Day and out of it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 11, 24, 23, 59, 58));
      const scene = await loadScene('?now=2026-12-24T23:59:58');
      scene.step();
      scene.draw();
      expect(last().snow?.flakes.length).toBe(340);
      vi.setSystemTime(new Date(2026, 11, 25, 0, 0, 1));
      scene.step();
      scene.draw();
      expect(last().snow?.flakes.length).toBe(500);
      vi.setSystemTime(new Date(2026, 11, 26, 0, 0, 1));
      scene.step();
      scene.draw();
      expect(last().snow?.flakes.length).toBe(340);
    } finally {
      vi.useRealTimers();
    }
  });
});

// XMAS-41b2 "Drag input", page wiring: src/page/scene.ts makes one drag, hands
// the pointer to it, steps it once per scene step and feeds turn and lean to
// the frame and raise and push to the snow. The page file runs on import; here
// the canvas is a fake that holds its listeners, the loop is captured instead
// of run (noting what was attached by the time it started), the snow runtime
// records each step, and the frame source records what it is asked for.
async function loadDragScene(): Promise<LoopScene> {
  const scene = await loadScene();
  scene.draw(); // sizes the canvas, so client pixels convert to art pixels
  captured.inputs = [];
  return scene;
}

function drawn(scene: LoopScene): SceneInput {
  scene.draw();
  const input = captured.inputs[captured.inputs.length - 1];
  if (input === undefined) expect.fail('no frame was drawn');
  return input;
}

function lastSnow(): SnowStep {
  const step = captured.snowSteps[captured.snowSteps.length - 1];
  if (step === undefined) expect.fail('the snow was not stepped');
  return step;
}

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

describe('the pointer is attached by the page', () => {
  it('listens on the scene canvas for the five pointer events', async () => {
    await loadDragScene();
    expect([...canvas.listeners.keys()].sort()).toEqual(['lostpointercapture', 'pointercancel', 'pointerdown', 'pointermove', 'pointerup']);
  });

  it('attaches before the loop starts, so before the first frame and before globe-ready can be marked', async () => {
    vi.stubGlobal('location', { search: '' });
    await import('./scene.ts');
    expect(captured.loopStarts).toBe(1);
    expect(captured.listenersAtLoopStart).toBe(5);
  });
});

describe('a change of art scale mid-drag', () => {
  it('ends the old drag without a jump, attaches the listeners once, and a fresh drag works', async () => {
    const scene = await loadDragScene();
    const start = drawn(scene).turn ?? Number.NaN;
    canvas.fire('pointerdown', { artX: 100, artY: 100 });
    nowMs = 100;
    canvas.fire('pointermove', { artX: 120, artY: 100 });
    scene.step();
    const held = drawn(scene).turn ?? Number.NaN;
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
    expect(drawn(scene).turn ?? Number.NaN).toBeCloseTo(held, 9);
    expect(lastSnow().raise ?? 0).toBe(0);
    expect(lastSnow().push ?? { x: 0, y: 0, z: 0 }).toEqual({ x: 0, y: 0, z: 0 });

    dragBy(10, 0, 0.5);
    scene.step();
    expect(drawn(scene).turn ?? Number.NaN).toBeLessThan(held);
  });
});

describe('a drag turns the globe', () => {
  it('turns it by the turn per art pixel for each art pixel moved sideways, converting client to art pixels', async () => {
    const scene = await loadDragScene();
    const before = drawn(scene).turn ?? Number.NaN;
    dragBy(40, 0, 0.5);
    scene.step();
    expect(drawn(scene).turn ?? Number.NaN).toBeCloseTo(before - 40 * DRAG_SETTINGS.turnPerPixel, 9);
  });

  it('a drag the other way turns it back', async () => {
    const scene = await loadDragScene();
    const before = drawn(scene).turn ?? Number.NaN;
    dragBy(-25, 0, 0.5);
    scene.step();
    expect(drawn(scene).turn ?? Number.NaN).toBeCloseTo(before + 25 * DRAG_SETTINGS.turnPerPixel, 9);
  });

  it('the turn is kept after the finger lifts, however many steps go by (no auto turn, no spring-back)', async () => {
    const scene = await loadDragScene();
    dragBy(40, 0, 0.5);
    scene.step();
    const after = drawn(scene).turn ?? Number.NaN;
    for (let k = 0; k < 1200; k++) scene.step();
    expect(drawn(scene).turn ?? Number.NaN).toBeCloseTo(after, 12);
  });

  it('the turn moves only when the scene steps, not when it draws', async () => {
    const scene = await loadDragScene();
    const before = drawn(scene).turn ?? Number.NaN;
    dragBy(40, 0, 0.5, 10, false);
    expect(drawn(scene).turn ?? Number.NaN).toBeCloseTo(before, 12);
    scene.step();
    expect(drawn(scene).turn ?? Number.NaN).toBeLessThan(before);
  });

  it('feeds the snow the same turn the frame is drawn with', async () => {
    const scene = await loadDragScene();
    dragBy(40, 0, 0.5);
    scene.step();
    expect(lastSnow().turn).toBeCloseTo(drawn(scene).turn ?? Number.NaN, 12);
  });

  it('a second finger does not move the globe', async () => {
    const scene = await loadDragScene();
    const before = drawn(scene).turn ?? Number.NaN;
    canvas.fire('pointerdown', { id: 1, artX: 100, artY: 100 });
    canvas.fire('pointerdown', { id: 2, artX: 300, artY: 100 });
    nowMs = 100;
    canvas.fire('pointermove', { id: 2, artX: 380, artY: 100 });
    canvas.fire('pointermove', { id: 1, artX: 110, artY: 100 });
    scene.step();
    expect(drawn(scene).turn ?? Number.NaN).toBeCloseTo(before - 10 * DRAG_SETTINGS.turnPerPixel, 9);
  });
});

describe('the globe leans into a drag and springs back', () => {
  it('leans while dragging sideways, and the lean returns to upright', async () => {
    const scene = await loadDragScene();
    expect(drawn(scene).lean ?? 0).toBe(0);
    dragBy(40, 0, 0.3, 10, false);
    for (let k = 0; k < 6; k++) scene.step();
    const leaning = drawn(scene).lean ?? 0;
    expect(leaning).toBeGreaterThan(0.01);
    canvas.fire('pointerup', { artX: 140, artY: 100 });
    for (let k = 0; k < 600; k++) scene.step();
    expect(Math.abs(drawn(scene).lean ?? 1)).toBeLessThan(0.005);
  });

  it('leans the other way for a drag the other way', async () => {
    const scene = await loadDragScene();
    dragBy(-40, 0, 0.3, 10, false);
    for (let k = 0; k < 6; k++) scene.step();
    expect(drawn(scene).lean ?? 0).toBeLessThan(-0.01);
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
    for (let k = 0; k < 5; k++) scene.step();
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
    scene.step();
    expect(lastSnow().raise ?? 0).toBeCloseTo(5 * DRAG_SETTINGS.stirPerPixel, 9);
    scene.step();
    expect(lastSnow().raise ?? 0).toBe(0);
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

  it('several frames between steps (or none) do not step the snow or the drag again', async () => {
    const scene = await loadDragScene();
    dragBy(3, 4, 5, 3, false);
    scene.draw();
    scene.draw();
    scene.draw();
    expect(captured.snowSteps).toHaveLength(0);
    scene.step();
    expect(captured.snowSteps).toHaveLength(1);
    expect(lastSnow().raise ?? 0).toBeCloseTo(5 * DRAG_SETTINGS.stirPerPixel, 9);
    scene.draw();
    scene.draw();
    expect(captured.snowSteps).toHaveLength(1);
  });

  it('several steps in one frame spend the stir once, on the first of them', async () => {
    const scene = await loadDragScene();
    dragBy(3, 4, 5, 3, false);
    scene.step();
    scene.step();
    scene.step();
    const raises = captured.snowSteps.map((s) => s.raise ?? 0);
    expect(raises[0]).toBeGreaterThan(0);
    expect(raises.slice(1)).toEqual([0, 0]);
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

// XMAS-84 "Snow inside the glass on the fine layer", page wiring: the flakes go to the
// fine layer as draw steps blended between the last two steps, and when the fine layer
// has no 2d context they go on the scene canvas in the right order and with the lean.
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
  });

  it('draws the step before the last at fraction 0 and the last at fraction 1', async () => {
    captured.realFrames = true;
    const scene = await loadScene();
    scene.step();
    scene.draw();
    const before = copy(last().snow);
    scene.step();
    scene.draw(0);
    const now = copy(last().snow);
    expect(xy(lastFine().snowFront ?? [])).toEqual(xy(snowDrawList(now, before, 0, 'front')));
    scene.draw(1);
    expect(xy(lastFine().snowFront ?? [])).toEqual(xy(snowDrawList(now, before, 1, 'front')));
  });

  it('with only one step of snow draws the flakes at the current position, whatever the fraction', async () => {
    captured.realFrames = true;
    const scene = await loadScene();
    scene.step();
    scene.draw(0.5);
    const now = copy(last().snow);
    expect(xy(lastFine().snowFront ?? [])).toEqual(xy(snowDrawList(now, undefined, 0.5, 'front')));
    expect(xy(lastFine().snowBehind ?? [])).toEqual(xy(snowDrawList(now, undefined, 0.5, 'behind')));
  });

  it('with no step yet draws no flakes', async () => {
    captured.realFrames = true;
    const scene = await loadScene();
    scene.draw();
    expect(lastFine().snowBehind ?? []).toEqual([]);
    expect(lastFine().snowFront ?? []).toEqual([]);
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
      if (lean) {
        dragBy(-40, 0, 0.3, 10, false);
        for (let n = 0; n < 6; n++) scene.step();
      } else scene.step();
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
      const lean = input.lean ?? 0;
      const row = Math.floor(layout.globe.cy - 5);
      const shift = rowShift(lean, leanBox(input.width, layout).bottom, row);
      expect(Math.abs(shift), 'the lean moves this row').toBeGreaterThanOrEqual(1);
      const x = Math.floor(layout.globe.cx + 10);
      expect(pixel(rgba, input.width, x + shift, row)).toBe(WHITE);
      expect(pixel(rgba, input.width, x, row)).not.toBe(WHITE);
    });
  });
});
