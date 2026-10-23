// XMAS-113 ?perf: the draw's canvas calls are timed and counted in a tally, and the frame trace adds them up per second.
// Checked on a hand-written 2D context whose calls move a hand-driven clock, so each call's time is exact.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreCanvas, saveCanvas, setShear } from './fine-layer-pixels.ts';
import type { SnowStep } from '../scene/snow-draw-list.ts';
import { blankCanvasCalls, blankFineTrace, createFrameTrace, type CanvasCalls, type FineTrace, type TraceSecond } from './frame-trace.ts';
import { mountReadout } from './perf-readout.ts';
import { createPerfStats, type PerfSnapshot } from './perf-stats.ts';
import { readoutLink } from './scene-perf.ts';

/** A page clock that moves only when the fake context's calls move it. */
class FakeClock {
  now = 0;
}

/** A fake 2D context: each call moves the clock by its cost, and the calls it got are listed in order. */
class FakeContext {
  readonly log: string[] = [];

  constructor(private readonly clock: FakeClock) {}

  save(): void {
    this.record('save', 1);
  }
  restore(): void {
    this.record('restore', 2);
  }
  setTransform(): void {
    this.record('setTransform', 4);
  }
  private record(name: string, cost: number): void {
    this.log.push(name);
    this.clock.now += cost;
  }
}

function contextOf(fake: FakeContext): CanvasRenderingContext2D {
  return fake as unknown as CanvasRenderingContext2D;
}

const SHEAR = { lean: 0.5, height: 100 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canvas calls in the draw', () => {
  it('times and counts each call on the tally, with the time the clock moved', () => {
    const clock = new FakeClock();
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const fake = new FakeContext(clock);
    const tally = blankCanvasCalls();

    saveCanvas(contextOf(fake), tally);
    setShear(contextOf(fake), SHEAR, undefined, tally);
    setShear(contextOf(fake), SHEAR, [1, 0, 0, 1, 5, 6], tally);
    restoreCanvas(contextOf(fake), tally);

    expect(fake.log).toEqual(['save', 'setTransform', 'setTransform', 'restore']);
    expect(tally).toMatchObject({ saves: 1, restores: 1, setTransforms: 2, saveMs: 3, setTransformMs: 8 });
    expect(tally.saveMs + tally.setTransformMs).toBe(clock.now);
  });

  it('reads no clock and counts nothing without a tally', () => {
    const clock = new FakeClock();
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const fake = new FakeContext(clock);

    saveCanvas(contextOf(fake));
    setShear(contextOf(fake), SHEAR);
    restoreCanvas(contextOf(fake));

    expect(fake.log).toEqual(['save', 'setTransform', 'restore']);
    expect(now).not.toHaveBeenCalled();
  });

  it('adds the frames of a second up, and peeks at it without taking it', () => {
    const clock = new FakeClock();
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const trace = createFrameTrace(() => clock.now);
    const frames: CanvasCalls[] = [];
    for (const setTransforms of [1, 3]) {
      const fake = new FakeContext(clock);
      const tally = blankCanvasCalls();
      saveCanvas(contextOf(fake), tally);
      for (let i = 0; i < setTransforms; i++) setShear(contextOf(fake), SHEAR, undefined, tally);
      restoreCanvas(contextOf(fake), tally);
      frames.push(tally);
      trace.frame({ ...blankFineTrace(), canvas: tally }, 1, clock.now);
    }

    expect(trace.peek()).toMatchObject({ frames: 2, saves: 2, restores: 2, setTransforms: 4 });
    const second = trace.take();
    const [first, last] = frames as [CanvasCalls, CanvasCalls];
    expect(second).toMatchObject({
      saves: 2,
      restores: 2,
      setTransforms: 4,
      clips: 0,
      drawImages: 0,
      fillRects: 0,
      saveMs: { sum: first.saveMs + last.saveMs, max: Math.max(first.saveMs, last.saveMs) },
      setTransformMs: { sum: first.setTransformMs + last.setTransformMs, max: last.setTransformMs },
    });
    expect(trace.peek()).toBeNull();
  });
});

// ---- the whole draw, on a recording page ----

/** A 2D context that records every call by name and moves the clock by that call's cost (fillRect 3, the rest 1). */
function recordingContext(log: string[], clock: FakeClock): CanvasRenderingContext2D {
  const methods = new Map<string, () => unknown>();
  return new Proxy({} as Record<string, unknown>, {
    get(target, name: string) {
      if (name in target) return target[name];
      if (name === 'createImageData' || name === 'getImageData') {
        return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      }
      let method = methods.get(name);
      if (method === undefined) {
        method = () => {
          log.push(name);
          clock.now += name === 'fillRect' ? 3 : 1;
          return undefined;
        };
        methods.set(name, method);
      }
      return method;
    },
    set(target, name: string, value) {
      target[name] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Runs one draw with snow on the recording page, traced or not; returns the trace, the calls the contexts got, the clock's time and the clock reads. */
async function tracedDraw(traced = true): Promise<{ trace: FineTrace; log: string[]; shapesCalls: number; ms: number; reads: number }> {
  const { makeFineLayer } = await import('./fine-layer.ts');
  const { sceneLayout } = await import('../scene/frame.ts');
  const clock = new FakeClock();
  let reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    reads += 1;
    return clock.now;
  });
  const log: string[] = [];
  const makeCanvas = (): unknown => {
    const canvas: Record<string, unknown> = { width: 0, height: 0, style: {} };
    const context = recordingContext(log, clock);
    // Each new 2d context costs 2 ms, as making one does; the draw makes its contexts before its first section.
    canvas['getContext'] = () => {
      clock.now += 2;
      return context;
    };
    canvas['after'] = () => undefined;
    return canvas;
  };
  const original = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: makeCanvas };
  try {
    const layout = sceneLayout(240, 180, 7);
    const flakes = (depth: number): SnowStep[] => [0, 1, 2].map((i) => ({ x: i, y: i, colour: 0xaebcf0, shape: [[0, 0], [1, 0]], depth }));
    const trace: FineTrace = blankFineTrace();
    const layer = makeFineLayer(makeCanvas() as HTMLCanvasElement);
    layer.draw(
      { layout, width: 240, turn: 0.4, lean: 0.15, santaTimeMs: 3000, snowBehind: flakes(-20), snowFront: flakes(20) },
      { scale: 3, ratio: 1.5, left: 7, ...(traced ? { trace } : {}) },
    );
    return { trace, log, shapesCalls: trace.shapesCalls, ms: clock.now, reads };
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
}

/** The tally's fields XMAS-113 asks for beyond the first cut: fillRect time and the clip-path count. */
type Wanted = CanvasCalls & { fillRectMs: number; paths: number };
const count = (log: string[], name: string): number => log.filter((n) => n === name).length;

describe('canvas calls over a whole draw', () => {
  it('tallies every clip, drawImage, fillRect, save and setTransform the draw made, snow and origin draws included', async () => {
    const { trace, log } = await tracedDraw();
    const canvas = trace.canvas as CanvasCalls;
    expect(count(log, 'fillRect')).toBeGreaterThan(0);
    expect(canvas.fillRects).toBe(count(log, 'fillRect'));
    expect(canvas.drawImages).toBe(count(log, 'drawImage'));
    expect(canvas.clips).toBe(count(log, 'clip'));
    expect(canvas.saves).toBe(count(log, 'save'));
    expect(canvas.restores).toBe(count(log, 'restore'));
    expect(canvas.setTransforms).toBe(count(log, 'setTransform'));
  });

  it('times fillRect and counts the clip paths built, as well as timing them', async () => {
    const { trace, log } = await tracedDraw();
    const canvas = trace.canvas as Wanted;
    expect(canvas.fillRectMs).toBe(3 * count(log, 'fillRect'));
    expect(canvas.paths).toBe(count(log, 'beginPath'));
    expect(canvas.paths).toBeGreaterThan(0);
    expect(canvas.pathMs).toBeGreaterThan(0);
  });
});

// ---- the readout's rows ----

class FakeElement {
  textContent = '';
  className = '';
  id = '';
  type = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  setAttribute(): void {}
  addEventListener(): void {}
  append(...kids: FakeElement[]): void {
    this.children.push(...kids);
  }
}

let restorePage = (): void => undefined;

function mountOnFakePage(): { values: Map<string, FakeElement>; readout: { show(snap: PerfSnapshot, fineMs: number | null, canvas: TraceSecond | null): void } } {
  const made: FakeElement[] = [];
  const original = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const element = new FakeElement();
      made.push(element);
      return element;
    },
    head: new FakeElement(),
    body: new FakeElement(),
    querySelector: () => null,
  };
  restorePage = () => {
    (globalThis as { document?: unknown }).document = original;
  };
  const readout = mountReadout(() => undefined);
  return { readout, values: new Map(made.filter((e) => e.dataset['perf'] !== undefined).map((e) => [e.dataset['perf'] as string, e])) };
}

describe('the readout canvas rows', () => {
  afterEach(() => restorePage());
  const snapshot = (): PerfSnapshot => {
    const stats = createPerfStats({ version: () => 'full scene' });
    return stats.snapshot(0);
  };

  it('shows a dash before any frame and per-frame values (total over frames) after', () => {
    const { readout, values } = mountOnFakePage();
    readout.show(snapshot(), null, null);
    for (const key of ['save', 'path', 'clip', 'draw', 'transform', 'fill']) expect(values.get(key)?.textContent, key).toBe('–');

    const clock = new FakeClock();
    const trace = createFrameTrace(() => clock.now);
    for (const drawImages of [10, 30]) {
      const tally = { ...blankCanvasCalls(), drawImages, drawImageMs: drawImages / 10, fillRects: drawImages * 2 };
      trace.frame({ ...blankFineTrace(), canvas: tally }, 1, clock.now);
    }
    readout.show(snapshot(), null, trace.peek());
    expect(values.get('draw')?.textContent).toBe('2.00 ms, 20 calls');
    expect(values.get('fill')?.textContent).toContain('40 calls');
  });
});

describe('the readout phase rows', () => {
  afterEach(() => restorePage());

  it('shows each phase per frame over the second, and a dash before any frame', () => {
    const { readout, values } = mountOnFakePage();
    const stats = createPerfStats({ version: () => 'full scene' });
    readout.show(stats.snapshot(0), null, null);
    expect(values.get('shadows')?.textContent).toBe('–');

    const clock = new FakeClock();
    const trace = createFrameTrace(() => clock.now);
    for (const shadows of [4, 8]) {
      trace.frame({ ...blankFineTrace(), totalMs: shadows, shapesMs: shadows, shadowsMs: shadows }, 1, clock.now);
    }
    readout.show(stats.snapshot(0), null, trace.peek());
    expect(values.get('shadows')?.textContent).toBe('6.00 ms');
    expect(values.get('other')?.textContent).toBe('0.00 ms');
  });
});

// ---- the draw's phases (XMAS-113 phase 2) ----

describe('the phases of a whole draw', () => {
  it('fills the phases the draw reaches, and the phases with the remainder add up to the whole draw', async () => {
    const { trace, ms } = await tracedDraw();
    expect(trace.totalMs).toBe(ms);
    for (const phase of [trace.inputsMs, trace.behindMs, trace.shadowsMs, trace.facesMs, trace.frontMs]) expect(phase).toBeGreaterThan(0);
    expect(trace.shapesMs).toBe(trace.shadowsMs + trace.facesMs + trace.shapesRestMs);

    const frames = createFrameTrace(() => 0);
    frames.frame(trace, 0, 0);
    const second = frames.take();
    const named = ['inputsMs', 'glassMs', 'behindMs', 'shadowsMs', 'facesMs', 'shapesRestMs', 'frontMs', 'baseMs'] as const;
    const sum = named.reduce((total, key) => total + (second?.[key].sum ?? 0), 0);
    expect(sum + (second?.otherMs.sum ?? 0)).toBe(second?.totalMs.sum);
    // The clock moves only inside the calls, and every call is inside a phase: nothing is left over.
    expect(second?.otherMs.sum).toBe(0);
  });

  it('reads no clock on an untraced draw, and makes the same calls as a traced one', async () => {
    const traced = await tracedDraw();
    const plain = await tracedDraw(false);
    expect(plain.reads).toBe(0);
    expect(plain.log).toEqual(traced.log);
    expect(plain.trace).toEqual(blankFineTrace());
  });
});

describe('readoutLink: the draws getter', () => {
  it('hands the draws getter on to the readout it starts', async () => {
    const draws = (): TraceSecond | null => null;
    const started: { draws?: () => TraceSecond | null }[] = [];
    const link = readoutLink(async () => ({
      startReadout(opts) {
        started.push(opts);
        return { frame() {}, pause() {}, resume() {} };
      },
    }));
    link.load('/assets/perf.js', draws);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toHaveLength(1);
    expect(started[0]?.draws).toBe(draws);
  });
});
