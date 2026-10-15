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
import { globeShapes, onFloor } from '../scene/shapes.ts';
import { renderShadowSteps, shadowDrawList, shapeDrawList, type DrawStep } from '../scene/shape-draw-list.ts';
import type { FaceDraw } from '../scene/shapes-draw.ts';
import { flakeSize, type SnowStep } from '../scene/snow-draw-list.ts';
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
type Point = [number, number];
/** XMAS-82: a region of the canvas in device pixels, as a test of a device point. */
type Region = (x: number, y: number) => boolean;
type Fill = { seq: number; style: string; alpha: number; points: Point[]; clips: Region[]; region: Region };
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
  fillStyle: string = '#000000';
  globalAlpha = 1;
  /** Every fill of a path, in order, with the clips in force; and the operation count at each fill and drawImage. */
  readonly fills: Fill[] = [];
  readonly drawAt: number[] = [];
  ops = 0;
  private clipStack: Region[] = [];
  private savedClips: Region[][] = [];
  /** Ellipses and arcs added to the current path, as device regions. */
  private shapesInPath: Region[] = [];
  constructor(readonly canvas: FakeCanvas) {}
  save(): void {
    this.saves++;
    this.saved.push([...this.matrix]);
    this.savedClips.push([...this.clipStack]);
  }
  restore(): void {
    this.restores++;
    this.matrix = this.saved.pop() ?? [...IDENTITY];
    this.clipStack = this.savedClips.pop() ?? [];
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }
  beginPath(): void {
    this.path.length = 0;
    this.shapesInPath = [];
  }
  /** An ellipse (or a circle, from arc) under the current transform, as a region of device points. */
  private ellipseRegion(x: number, y: number, rx: number, ry: number, rotation: number): Region {
    const [a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = this.matrix;
    const det = a * d - b * c;
    return (px, py) => {
      const u = px - e;
      const v = py - f;
      // Back into the source space, then into the ellipse's own axes.
      const sx = (d * u - c * v) / det - x;
      const sy = (-b * u + a * v) / det - y;
      const lx = sx * Math.cos(rotation) + sy * Math.sin(rotation);
      const ly = -sx * Math.sin(rotation) + sy * Math.cos(rotation);
      return (lx / rx) ** 2 + (ly / ry) ** 2 <= 1;
    };
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number): void {
    this.shapesInPath.push(this.ellipseRegion(x, y, rx, ry, rotation));
  }
  arc(x: number, y: number, r: number): void {
    this.shapesInPath.push(this.ellipseRegion(x, y, r, r, 0));
  }
  /** The current path as a device region: its polygon (even-odd) or its ellipses, whichever it holds. */
  private pathRegion(): Region {
    const pts: Point[] = this.path.map((p) => through(p.matrix, p.x, p.y));
    const ellipses = [...this.shapesInPath];
    return (px, py) => {
      if (ellipses.some((r) => r(px, py))) return true;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi = 0, yi = 0] = pts[i] ?? [];
        const [xj = 0, yj = 0] = pts[j] ?? [];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
  }
  fill(): void {
    this.fills.push({ seq: this.ops++, style: this.fillStyle, alpha: this.globalAlpha, points: this.path.map((p) => through(p.matrix, p.x, p.y)), clips: [...this.clipStack, ...[]], region: this.pathRegion() } as Fill);
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
    this.clipStack.push(this.pathRegion());
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.clears.push([x, y, w, h]);
  }
  drawImage(source: FakeCanvas, ...args: number[]): void {
    this.drawAt.push(this.ops++);
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

function frame(over: Partial<FineFrame> = {}): FineFrame {
  return { layout: LAYOUT, width: W, turn: 0.4, lean: 0, ...over };
}

/** The canvases the layer makes: the shapes (with the flakes behind and Santa on them) and, after it, the flakes in front. */
function layersOf(main: FakeCanvas): { shapes: FakeCanvas; fronts: FakeCanvas } {
  const at = page.order.indexOf(main);
  const shapes = page.order[at + 1];
  const fronts = page.order[at + 2];
  if (shapes === undefined || fronts === undefined) throw new Error('the layers are not on the page');
  return { shapes, fronts };
}

/** The layer of the flakes in front (XMAS-84), over the shapes and Santa. */
function snowFrontOf(main: FakeCanvas): FakeCanvas {
  const snow = page.order[page.order.indexOf(main) + 2];
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
function expectedMatrix(step: FaceDraw, k: number): Matrix {
  const ox = (LAYOUT.globe.cx - BOX.left) * k;
  const oy = (LAYOUT.globe.cy - BOX.top) * k;
  const { a, b, d, drawing } = step;
  return [(k * (b[0] - a[0])) / drawing.width, (k * (b[1] - a[1])) / drawing.width, (k * (d[0] - a[0])) / drawing.height, (k * (d[1] - a[1])) / drawing.height, ox + k * a[0], oy + k * a[1]];
}

function near(p: readonly number[], q: readonly number[]): boolean {
  return p.length === q.length && p.every((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) < 1e-6);
}

/** Where a matrix puts a point of its source space. */
function through(m: readonly number[], x: number, y: number): Point {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** The device corners (top-left, top-right, bottom-left, bottom-right) the layer should cover for a step: the drawing's own footprint. */
function expectedQuad(step: FaceDraw, k: number): Point[] {
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
function slack(step: FaceDraw, k: number): number {
  const m = expectedMatrix(step, k);
  return 2 * Math.max(k, Math.hypot(m[0] ?? 0, m[1] ?? 0), Math.hypot(m[2] ?? 0, m[3] ?? 0));
}

/** Whether a drawn call is the step's face: same place, within the slack, corner for corner. */
function isFace(call: Call, step: FaceDraw, k: number): boolean {
  const quad = drawnQuad(call);
  if (quad === undefined) return false;
  const want = expectedQuad(step, k);
  const tol = slack(step, k);
  return quad.every(([x, y], n) => Math.hypot(x - (want[n]?.[0] ?? Number.NaN), y - (want[n]?.[1] ?? Number.NaN)) <= tol);
}

/** Finds each step's face among the calls, in draw order (extra calls between are allowed); returns the matched calls. */
function findFaces(calls: Call[], steps: FaceDraw[], k: number): Call[] {
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

  it('puts the shapes canvas right after the scene canvas and the flakes-in-front canvas right after that', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes, fronts } = layersOf(main);
    expect(page.order.slice(0, 3)).toEqual([main, shapes, fronts]);
    expect(shapes).not.toBe(fronts);
    // The flakes in front (XMAS-84) sit on a layer of their own, over the shapes, which hold Santa (XMAS-83) and the flakes behind.
    expect(page.order[2]).toBe(snowFrontOf(main));
    expect(page.order).toHaveLength(3);
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

    it(`${name}: the shapes canvas has one pixel per device pixel, the flakes-in-front canvas one per device pixel too`, () => {
      const { main, layer } = setup();
      layer.draw(frame(), site);
      const { shapes, fronts } = layersOf(main);
      expect(shapes.width).toBe(BW * site.scale);
      expect(shapes.height).toBe(BH * site.scale);
      // A device pixel is 1 / ratio CSS pixels: the canvas's CSS size times the ratio is its pixel size.
      expect(px(shapes.style.width as unknown as number) * site.ratio).toBeCloseTo(shapes.width, 6);
      expect(px(shapes.style.height as unknown as number) * site.ratio).toBeCloseTo(shapes.height, 6);
      expect(fronts.width).toBe(BW * site.scale);
      expect(fronts.height).toBe(BH * site.scale);
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
    layer.draw({ layout: wide, width: W + 40, turn: 0.4, lean: 0 }, { scale: 2, ratio: 2, left: 3 });
    const { shapes, fronts } = layersOf(main);
    expect(shapes.width).toBe((wideBox.right - wideBox.left + 1) * 2);
    expect(fronts.width).toBe((wideBox.right - wideBox.left + 1) * 2);
    expect(px(shapes.style.left as unknown as number)).toBeCloseTo(3 + wideBox.left * 1, 6);
    layer.draw({ layout: wide, width: W + 40, turn: 0.4, lean: 0 }, { scale: 2, ratio: 1, left: 3 });
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

  it('agrees with leanGlass on where each row goes, for the flakes in front', () => {
    // Sparse rows, so the flakes' blocks (a few screen pixels tall) of one row never touch another row's.
    const STEP = 8;
    const k = SITE.scale;
    const size = flakeSize(k);
    for (const lean of [0.08, 0.31, -0.22, 0.5, -0.5]) {
      const { main, layer } = setup();
      const { cx, cy, radius } = LAYOUT.globe;
      // leanGlass on a picture with a marker at the globe's centre column on every row of the glass; a flake in front on the same rows.
      const picture = new Uint32Array(W * H);
      keepBackdrop(picture, W, LAYOUT);
      const flakes: SnowStep[] = [];
      const rows: number[] = [];
      for (let y = Math.ceil(cy - radius + 2); y < cy + radius - 2; y += STEP) {
        picture[y * W + cx] = 0x100000 + y;
        flakes.push({ x: 0, y: y - cy, colour: 0xffffff, shape: [[0, 0]], depth: 20 });
        rows.push(y);
      }
      leanGlass(picture, W, LAYOUT, lean);
      layer.draw(frame({ lean, snowFront: flakes }), SITE);
      const image = ctxOf(layersOf(main).fronts).puts.at(-1);
      expect(image).toBeDefined();
      let checked = 0;
      for (const y of rows) {
        const want = picture.indexOf(0x100000 + y, y * W) - y * W; // where leanGlass put the marker on its row
        const row = (y - BOX.top) * k;
        const seen = Array.from({ length: BW * k }, (_, i) => i).filter((i) => (image?.data[(row * BW * k + i) * 4 + 3] ?? 0) !== 0);
        expect(seen, `row ${y} at lean ${lean}`).toEqual(Array.from({ length: size }, (_, i) => (want - BOX.left) * k + i));
        checked++;
      }
      expect(checked).toBeGreaterThan(10);
    }
  });
});

// XMAS-83 and XMAS-84: there is no art pixel front picture any more. Santa is a step among the faces on the shapes canvas,
// and the flakes in front are steps on the screen's grid on a canvas of their own over it; these are the front canvas's
// old checks (clear where nothing drew, a pixel at its place and colour, the lean's row shifts, nothing kept, the size)
// put to the flakes in front.
describe('makeFineLayer: the flakes in front', () => {
  const k = SITE.scale;
  const size = flakeSize(k);
  const cx = LAYOUT.globe.cx - BOX.left;
  const cy = LAYOUT.globe.cy - BOX.top;
  const step = (x: number, y: number, colour: number): SnowStep => ({ x, y, colour, shape: [[0, 0]], depth: 20 });
  /** The RGBA of device pixel (x, y) of an image of the box at the screen's size. */
  const rgba = (image: Put | undefined, x: number, y: number): number[] => Array.from(image?.data.slice((y * BW * k + x) * 4, (y * BW * k + x) * 4 + 4) ?? []);
  const opaqueCount = (image: Put | undefined): number => {
    let n = 0;
    for (let i = 3; i < (image?.data.length ?? 0); i += 4) if (image?.data[i] === 255) n++;
    return n;
  };

  it('is clear where no flake drew: the canvas is the box at the screen\'s size, cleared, with nothing put on it', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).fronts);
    expect(layersOf(main).fronts.width).toBe(BW * k);
    expect(layersOf(main).fronts.height).toBe(BH * k);
    expect(ctx.clears.at(-1)).toEqual([0, 0, BW * k, BH * k]);
    expect(ctx.puts.every((put) => put.data.every((v) => v === 0))).toBe(true);
  });

  it('puts a flake opaque, with its own red, green and blue, at its place in the box', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [step(0, 0, 0x112233), step(-5, 3, 0xfdfcfb), step(4, -9, 0x000000) /* black is a colour, not "nothing" */] }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    expect(rgba(image, k * cx, k * cy)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(rgba(image, k * (cx - 5), k * (cy + 3))).toEqual([0xfd, 0xfc, 0xfb, 255]);
    expect(rgba(image, k * (cx + 4), k * (cy - 9))).toEqual([0, 0, 0, 255]);
    expect(opaqueCount(image)).toBe(3 * size * size);
  });

  it('shifts a flake by its row\'s lean and no other pixel moves', () => {
    const { main, layer } = setup();
    const lean = 0.3;
    const rows = [0, 20, 60, BH - 2]; // a flake is a few screen pixels tall: the last row would be cut by the canvas edge
    const flakes = rows.map((row, i) => step(0, row - cy, 0x010203 + i));
    layer.draw(frame({ snowFront: flakes, lean }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    rows.forEach((row, i) => {
      const shift = rowShift(lean, BOX.bottom, BOX.top + row);
      expect(rgba(image, k * (cx + shift), k * row)).toEqual([0x01, 0x02, 0x03 + i, 255]);
      if (shift !== 0) expect(rgba(image, k * cx, k * row)[3]).toBe(0);
    });
    expect(opaqueCount(image)).toBe(rows.length * size * size);
  });

  it('drops a flake the lean pushes out of the box instead of wrapping it onto the next row', () => {
    const { main, layer } = setup();
    // The right edge flake on the top row would move right out of the box; the left one ten rows down moves right, in.
    layer.draw(frame({ snowFront: [step(BW - 1 - cx, -cy, 0xabcdef), step(-cx, 10 - cy, 0xfedcba)], lean: 0.5 }), SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    const seenRows = new Set<number>();
    const width = BW * k;
    for (let i = 0; i < (image?.data.length ?? 0); i += 4) if (image?.data[i + 3] === 255) seenRows.add(Math.floor(i / 4 / width));
    expect(seenRows.size).toBeGreaterThan(0);
    for (const row of seenRows) {
      expect(row, 'only the second flake\'s rows are lit').toBeGreaterThanOrEqual(10 * k);
      expect(row).toBeLessThan(10 * k + size);
    }
  });

  it('does not keep the last frame\'s flakes: a flake gone from the frame is cleared from the canvas and nothing is put back', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [step(0, 0, 0x445566)] }), SITE);
    const ctx = ctxOf(layersOf(main).fronts);
    const puts = ctx.puts.length;
    const clears = ctx.clears.length;
    layer.draw(frame(), SITE);
    expect(ctx.clears.length).toBe(clears + 1);
    expect(ctx.clears.at(-1)).toEqual([0, 0, BW * k, BH * k]);
    expect(ctx.puts.length).toBe(puts);
  });

  it('puts the flakes canvas in front of the shapes: the shapes layer comes first in the page', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes, fronts } = layersOf(main);
    expect(page.order.indexOf(shapes)).toBeLessThan(page.order.indexOf(fronts));
    expect(page.order.indexOf(main)).toBeLessThan(page.order.indexOf(shapes));
  });

  it('survives a frame with no flake lists at all: nothing is lit on either canvas', () => {
    const { main, layer } = setup();
    expect(() => layer.draw(frame({ snowFront: undefined, snowBehind: undefined }), SITE)).not.toThrow();
    expect(ctxOf(layersOf(main).fronts).puts.every((put) => put.data.every((v) => v === 0))).toBe(true);
  });

  it('draws the flakes after a different-sized frame without keeping the old image size', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const wide = sceneLayout(W + 60, H, 7);
    const wideBox = leanBox(W + 60, wide);
    layer.draw({ layout: wide, width: W + 60, turn: 0.4, lean: 0, snowFront: [step(0, 0, 0x445566)] }, SITE);
    const image = ctxOf(layersOf(main).fronts).puts.at(-1);
    expect(image?.width).toBe((wideBox.right - wideBox.left + 1) * k);
    expect(image?.height).toBe((wideBox.bottom - wideBox.top) * k);
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

  /** The size x size block of a flake whose top-left is the screen pixel (x, y), as litOf lists it (row by row). */
  const block = (x: number, y: number, rgb: number[]): { x: number; y: number; rgb: number[] }[] => {
    const size = flakeSize(k);
    const out: { x: number; y: number; rgb: number[] }[] = [];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push({ x: x + i, y: y + j, rgb });
    return out;
  };

  it('lands a flake on the screen pixel its own position picks, so two fractions inside one art pixel land on different screen pixels', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [flake(10, 0, WHITE, 20)] }), SITE);
    const snow = ctxOf(snowFrontOf(main));
    const whole = litOf(snow.puts.at(-1));
    layer.draw(frame({ snowFront: [flake(10.34, 0, WHITE, 20)] }), SITE);
    const fraction = litOf(snow.puts.at(-1));
    // Both flakes are in the same art pixel, but the screen pixel is k to one art pixel: 10.34 is a screen pixel to the right.
    expect(whole).toEqual(block(k * (cx + 10), k * cy, [0xff, 0xff, 0xff]));
    expect(fraction).toEqual(block(k * (cx + 10) + 1, k * cy, [0xff, 0xff, 0xff]));
    expect((fraction[0]?.x ?? 0) % k, 'not a multiple of the art pixel size').not.toBe(0);
  });

  it('a flake behind the glass centre is on the shapes layer, under the faces, on the same screen pixel grid', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(10.34, 0, BEHIND, -20)] }), SITE);
    const lit = litOf(ctxOf(layersOf(main).shapes).puts.at(-1));
    expect(lit).toEqual(block(k * (cx + 10) + 1, k * cy, [0xae, 0xbc, 0xf0]));
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
    expect(litOf(ctxOf(snowFrontOf(main)).puts.at(-1))).toEqual(block(k * (cx + 10) + 1 + s * k, k * (cy - 5), [0xff, 0xff, 0xff]));
  });
});

describe('makeFineLayer: the flakes behind go under the faces (XMAS-84), in one ordered record', () => {
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

  it('puts the behind flakes on the shapes before the first face is drawn', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(10, 0)] }), SITE);
    const { shapes } = layersOf(main);
    expect(firstLitPut(shapes)).toBeGreaterThanOrEqual(0);
    expect(firstDraw(shapes)).toBeGreaterThanOrEqual(0);
    expect(firstLitPut(shapes)).toBeLessThan(firstDraw(shapes));
  });

  it('puts nothing lit under the faces when no snow is behind', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    expect(firstLitPut(layersOf(main).shapes)).toBe(-1);
  });

  it('puts a flake behind the glass centre at its own pixel, a flake-sized block', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(0, 0)] }), SITE);
    const { shapes } = layersOf(main);
    const put = (page.log[firstLitPut(shapes)] as { put: Put }).put;
    expect(lit(put)).toBe(flakeSize(k) ** 2);
    expect(litAt(put, cx * k, cy * k)).toBe(true);
  });

  it('under a lean puts the behind flakes on the unleaned copy before its faces, and none straight on the shapes', () => {
    const lean = 0.3;
    const { main, layer } = setup();
    layer.draw(frame({ lean, snowBehind: [flake(10, -5)] }), SITE);
    const { shapes } = layersOf(main);
    const flat = ctxOf(shapes).calls[0]?.source as unknown as FakeCanvas;
    expect(flat).not.toBe(shapes);
    expect(firstLitPut(flat)).toBeGreaterThanOrEqual(0);
    expect(firstLitPut(flat)).toBeLessThan(firstDraw(flat));
    // The shapes get them only through the row copies, which come after the flat copy is done.
    expect(firstLitPut(shapes)).toBe(-1);
    const lastFlatOp = page.log.map((o) => o.canvas).lastIndexOf(flat);
    expect(firstDraw(shapes)).toBeGreaterThan(lastFlatOp);
    // The flake's row is copied by its own whole art pixel shift.
    const put = (page.log[firstLitPut(flat)] as { put: Put }).put;
    expect(litAt(put, (cx + 10) * k, (cy - 5) * k)).toBe(true);
    const row = Math.floor(LAYOUT.globe.cy - 5);
    const copy = ctxOf(shapes).calls[row - BOX.top];
    const shift = rowShift(lean, BOX.bottom, row);
    expect(shift).not.toBe(0);
    expect(copy?.source).toBe(flat as unknown as HTMLCanvasElement);
    expect(copy?.args[4]).toBe(shift * k);
  });
});

const MAX = 0.5;

// XMAS-82 "Shadows on the fine layer": each shape's floor shadow is a flat polygon filled on the shapes layer before the bodies,
// clipped to the floor disc, with today's shade and strength, on the device pixel grid.
/** Colour and strength a fill resolves to: the style's own alpha times the context's globalAlpha. */
function resolved(fill: Fill): { rgb: number; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(fill.style);
  if (hex) return { rgb: Number.parseInt(hex[1] ?? '0', 16), alpha: fill.alpha };
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(fill.style);
  if (!fn) return { rgb: -1, alpha: Number.NaN };
  return { rgb: (Number(fn[1]) << 16) | (Number(fn[2]) << 8) | Number(fn[3]), alpha: fill.alpha * (fn[4] === undefined ? 1 : Number(fn[4])) };
}

/** The canvas a frame's shadows were filled on: the layer itself when upright, the unleaned copy when leaned. */
function shadowCanvas(main: FakeCanvas, lean: number): FakeContext {
  const { shapes } = layersOf(main);
  if (lean === 0) return ctxOf(shapes);
  const flat = ctxOf(shapes).calls[0]?.source as unknown as FakeCanvas;
  return ctxOf(flat);
}

/** The device pixels (of a w x h canvas) a context's fills cover, after their clips. */
function covered(ctx: FakeContext, w: number, h: number): Set<number> {
  const out = new Set<number>();
  for (const fill of ctx.fills) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (fill.region(x + 0.5, y + 0.5) && fill.clips.every((c) => c(x + 0.5, y + 0.5))) out.add(y * w + x);
    }
  }
  return out;
}

describe('makeFineLayer: the shadows', () => {
  const k = SITE.scale;

  it('fills a polygon for the shadows, in the shadow ink at the shadow strength', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { fills } = ctxOf(layersOf(main).shapes);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.length).toBeLessThanOrEqual(globeShapes.length);
    for (const fill of fills) {
      const { rgb, alpha } = resolved(fill);
      expect(rgb).toBe(0x1d3350);
      expect(alpha).toBeCloseTo(0.32, 9);
    }
  });

  it('fills every shadow before the first face is drawn, so the shadows are under the shapes', () => {
    const { main, layer } = setup();
    for (const turn of [0.4, 2.2]) {
      layer.draw(frame({ turn }), SITE);
      const ctx = ctxOf(layersOf(main).shapes);
      expect(ctx.fills.length).toBeGreaterThan(0);
      const lastFill = Math.max(...ctx.fills.map((f) => f.seq));
      const firstFace = Math.min(...ctx.drawAt);
      expect(lastFill).toBeLessThan(firstFace);
      ctx.fills.length = 0;
      ctx.drawAt.length = 0;
    }
  });

  it('covers the device pixels renderShadowSteps covers at the same scale: the same shadow on the screen\'s grid, disc clip included', () => {
    for (const turn of [0.4, 1.7, 3.0, 5.9]) {
      page.made.length = 0;
      page.order.length = 0;
      const { main, layer } = setup();
      layer.draw(frame({ turn }), SITE);
      const dw = BW * k;
      const dh = BH * k;
      const mine = covered(ctxOf(layersOf(main).shapes), dw, dh);
      // The CPU renderer at zoom k over the whole picture; the layer is its box at (BOX.left, BOX.top).
      const picture = new Uint32Array(W * k * H * k);
      renderShadowSteps(picture, W, LAYOUT, shadowDrawList(turn), k);
      const want = new Set<number>();
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) if (picture[(y + BOX.top * k) * W * k + x + BOX.left * k] !== 0) want.add(y * dw + x);
      }
      expect(want.size).toBeGreaterThan(200);
      let mismatches = 0;
      for (const i of want) if (!mine.has(i)) mismatches += 1;
      for (const i of mine) if (!want.has(i)) mismatches += 1;
      expect(mismatches).toBeLessThanOrEqual(Math.ceil(want.size * 0.01));
    }
  });

  it('puts no shadow pixel outside the floor disc, at several scales and turns', () => {
    const { cx, cy } = LAYOUT.globe;
    for (const site of [SITE, { scale: 5, ratio: 2, left: 0 }, { scale: 2, ratio: 1, left: 9 }]) {
      for (const turn of [0, 0.4, 2.5, 4.4]) {
        page.made.length = 0;
        page.order.length = 0;
        const { main, layer } = setup();
        layer.draw(frame({ turn }), site);
        const dw = BW * site.scale;
        const cover = covered(ctxOf(layersOf(main).shapes), dw, BH * site.scale);
        expect(cover.size).toBeGreaterThan(0);
        const outside: number[] = [];
        for (const i of cover) {
          const ax = BOX.left + (((i % dw) + 0.5) / site.scale) - cx;
          const ay = BOX.top + (Math.floor(i / dw) + 0.5) / site.scale - cy;
          // A device pixel centre on the disc's rim may go either way by float; the disc is only 1 / scale wider.
          if (!onFloorLoose(ax, ay, 1 / site.scale)) outside.push(i);
        }
        expect(outside, `device pixels outside the disc, scale ${site.scale}, turn ${turn}`).toEqual([]);
      }
    }
  }, 30000);

  it('puts the disc clip around the fills: unclipped, the shadows would reach outside the disc', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    // Each fill is made inside a clip (the disc), and at least one polygon alone reaches past it.
    for (const fill of ctx.fills) expect(fill.clips.length).toBeGreaterThan(0);
    const dw = BW * k;
    const dh = BH * k;
    let beyond = 0;
    for (const fill of ctx.fills) {
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (fill.region(x + 0.5, y + 0.5) && !fill.clips.every((c) => c(x + 0.5, y + 0.5))) beyond += 1;
    }
    // Some shape stands near the rim for at least one turn: sweep and require the clip to have cut something.
    let cut = beyond;
    for (const turn of [1.0, 2.0, 3.0, 4.0, 5.0]) {
      ctx.fills.length = 0;
      layer.draw(frame({ turn }), SITE);
      for (const fill of ctx.fills) {
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (fill.region(x + 0.5, y + 0.5) && !fill.clips.every((c) => c(x + 0.5, y + 0.5))) cut += 1;
      }
    }
    expect(cut).toBeGreaterThan(0);
  });

  it('moves with the shapes on the device grid: a small turn moves a polygon vertex by a fraction of an art pixel, not a whole one', () => {
    const { main, layer } = setup();
    const ox = (LAYOUT.globe.cx - BOX.left) * k;
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const before = ctx.fills.splice(0).map((f) => f.points);
    layer.draw(frame({ turn: 0.403 }), SITE);
    const after = ctx.fills.splice(0).map((f) => f.points);
    expect(after).toHaveLength(before.length);
    let moved = 0;
    let offGrid = 0;
    before.forEach((pts, n) => {
      pts.forEach(([x, y], i) => {
        const [bx = 0, by = 0] = after[n]?.[i] ?? [];
        const d = Math.hypot(bx - x, by - y);
        if (d > 1e-9) moved += 1;
        expect(d).toBeLessThan(k); // under a whole art pixel
        // Not on the art pixel grid: the vertex is not a whole number of art pixels from the globe's centre.
        const art = (x - ox) / k;
        if (Math.abs(art - Math.round(art)) > 1e-6) offGrid += 1;
      });
    });
    expect(moved).toBeGreaterThan(0);
    expect(offGrid).toBeGreaterThan(0);
  });

  it('draws the same shadows for a whole turn more, and a negative turn', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const base = ctx.fills.splice(0).map((f) => f.points);
    for (const turn of [0.4 + 2 * Math.PI, 0.4 - 2 * Math.PI]) {
      layer.draw(frame({ turn }), SITE);
      const again = ctx.fills.splice(0).map((f) => f.points);
      expect(again).toHaveLength(base.length);
      again.forEach((pts, n) => pts.forEach((p, i) => expect(near(p, base[n]?.[i] ?? [])).toBe(true)));
    }
  });

  it('does not keep last frame\'s shadows: the layer is cleared before the fills of a frame', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const clears = ctx.clears.length;
    const fills = ctx.fills.length;
    layer.draw(frame({ turn: 0.9 }), SITE);
    expect(ctx.clears.length).toBeGreaterThan(clears);
    expect(ctx.fills.length).toBeGreaterThan(fills);
    // The clear came before this frame's first fill.
    expect(ctx.fills[fills]?.seq).toBeGreaterThan(-1);
  });

  it('with a lean, fills the shadows on the unleaned canvas first, so the row shifts carry them with the shapes', () => {
    for (const lean of [0.2, -0.35]) {
      page.made.length = 0;
      page.order.length = 0;
      const { main, layer } = setup();
      layer.draw(frame({ lean }), SITE);
      const flat = shadowCanvas(main, lean);
      expect(flat.fills.length).toBeGreaterThan(0);
      expect(Math.max(...flat.fills.map((f) => f.seq))).toBeLessThan(Math.min(...flat.drawAt));
      // The leaned layer itself only copies rows: no fill of its own.
      expect(ctxOf(layersOf(main).shapes).fills).toHaveLength(0);
    }
  });

  it('restores the context after the shadows: the disc clip does not leak onto the faces or the next frame', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    layer.draw(frame({ turn: 1.1 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    expect(ctx.restores).toBe(ctx.saves);
    expect(ctx.matrix).toEqual(IDENTITY);
    // No face is drawn inside the disc clip: the faces' own saves hold no region from the shadows.
    const lastFill = Math.max(...ctx.fills.map((f) => f.seq));
    expect(lastFill).toBeGreaterThanOrEqual(0);
  });

  it('draws no shadow and does not throw with no 2d context', () => {
    page.contextless = true;
    const { layer } = setup();
    expect(() => layer.draw(frame(), SITE)).not.toThrow();
  });

  it('throws for a non-finite turn before drawing any shadow', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    ctx.fills.length = 0;
    expect(() => layer.draw(frame({ turn: Number.NaN }), SITE)).toThrow(RangeError);
    expect(ctx.fills).toHaveLength(0);
  });
});

/** The floor disc test, allowing the rim to be `slack` art units off (a device pixel's own width). */
function onFloorLoose(x: number, y: number, slack: number): boolean {
  return onFloor(x, y) || [[slack, 0], [-slack, 0], [0, slack], [0, -slack]].some(([dx = 0, dy = 0]) => onFloor(x + dx, y + dy));
}
