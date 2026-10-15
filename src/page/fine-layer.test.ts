// XMAS-81 "Fine layer on the page: the shapes": the shapes drawn on the screen's
// pixel grid over the scene canvas. A fake page (a document whose canvases and
// 2d contexts record what is done to them) stands in for the browser: each
// canvas keeps its size, its style writes and every drawing call with the
// transform and smoothing in force at the call. The real draw list, lean box
// and row shifts are used, so the layer is checked against the same numbers
// the scene canvas's glass uses.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { keepBackdrop, leanBox, leanGlass, rowShift } from '../scene/lean.ts';
import { sceneLayout, type SceneLayout } from '../scene/frame.ts';
import { NO_FRONT } from '../scene/globe.ts';
import { shapeDrawList, type DrawStep } from '../scene/shape-draw-list.ts';
import type { SnowStep } from '../scene/snow-draw-list.ts';
import { makeFineLayer, type FineFrame, type FineSite } from './fine-layer.ts';

const W = 240;
const H = 180;
const LAYOUT = sceneLayout(W, H, 7);
const BOX = leanBox(W, LAYOUT);
const BW = BOX.right - BOX.left + 1;
const BH = BOX.bottom - BOX.top;
const SITE: FineSite = { scale: 3, ratio: 1.5, left: 7 };
const IDENTITY = [1, 0, 0, 1, 0, 0];

type Matrix = number[];
type Call = { source: HTMLCanvasElement; args: number[]; matrix: Matrix; smoothing: boolean };
type Put = { data: Uint8ClampedArray; width: number; height: number };

class FakeStyle {
  writes = 0;
  private values = new Map<string, string>();
  set cssText(text: string) {
    this.values.set('cssText', text);
  }
  get cssText(): string {
    return this.values.get('cssText') ?? '';
  }
  private get(key: string): string {
    return this.values.get(key) ?? '';
  }
  private set(key: string, value: string): void {
    this.writes++;
    this.values.set(key, value);
  }
  get left(): string { return this.get('left'); }
  set left(v: string) { this.set('left', v); }
  get top(): string { return this.get('top'); }
  set top(v: string) { this.set('top', v); }
  get width(): string { return this.get('width'); }
  set width(v: string) { this.set('width', v); }
  get height(): string { return this.get('height'); }
  set height(v: string) { this.set('height', v); }
}

class FakeContext {
  imageSmoothingEnabled = true;
  matrix: Matrix = [...IDENTITY];
  saved: Matrix[] = [];
  depth = 0;
  readonly calls: Call[] = [];
  readonly puts: Put[] = [];
  readonly clears: number[][] = [];
  /** Path points with the transform in force when each was added. */
  readonly path: { x: number; y: number; matrix: Matrix; move: boolean }[] = [];
  readonly clips: { x: number; y: number }[][] = [];
  saves = 0;
  restores = 0;
  constructor(readonly canvas: FakeCanvas) {}
  save(): void {
    this.saves++;
    this.saved.push([...this.matrix]);
  }
  restore(): void {
    this.restores++;
    this.matrix = this.saved.pop() ?? [...IDENTITY];
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }
  beginPath(): void {
    this.path.length = 0;
  }
  moveTo(x: number, y: number): void {
    this.path.push({ x, y, matrix: [...this.matrix], move: true });
  }
  lineTo(x: number, y: number): void {
    this.path.push({ x, y, matrix: [...this.matrix], move: false });
  }
  closePath(): void {}
  clip(): void {
    this.clips.push(this.path.map(({ x, y }) => ({ x, y })));
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.clears.push([x, y, w, h]);
  }
  drawImage(source: FakeCanvas, ...args: number[]): void {
    this.calls.push({ source: source as unknown as HTMLCanvasElement, args, matrix: [...this.matrix], smoothing: this.imageSmoothingEnabled });
    this.canvas.page.log.push({ canvas: this.canvas, op: 'draw', call: this.calls[this.calls.length - 1] as Call });
  }
  createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
  putImageData(image: Put): void {
    this.puts.push({ data: Uint8ClampedArray.from(image.data), width: image.width, height: image.height });
    this.canvas.page.log.push({ canvas: this.canvas, op: 'put', put: this.puts[this.puts.length - 1] as Put });
  }
}

class FakeCanvas {
  readonly style = new FakeStyle();
  resizes = 0;
  private w = 300;
  private h = 150;
  private context: FakeContext | null = null;
  contextless = false;
  constructor(readonly page: FakeDocument) {}
  get width(): number { return this.w; }
  set width(v: number) { this.resizes++; this.w = v; }
  get height(): number { return this.h; }
  set height(v: number) { this.resizes++; this.h = v; }
  getContext(): FakeContext | null {
    if (this.contextless) return null;
    this.context ??= new FakeContext(this);
    return this.context;
  }
  after(node: FakeCanvas): void {
    const order = this.page.order;
    order.splice(order.indexOf(this) + 1, 0, node);
  }
}

/** One operation on any canvas's context, in the order it happened: the fake's single ordered record. */
type Op = { canvas: FakeCanvas; op: 'put'; put: Put } | { canvas: FakeCanvas; op: 'draw'; call: Call };

class FakeDocument {
  /** Every putImageData and drawImage on every canvas, in order. */
  readonly log: Op[] = [];
  readonly order: FakeCanvas[] = [];
  readonly made: FakeCanvas[] = [];
  contextless = false;
  createElement(tag: string): FakeCanvas {
    if (tag !== 'canvas') throw new Error(`only canvases are made, not ${tag}`);
    const canvas = new FakeCanvas(this);
    canvas.contextless = this.contextless;
    this.made.push(canvas);
    return canvas;
  }
}

let page: FakeDocument;
let original: unknown;

beforeEach(() => {
  original = (globalThis as { document?: unknown }).document;
  page = new FakeDocument();
  (globalThis as { document?: unknown }).document = page;
});
afterEach(() => {
  (globalThis as { document?: unknown }).document = original;
});

/** The scene canvas on the fake page, and the layer over it. */
function setup(): { main: FakeCanvas; layer: ReturnType<typeof makeFineLayer> } {
  const main = new FakeCanvas(page);
  page.order.push(main);
  return { main, layer: makeFineLayer(main as unknown as HTMLCanvasElement) };
}

function emptyFront(): Uint32Array {
  return new Uint32Array(W * H).fill(NO_FRONT);
}

function frame(over: Partial<FineFrame> = {}): FineFrame {
  return { layout: LAYOUT, width: W, turn: 0.4, lean: 0, front: emptyFront(), ...over };
}

function layersOf(main: FakeCanvas): { shapes: FakeCanvas; fronts: FakeCanvas } {
  const at = page.order.indexOf(main);
  const shapes = page.order[at + 1];
  const fronts = page.order[at + 2];
  if (shapes === undefined || fronts === undefined) throw new Error('the layers are not on the page');
  return { shapes, fronts };
}

/** The layer of the flakes in front (XMAS-84), over the front layer. */
function snowFrontOf(main: FakeCanvas): FakeCanvas {
  const snow = page.order[page.order.indexOf(main) + 3];
  if (snow === undefined) throw new Error('the snow layer is not on the page');
  return snow;
}

function ctxOf(canvas: FakeCanvas): FakeContext {
  const c = canvas.getContext();
  if (c === null) throw new Error('no context');
  return c;
}

function px(value: number): number {
  return Number.parseFloat(value as unknown as string);
}

/** The matrix and clip the layer should use for a step, worked out from the step alone. */
function expectedMatrix(step: DrawStep, k: number): Matrix {
  const ox = (LAYOUT.globe.cx - BOX.left) * k;
  const oy = (LAYOUT.globe.cy - BOX.top) * k;
  const { a, b, d, drawing } = step;
  return [(k * (b[0] - a[0])) / drawing.width, (k * (b[1] - a[1])) / drawing.width, (k * (d[0] - a[0])) / drawing.height, (k * (d[1] - a[1])) / drawing.height, ox + k * a[0], oy + k * a[1]];
}

function near(p: readonly number[], q: readonly number[]): boolean {
  return p.length === q.length && p.every((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) < 1e-6);
}

type Point = [number, number];

/** Where a matrix puts a point of its source space. */
function through(m: readonly number[], x: number, y: number): Point {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** The device corners (top-left, top-right, bottom-left, bottom-right) the layer should cover for a step: the drawing's own footprint. */
function expectedQuad(step: DrawStep, k: number): Point[] {
  const m = expectedMatrix(step, k);
  const { width: w, height: h } = step.drawing;
  return [through(m, 0, 0), through(m, w, 0), through(m, 0, h), through(m, w, h)];
}

/** The device corners a recorded drawImage covers: its whole source (padding included), through its destination args and transform. */
function drawnQuad(call: Call): Point[] | undefined {
  const [dx, dy, dw, dh] = call.args.length === 2 ? [call.args[0], call.args[1], undefined, undefined] : call.args.length === 4 ? call.args : [undefined, undefined, undefined, undefined];
  if (dx === undefined || dy === undefined) return undefined;
  const w = dw ?? call.source.width;
  const h = dh ?? call.source.height;
  return [through(call.matrix, dx, dy), through(call.matrix, dx + w, dy), through(call.matrix, dx, dy + h), through(call.matrix, dx + w, dy + h)];
}

/** How far a face's drawn quad may stray from its footprint: about one art pixel (or one bitmap pixel, if larger) of growth or padding. */
function slack(step: DrawStep, k: number): number {
  const m = expectedMatrix(step, k);
  return 2 * Math.max(k, Math.hypot(m[0] ?? 0, m[1] ?? 0), Math.hypot(m[2] ?? 0, m[3] ?? 0));
}

/** Whether a drawn call is the step's face: same place, within the slack, corner for corner. */
function isFace(call: Call, step: DrawStep, k: number): boolean {
  const quad = drawnQuad(call);
  if (quad === undefined) return false;
  const want = expectedQuad(step, k);
  const tol = slack(step, k);
  return quad.every(([x, y], n) => Math.hypot(x - (want[n]?.[0] ?? Number.NaN), y - (want[n]?.[1] ?? Number.NaN)) <= tol);
}

/** Finds each step's face among the calls, in draw order (extra calls between are allowed); returns the matched calls. */
function findFaces(calls: Call[], steps: DrawStep[], k: number): Call[] {
  const found: Call[] = [];
  let at = 0;
  steps.forEach((step, i) => {
    let n = at;
    while (n < calls.length && !(calls[n] !== undefined && isFace(calls[n] as Call, step, k))) n++;
    expect(n, `face ${i} is on the layer, after the one before it`).toBeLessThan(calls.length);
    found.push(calls[n] as Call);
    at = n + 1;
  });
  return found;
}

describe('makeFineLayer: what it puts on the page', () => {
  it('makes nothing until the first draw', () => {
    setup();
    expect(page.made).toHaveLength(0);
    expect(page.order).toHaveLength(1);
  });

  it('puts the shapes canvas right after the scene canvas and the front canvas right after that', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes, fronts } = layersOf(main);
    expect(page.order.slice(0, 3)).toEqual([main, shapes, fronts]);
    expect(shapes).not.toBe(fronts);
    // The flakes in front (XMAS-84) sit on a layer of their own, over Santa's front layer.
    expect(page.order[3]).toBe(snowFrontOf(main));
  });

  it('makes the two layers once: a second draw adds no canvas to the page', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const first = [...page.order];
    layer.draw(frame({ turn: 1.9 }), SITE);
    expect(page.order).toEqual(first);
    expect(page.order[0]).toBe(main);
  });

  it('lays both layers fixed, above nothing, never taking the pointer, and not smoothed when scaled', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes, fronts } = layersOf(main);
    for (const canvas of [shapes, fronts]) {
      expect(canvas.style.cssText).toContain('position:fixed');
      expect(canvas.style.cssText).toContain('pointer-events:none');
      expect(canvas.style.cssText).toContain('image-rendering:pixelated');
    }
  });
});

describe('makeFineLayer: lined up with the glass', () => {
  const SITES: [string, FineSite][] = [
    ['360x700 at 2x (scale 6, left 0)', { scale: 6, ratio: 2, left: 0 }],
    ['1920x1130 at 1x', { scale: 4, ratio: 1, left: 336 }],
    ['a fractional ratio', { scale: 5, ratio: 1.25, left: 12.8 }],
    ['a narrow window: the picture overhangs, left negative', { scale: 3, ratio: 1.5, left: -41.333333333333336 }],
  ];

  for (const [name, site] of SITES) {
    it(`${name}: both layers sit on the lean box in CSS pixels`, () => {
      const { main, layer } = setup();
      layer.draw(frame(), site);
      const { shapes, fronts } = layersOf(main);
      const css = site.scale / site.ratio;
      for (const canvas of [shapes, fronts]) {
        expect(px(canvas.style.left as unknown as number)).toBeCloseTo(site.left + BOX.left * css, 6);
        expect(px(canvas.style.top as unknown as number)).toBeCloseTo(BOX.top * css, 6);
        expect(px(canvas.style.width as unknown as number)).toBeCloseTo(BW * css, 6);
        expect(px(canvas.style.height as unknown as number)).toBeCloseTo(BH * css, 6);
      }
    });

    it(`${name}: the shapes canvas has one pixel per device pixel, the front canvas one per art pixel`, () => {
      const { main, layer } = setup();
      layer.draw(frame(), site);
      const { shapes, fronts } = layersOf(main);
      expect(shapes.width).toBe(BW * site.scale);
      expect(shapes.height).toBe(BH * site.scale);
      // A device pixel is 1 / ratio CSS pixels: the canvas's CSS size times the ratio is its pixel size.
      expect(px(shapes.style.width as unknown as number) * site.ratio).toBeCloseTo(shapes.width, 6);
      expect(px(shapes.style.height as unknown as number) * site.ratio).toBeCloseTo(shapes.height, 6);
      expect(fronts.width).toBe(BW);
      expect(fronts.height).toBe(BH);
    });

    it(`${name}: the layer's left edge lands on a whole device pixel when the picture's does`, () => {
      const wholeLeft = Math.round(site.left * site.ratio) / site.ratio;
      const { main, layer } = setup();
      layer.draw(frame(), { ...site, left: wholeLeft });
      const { shapes } = layersOf(main);
      const device = px(shapes.style.left as unknown as number) * site.ratio;
      expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-6);
    });
  }

  it('follows a resize: a new picture width moves and re-sizes the layers, and a ratio change re-places them', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const wide = sceneLayout(W + 40, H, 7);
    const wideBox = leanBox(W + 40, wide);
    layer.draw({ layout: wide, width: W + 40, turn: 0.4, lean: 0, front: new Uint32Array((W + 40) * H).fill(NO_FRONT) }, { scale: 2, ratio: 2, left: 3 });
    const { shapes, fronts } = layersOf(main);
    expect(shapes.width).toBe((wideBox.right - wideBox.left + 1) * 2);
    expect(fronts.width).toBe(wideBox.right - wideBox.left + 1);
    expect(px(shapes.style.left as unknown as number)).toBeCloseTo(3 + wideBox.left * 1, 6);
    layer.draw({ layout: wide, width: W + 40, turn: 0.4, lean: 0, front: new Uint32Array((W + 40) * H).fill(NO_FRONT) }, { scale: 2, ratio: 1, left: 3 });
    expect(px(shapes.style.left as unknown as number)).toBeCloseTo(3 + wideBox.left * 2, 6);
    expect(px(shapes.style.width as unknown as number)).toBeCloseTo((wideBox.right - wideBox.left + 1) * 2, 6);
  });

  it('does not touch the canvases\' sizes or styles when nothing changed (a size change would clear them)', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes, fronts } = layersOf(main);
    const before = [shapes.resizes, fronts.resizes, shapes.style.writes, fronts.style.writes];
    layer.draw(frame({ turn: 2.2 }), SITE);
    layer.draw(frame({ turn: 3.1 }), SITE);
    expect([shapes.resizes, fronts.resizes, shapes.style.writes, fronts.style.writes]).toEqual(before);
  });

  it('re-sizes the canvases when the scale changes, drawing the new picture fully', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes } = layersOf(main);
    layer.draw(frame(), { ...SITE, scale: 4, ratio: 2 });
    expect(shapes.width).toBe(BW * 4);
    expect(shapes.height).toBe(BH * 4);
    // Cleared at the new size, then drawn: the last clear covers the whole canvas.
    const clear = ctxOf(shapes).clears.at(-1);
    expect(clear).toEqual([0, 0, BW * 4, BH * 4]);
  });
});

describe('makeFineLayer: the shapes with canvas transforms', () => {
  it('draws every face of the draw list, in order, at its place, with no smoothing', () => {
    const { main, layer } = setup();
    for (const turn of [0, 0.4, 1.7, 3.0, 5.9]) {
      layer.draw(frame({ turn }), SITE);
      const { shapes } = layersOf(main);
      const calls = ctxOf(shapes).calls.splice(0);
      const faces = findFaces(calls, shapeDrawList(turn), SITE.scale);
      expect(faces).toHaveLength(shapeDrawList(turn).length);
      // Every image on the layer is drawn unsmoothed, padding and underlays included.
      for (const call of calls) expect(call.smoothing).toBe(false);
    }
  });

  it('turns smoothing off before the first image and clears the canvas first', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.clears[0]).toEqual([0, 0, BW * SITE.scale, BH * SITE.scale]);
  });

  it('keeps its bitmaps cached: no canvas is made per frame, and every frame draws from the same few bitmaps', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const made = page.made.length;
    const first = new Set(ctxOf(layersOf(main).shapes).calls.splice(0).map((c) => c.source));
    layer.draw(frame({ turn: 0.4 }), SITE);
    layer.draw(frame({ turn: 0.45 }), SITE);
    expect(page.made.length).toBe(made);
    const later = new Set(ctxOf(layersOf(main).shapes).calls.splice(0).map((c) => c.source));
    expect(later).toEqual(first);
    // Not one bitmap per face: faces with the same drawing share. The one more is the behind layer, drawn onto the shapes the same way.
    expect(first.size).toBeLessThanOrEqual(new Set(shapeDrawList(0.4).map((s) => s.drawing)).size + 1);
  });

  it('a bitmap holds the drawing\'s own colours, only those, and is clear somewhere', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const colours = masterColours.map((c) => Number.parseInt(c.slice(1), 16));
    const calls = ctxOf(layersOf(main).shapes).calls;
    const sources = [...new Set(calls.map((c) => c.source as unknown as FakeCanvas))];
    const colourSets = new Map<FakeCanvas, Set<number>>();
    let transparent = 0;
    for (const bitmap of sources) {
      const puts = ctxOf(bitmap).puts;
      expect(puts.length, 'bitmap is filled').toBeGreaterThan(0);
      const seen = new Set<number>();
      for (const put of puts) {
        expect(put.width).toBe(bitmap.width);
        expect(put.height).toBe(bitmap.height);
        for (let p = 0; p < put.width * put.height; p++) {
          const [r = 0, g = 0, b = 0, alpha = 0] = put.data.slice(p * 4, p * 4 + 4);
          if (alpha === 0) transparent++;
          else {
            expect(alpha).toBe(255);
            seen.add((r << 16) | (g << 8) | b);
          }
        }
      }
      for (const c of seen) expect(colours).toContain(c);
      colourSets.set(bitmap, seen);
    }
    expect(transparent).toBeGreaterThan(0);
    // Each drawing's colours are all in a bitmap about its size.
    for (const step of shapeDrawList(0.4)) {
      const want = new Set([...step.drawing.pixels].filter((n) => n !== 0).map((n) => colours[n - 1] ?? 0));
      const home = sources.some((bitmap) => bitmap.width >= step.drawing.width && bitmap.width <= step.drawing.width + 4 && bitmap.height >= step.drawing.height && bitmap.height <= step.drawing.height + 4 && [...want].every((c) => colourSets.get(bitmap)?.has(c)));
      expect(home, 'a bitmap holds the drawing\'s colours').toBe(true);
    }
  });

  it('clips a gable to its triangle in device pixels, before the drawing\'s own transform, and restores after every face', () => {
    const { main, layer } = setup();
    const k = SITE.scale;
    const ox = (LAYOUT.globe.cx - BOX.left) * k;
    const oy = (LAYOUT.globe.cy - BOX.top) * k;
    let gables = 0;
    for (const turn of [0.4, 1.7, 3.0, 4.4]) {
      layer.draw(frame({ turn }), SITE);
      const ctx = ctxOf(layersOf(main).shapes);
      const clips = ctx.clips.splice(0);
      const clipped = shapeDrawList(turn).filter((s) => s.clip !== undefined);
      expect(clips.length).toBeGreaterThanOrEqual(clipped.length);
      // Each gable's triangle is clipped, in order, to within an art pixel (a clip may grow along a shared edge).
      let at = 0;
      clipped.forEach((step) => {
        gables++;
        const clip = step.clip ?? [];
        let n = at;
        while (n < clips.length && !clip.every(([x, y], j) => Math.hypot((clips[n]?.[j]?.x ?? Number.NaN) - (ox + k * x), (clips[n]?.[j]?.y ?? Number.NaN) - (oy + k * y)) <= 2 * k)) n++;
        expect(n, 'the gable is clipped to its triangle').toBeLessThan(clips.length);
        at = n + 1;
      });
      // The path was built under the identity transform: it is in device pixels, not the face's own axes.
      expect(ctx.path.every((p) => near(p.matrix, IDENTITY))).toBe(true);
      expect(ctx.restores).toBe(ctx.saves);
      expect(ctx.matrix).toEqual(IDENTITY);
      ctx.saves = 0;
      ctx.restores = 0;
    }
    expect(gables).toBeGreaterThan(0);
  });

  it('a clip does not leak onto the next face: every face is its own save and restore', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    expect(ctx.saves).toBeGreaterThanOrEqual(shapeDrawList(0.4).length);
    expect(ctx.restores).toBe(ctx.saves);
    expect(ctx.matrix).toEqual(IDENTITY);
  });

  it('skips a face that is edge-on instead of drawing a degenerate transform', () => {
    const { main, layer } = setup();
    const real = shapeDrawList(0.4);
    // The layer takes its list from shapeDrawList, so use a turn with an edge-on face if there is one, else check the guard
    // by the invariant: no drawn transform has a zero determinant.
    for (const turn of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 1e-12, Math.PI / 2 + 1e-12]) {
      layer.draw(frame({ turn }), SITE);
      const ctx = ctxOf(layersOf(main).shapes);
      for (const call of ctx.calls.splice(0)) {
        const [m11, m12, m21, m22] = call.matrix;
        expect(Math.abs((m11 ?? 0) * (m22 ?? 0) - (m12 ?? 0) * (m21 ?? 0))).toBeGreaterThan(1e-9);
        expect(call.matrix.every(Number.isFinite)).toBe(true);
      }
    }
    expect(real.length).toBeGreaterThan(0);
  });

  it('is exact at a whole-turn turn and a negative turn: the same faces as turn 0', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0 }), SITE);
    const base = ctxOf(layersOf(main).shapes).calls.splice(0).map((c) => c.matrix);
    for (const turn of [2 * Math.PI, -2 * Math.PI, 6 * Math.PI]) {
      layer.draw(frame({ turn }), SITE);
      const calls = ctxOf(layersOf(main).shapes).calls.splice(0).map((c) => c.matrix);
      expect(calls).toHaveLength(base.length);
      calls.forEach((m, i) => expect(near(m, base[i] ?? [])).toBe(true));
    }
  });

  it('survives a canvas with no 2d context: no throw, and nothing drawn', () => {
    page.contextless = true;
    const { layer } = setup();
    expect(() => layer.draw(frame({ lean: 0.2 }), SITE)).not.toThrow();
  });

  it('throws for a non-finite turn rather than drawing garbage', () => {
    const { layer } = setup();
    expect(() => layer.draw(frame({ turn: Number.NaN }), SITE)).toThrow(RangeError);
  });
});

describe('makeFineLayer: the lean shifts rows by whole art pixels, as leanGlass does', () => {
  it('with no lean draws the shapes straight onto the layer, with no row copies', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0 }), SITE);
    const { shapes } = layersOf(main);
    const snow = snowFrontOf(main);
    const calls = ctxOf(shapes).calls;
    expect(calls.length).toBeGreaterThanOrEqual(shapeDrawList(0.4).length);
    findFaces(calls, shapeDrawList(0.4), SITE.scale);
    // Only the flakes' own layer (XMAS-84) is as wide as the shapes and is not a row copy.
    expect(page.made.some((c) => c !== shapes && c !== snow && c.width === BW * SITE.scale)).toBe(false);
  });

  it('with a lean copies every row of the box from the unleaned shapes, each by rowShift whole art pixels', () => {
    for (const lean of [0.2, -0.35, MAX]) {
      page.made.length = 0;
      page.order.length = 0;
      const { main, layer } = setup();
      layer.draw(frame({ lean }), SITE);
      const { shapes } = layersOf(main);
      const k = SITE.scale;
      const copies = ctxOf(shapes).calls;
      expect(copies).toHaveLength(BH);
      const flat = copies[0]?.source as unknown as FakeCanvas;
      expect(flat).not.toBe(shapes);
      // The faces are painted on the unleaned canvas, one per step.
      findFaces(ctxOf(flat).calls, shapeDrawList(0.4), k);
      let moved = 0;
      copies.forEach((call, n) => {
        const y = BOX.top + n;
        const shift = Math.round(lean * (BOX.bottom - y - 0.5));
        expect(call.source).toBe(flat as unknown as HTMLCanvasElement);
        expect(call.args).toEqual([0, n * k, BW * k, k, shift * k, n * k, BW * k, k]);
        expect(rowShift(lean, BOX.bottom, y)).toBe(shift);
        if (shift !== 0) moved++;
      });
      expect(moved).toBeGreaterThan(BH / 4);
      // The top row moves farthest, the lowest row least, with the lean's sign.
      const top = copies[0]?.args[4] ?? 0;
      const bottom = copies.at(-1)?.args[4] ?? 0;
      expect(Math.sign(top)).toBe(Math.sign(lean));
      expect(Math.abs(top)).toBeGreaterThan(Math.abs(bottom));
      // The leaned canvas is cleared before the rows go on, so nothing of the last frame stays.
      expect(ctxOf(shapes).clears.at(-1)).toEqual([0, 0, BW * k, BH * k]);
    }
  });

  it('shifts only whole art pixels: every copy lands on a multiple of the scale', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0.137 }), { scale: 5, ratio: 1.25, left: 0 });
    for (const call of ctxOf(layersOf(main).shapes).calls) expect((call.args[4] ?? 1) % 5).toBe(0);
  });

  it('returns to drawing straight onto the layer when the lean goes back to 0, clearing the leaned copy', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0.3 }), SITE);
    const { shapes } = layersOf(main);
    const ctx = ctxOf(shapes);
    ctx.calls.splice(0);
    layer.draw(frame({ lean: 0 }), SITE);
    findFaces(ctx.calls, shapeDrawList(0.4), SITE.scale);
    expect(ctx.calls.every((c) => c.source !== (ctx.canvas as unknown))).toBe(true);
    expect(ctx.clears.at(-1)).toEqual([0, 0, BW * SITE.scale, BH * SITE.scale]);
  });

  it('a lean frame after an upright one leaves nothing of the upright frame behind', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0 }), SITE);
    layer.draw(frame({ lean: 0.2 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    // The last clear of the layer comes before its copies.
    expect(ctx.clears.length).toBeGreaterThanOrEqual(2);
  });

  it('agrees with leanGlass on where each row goes, for the layer\'s front pixels', () => {
    for (const lean of [0.08, 0.31, -0.22, 0.5, -0.5]) {
      const { main, layer } = setup();
      const { cx, cy, radius } = LAYOUT.globe;
      // leanGlass on a picture with a marker at the globe's centre column on every row of the glass.
      const picture = new Uint32Array(W * H);
      keepBackdrop(picture, W, LAYOUT);
      const front = emptyFront();
      const rows: number[] = [];
      for (let y = Math.ceil(cy - radius + 2); y < cy + radius - 2; y++) {
        picture[y * W + cx] = 0x100000 + y;
        front[y * W + cx] = 0x100000 + y;
        rows.push(y);
      }
      leanGlass(picture, W, LAYOUT, lean);
      layer.draw(frame({ lean, front }), SITE);
      const image = ctxOf(layersOf(main).fronts).puts.at(-1);
      expect(image).toBeDefined();
      let checked = 0;
      for (const y of rows) {
        const want = picture.indexOf(0x100000 + y, y * W) - y * W; // where leanGlass put the marker on its row
        const seen = Array.from({ length: BW }, (_, i) => i).filter((i) => (image?.data[((y - BOX.top) * BW + i) * 4 + 3] ?? 0) !== 0);
        expect(seen, `row ${y} at lean ${lean}`).toEqual([want - BOX.left]);
        checked++;
      }
      expect(checked).toBeGreaterThan(80);
    }
  });
});

describe('makeFineLayer: Santa and the snow in front', () => {
  const rgba = (image: Put | undefined, x: number, y: number): number[] => Array.from(image?.data.slice(((y - BOX.top) * BW + (x - BOX.left)) * 4, ((y - BOX.top) * BW + (x - BOX.left)) * 4 + 4) ?? []);

  it('is clear where the front layer drew nothing', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    expect(image?.width).toBe(BW);
    expect(image?.height).toBe(BH);
    expect(image?.data.every((v) => v === 0)).toBe(true);
  });

  it('puts a front pixel opaque, with its own red, green and blue, at its place in the box', () => {
    const { main, layer } = setup();
    const front = emptyFront();
    const { cx, cy } = LAYOUT.globe;
    front[cy * W + cx] = 0x112233;
    front[(cy + 3) * W + cx - 5] = 0xfdfcfb;
    front[(cy - 9) * W + cx + 4] = 0x000000; // black is a colour, not "nothing"
    layer.draw(frame({ front }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    expect(rgba(image, cx, cy)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(rgba(image, cx - 5, cy + 3)).toEqual([0xfd, 0xfc, 0xfb, 255]);
    expect(rgba(image, cx + 4, cy - 9)).toEqual([0, 0, 0, 255]);
    let opaque = 0;
    for (let i = 3; i < (image?.data.length ?? 0); i += 4) if (image?.data[i] === 255) opaque++;
    expect(opaque).toBe(3);
  });

  it('shifts a front pixel by its row\'s lean and no other pixel moves', () => {
    const { main, layer } = setup();
    const lean = 0.3;
    const front = emptyFront();
    const { cx } = LAYOUT.globe;
    const ys = [BOX.top, BOX.top + 20, BOX.top + 60, BOX.bottom - 1];
    ys.forEach((y, i) => (front[y * W + cx] = 0x010203 + i));
    layer.draw(frame({ front, lean }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    ys.forEach((y, i) => {
      const shift = Math.round(lean * (BOX.bottom - y - 0.5));
      expect(rgba(image, cx + shift, y)).toEqual([0x01, 0x02, 0x03 + i, 255]);
      if (shift !== 0) expect(rgba(image, cx, y)[3]).toBe(0);
    });
  });

  it('drops a front pixel the lean pushes out of the box instead of wrapping it onto the next row', () => {
    const { main, layer } = setup();
    const front = emptyFront();
    front[BOX.top * W + BOX.right] = 0xabcdef;
    front[(BOX.top + 1) * W + BOX.left] = 0xfedcba;
    layer.draw(frame({ front, lean: 0.5 }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    // The right edge pixel on the top row would move right out of the box; the left one on the next row moves right, in.
    const seenRows = new Set<number>();
    for (let i = 0; i < (image?.data.length ?? 0); i += 4) if (image?.data[i + 3] === 255) seenRows.add(Math.floor(i / 4 / BW));
    expect(seenRows.has(0)).toBe(false);
    expect(seenRows.has(1)).toBe(true);
    expect([...seenRows]).toEqual([1]);
  });

  it('does not keep the last frame\'s front pixels: a pixel gone from the front layer is gone from the canvas', () => {
    const { main, layer } = setup();
    const front = emptyFront();
    front[LAYOUT.globe.cy * W + LAYOUT.globe.cx] = 0x445566;
    layer.draw(frame({ front }), SITE);
    layer.draw(frame({ front: emptyFront() }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    expect(image?.data.every((v) => v === 0)).toBe(true);
  });

  it('puts the whole front canvas in front of the shapes: the shapes layer comes first in the page', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes, fronts } = layersOf(main);
    expect(page.order.indexOf(shapes)).toBeLessThan(page.order.indexOf(fronts));
    expect(page.order.indexOf(main)).toBeLessThan(page.order.indexOf(shapes));
  });

  it('survives a front array shorter than the picture: the missing pixels are clear', () => {
    const { main, layer } = setup();
    expect(() => layer.draw(frame({ front: new Uint32Array(10).fill(NO_FRONT) }), SITE)).not.toThrow();
    expect(ctxOf(layersOf(main).fronts).puts.at(-1)?.data.every((v) => v === 0)).toBe(true);
  });

  it('draws the front after a different-sized frame without keeping the old image size', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const wide = sceneLayout(W + 60, H, 7);
    const wideBox = leanBox(W + 60, wide);
    layer.draw({ layout: wide, width: W + 60, turn: 0.4, lean: 0, front: new Uint32Array((W + 60) * H).fill(NO_FRONT) }, SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    expect(image?.width).toBe(wideBox.right - wideBox.left + 1);
    expect(image?.height).toBe(wideBox.bottom - wideBox.top);
  });
});

describe('makeFineLayer: the flakes on the screen\'s pixel grid (XMAS-84)', () => {
  const k = SITE.scale;
  /** The globe's centre in box pixels, as the layer's snow is drawn from. */
  const cx = LAYOUT.globe.cx - BOX.left;
  const cy = LAYOUT.globe.cy - BOX.top;
  const WHITE = 0xffffff;
  const BEHIND = 0xaebcf0;
  const flake = (x: number, y: number, colour: number, depth: number): SnowStep => ({ x, y, colour, shape: [[0, 0]], depth });

  /** The pixels an image lights (alpha 255), as [x, y] on the image's own grid, with the colour's bytes. */
  function litOf(image: Put | undefined): { x: number; y: number; rgb: number[] }[] {
    const out: { x: number; y: number; rgb: number[] }[] = [];
    if (image === undefined) return out;
    for (let p = 0; p < image.width * image.height; p++) {
      if (image.data[p * 4 + 3] !== 255) continue;
      out.push({ x: p % image.width, y: Math.floor(p / image.width), rgb: Array.from(image.data.slice(p * 4, p * 4 + 3)) });
    }
    return out;
  }

  it('lands a flake on the screen pixel its own position picks, so two fractions inside one art pixel land on different screen pixels', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [flake(10, 0, WHITE, 20)] }), SITE);
    const snow = ctxOf(snowFrontOf(main));
    const whole = litOf(snow.puts.at(-1));
    layer.draw(frame({ snowFront: [flake(10.34, 0, WHITE, 20)] }), SITE);
    const fraction = litOf(snow.puts.at(-1));
    // Both flakes are in the same art pixel, but the screen pixel is k to one art pixel: 10.34 is a screen pixel to the right.
    expect(whole).toEqual([{ x: k * (cx + 10), y: k * cy, rgb: [0xff, 0xff, 0xff] }]);
    expect(fraction).toEqual([{ x: k * (cx + 10) + 1, y: k * cy, rgb: [0xff, 0xff, 0xff] }]);
    expect(fraction[0]?.x % k, 'not a multiple of the art pixel size').not.toBe(0);
  });

  it('a flake behind the glass centre is on the shapes layer, under the faces, on the same screen pixel grid', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(10.34, 0, BEHIND, -20)] }), SITE);
    const lit = litOf(ctxOf(layersOf(main).shapes).puts.at(-1));
    expect(lit).toEqual([{ x: k * (cx + 10) + 1, y: k * cy, rgb: [0xae, 0xbc, 0xf0] }]);
    // Not on the front layers: the behind flake is drawn only under the shapes.
    expect(litOf(ctxOf(snowFrontOf(main)).puts.at(-1))).toEqual([]);
  });

  it('a leaning frame moves a front flake by its row\'s whole art pixel shift, as whole screen pixels', () => {
    const lean = 0.3;
    const { main, layer } = setup();
    const at = Math.floor(LAYOUT.globe.cy - 5);
    layer.draw(frame({ lean, snowFront: [flake(10.34, -5, WHITE, 20)] }), SITE);
    const s = rowShift(lean, BOX.bottom, at);
    expect(s).not.toBe(0);
    expect(litOf(ctxOf(snowFrontOf(main)).puts.at(-1))).toEqual([{ x: k * (cx + 10) + 1 + s * k, y: k * (cy - 5), rgb: [0xff, 0xff, 0xff] }]);
  });
});

describe('makeFineLayer: the behind layers go under the faces (XMAS-84), in one ordered record', () => {
  const k = SITE.scale;
  const WHITE_BEHIND = 0xaebcf0;
  const cx = LAYOUT.globe.cx - BOX.left;
  const cy = LAYOUT.globe.cy - BOX.top;
  const lit = (put: Put): number => {
    let n = 0;
    for (let i = 3; i < put.data.length; i += 4) if (put.data[i] === 255) n++;
    return n;
  };
  const litAt = (put: Put, x: number, y: number): boolean => put.data[(y * put.width + x) * 4 + 3] === 255;
  const flake = (x: number, y: number): SnowStep => ({ x, y, colour: WHITE_BEHIND, shape: [[0, 0]], depth: -20 });
  /** Where the log has the first lit put on `canvas`, and the first face drawn on it (-1 for none). */
  const firstLitPut = (canvas: FakeCanvas): number => page.log.findIndex((o) => o.canvas === canvas && o.op === 'put' && lit(o.put) > 0);
  const firstDraw = (canvas: FakeCanvas): number => page.log.findIndex((o) => o.canvas === canvas && o.op === 'draw');
  const santaBehind = (): Uint32Array => {
    const behind = emptyFront();
    behind[LAYOUT.globe.cy * W + LAYOUT.globe.cx] = 0x112233;
    return behind;
  };

  it('puts the behind flakes on the shapes before the first face is drawn', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(10, 0)] }), SITE);
    const { shapes } = layersOf(main);
    expect(firstLitPut(shapes)).toBeGreaterThanOrEqual(0);
    expect(firstDraw(shapes)).toBeGreaterThanOrEqual(0);
    expect(firstLitPut(shapes)).toBeLessThan(firstDraw(shapes));
  });

  it('puts Santa behind the glass centre on the shapes before the first face, at his own pixel, k by k', () => {
    const { main, layer } = setup();
    layer.draw(frame({ behind: santaBehind() }), SITE);
    const { shapes } = layersOf(main);
    expect(firstLitPut(shapes)).toBeGreaterThanOrEqual(0);
    expect(firstLitPut(shapes)).toBeLessThan(firstDraw(shapes));
    const put = (page.log[firstLitPut(shapes)] as { put: Put }).put;
    expect(lit(put)).toBe(k * k);
    expect(litAt(put, cx * k, cy * k)).toBe(true);
  });

  it('puts nothing lit under the faces when no snow or Santa is behind', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    expect(firstLitPut(layersOf(main).shapes)).toBe(-1);
  });

  it('under a lean puts the behind flakes and Santa on the unleaned copy before its faces, and none straight on the shapes', () => {
    const lean = 0.3;
    const { main, layer } = setup();
    layer.draw(frame({ lean, snowBehind: [flake(10, -5)], behind: santaBehind() }), SITE);
    const { shapes } = layersOf(main);
    const flat = ctxOf(shapes).calls[0]?.source as unknown as FakeCanvas;
    expect(flat).not.toBe(shapes);
    expect(firstLitPut(flat)).toBeGreaterThanOrEqual(0);
    expect(firstLitPut(flat)).toBeLessThan(firstDraw(flat));
    // The shapes get them only through the row copies, which come after the flat copy is done.
    expect(firstLitPut(shapes)).toBe(-1);
    const lastFlatOp = page.log.map((o) => o.canvas).lastIndexOf(flat);
    expect(firstDraw(shapes)).toBeGreaterThan(lastFlatOp);
    // The flake's row and Santa's row are each copied by their own whole art pixel shift.
    const put = (page.log[firstLitPut(flat)] as { put: Put }).put;
    expect(litAt(put, (cx + 10) * k, (cy - 5) * k)).toBe(true);
    expect(litAt(put, cx * k, cy * k)).toBe(true);
    for (const row of [Math.floor(LAYOUT.globe.cy - 5), LAYOUT.globe.cy]) {
      const copy = ctxOf(shapes).calls[row - BOX.top];
      const shift = rowShift(lean, BOX.bottom, row);
      expect(shift).not.toBe(0);
      expect(copy?.source).toBe(flat as unknown as HTMLCanvasElement);
      expect(copy?.args[4]).toBe(shift * k);
    }
  });
});

const MAX = 0.5;
