// XMAS-81 "Fine layer on the page: the shapes": the shapes drawn on the screen's
// pixel grid over the scene canvas. A fake page (a document whose canvases and
// 2d contexts record what is done to them) stands in for the browser: each
// canvas keeps its size, its style writes and every drawing call with the
// transform and smoothing in force at the call. The real draw list, lean box
// and row shifts are used, so the layer is checked against the same numbers
// the scene canvas's glass uses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { leanBox } from '../scene/lean.ts';
import { BASE_ROWS, BASE_WIDTH, renderBase } from '../scene/base-fine.ts';
import { sceneLayout } from '../scene/frame.ts';
import { BASE_SINK, NO_FRONT } from '../scene/globe.ts';
import { globeShapes, onFloor } from '../scene/shapes.ts';
import { renderShadowSteps, shadowDrawList, shapeDrawList } from '../scene/shape-draw-list.ts';
import type { FaceDraw } from '../scene/shapes-draw.ts';
import { flakeSize, type SnowStep } from '../scene/snow-draw-list.ts';
import type { GlassLayer } from '../scene/glass-layer.ts';
import type { FineTrace } from './frame-trace.ts';
import { makeFineLayer, type FineFrame, type FineSite } from './fine-layer.ts';
import { IDENTITY, through, type Matrix, type Point } from '../../tests/helpers/matrix.ts';

const W = 240;
const H = 180;
const LAYOUT = sceneLayout(W, H, 7);
const BOX = leanBox(W, LAYOUT);
const BW = BOX.right - BOX.left + 1;
const BH = BOX.bottom - BOX.top;
const SITE: FineSite = { scale: 3, ratio: 1.5, left: 7 };
const FRACTIONAL: FineSite = { scale: 5, ratio: 1.25, left: 12.8 };
const NARROW: FineSite = { scale: 3, ratio: 1.5, left: -41.333333333333336 };

type Call = { source: HTMLCanvasElement; args: number[]; matrix: Matrix; smoothing: boolean; clips: Region[] };
/** XMAS-82: a region of the canvas in device pixels, as a test of a device point. */
type Region = (x: number, y: number) => boolean;
type Fill = { seq: number; style: string; alpha: number; points: Point[]; clips: Region[]; region: Region };
type Put = { data: Uint8ClampedArray; width: number; height: number; dirty?: number[] };
/** A fillRect with the fill style in force at the call. */
type Rect = { x: number; y: number; w: number; h: number; style: string };

class FakeStyle {
  writes = 0;
  cssText = '';
  private values = new Map<string, string>();
  private get(key: string): string { return this.values.get(key) ?? ''; }
  private set(key: string, value: string): void { this.writes++; this.values.set(key, value); }
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
  /** The operation count at each clearRect: what came before it is gone. */
  readonly clearAt: number[] = [];
  /** Every fillRect, in order; and `lit`, those since the last clearRect: what the canvas holds now. */
  readonly rects: Rect[] = [];
  lit: Rect[] = [];
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
  save(): void { this.saves++; this.saved.push([...this.matrix]); this.savedClips.push([...this.clipStack]); }
  restore(): void { this.restores++; this.matrix = this.saved.pop() ?? [...IDENTITY]; this.clipStack = this.savedClips.pop() ?? []; }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.matrix = [a, b, c, d, e, f]; }
  /** The current transform times the given one, as a canvas does (a shear may be put in a draw transform this way). */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [m0 = 1, m1 = 0, m2 = 0, m3 = 1, m4 = 0, m5 = 0] = this.matrix;
    this.matrix = [m0 * a + m2 * b, m1 * a + m3 * b, m0 * c + m2 * d, m1 * c + m3 * d, m0 * e + m2 * f + m4, m1 * e + m3 * f + m5];
  }
  beginPath(): void { this.path.length = 0; this.shapesInPath = []; }
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
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number): void { this.shapesInPath.push(this.ellipseRegion(x, y, rx, ry, rotation)); }
  arc(x: number, y: number, r: number): void { this.shapesInPath.push(this.ellipseRegion(x, y, r, r, 0)); }
  /**
   * The current path as a device region: its rings, each subpath from a moveTo, filled by nonzero winding as a
   * canvas fills them, or its ellipses, whichever it holds. Rings that overlap add up, so a pixel under two is inside once.
   */
  private pathRegion(): Region {
    const rings: Point[][] = [];
    for (const p of this.path) {
      const point = through(p.matrix, p.x, p.y);
      if (p.move || rings.length === 0) rings.push([point]);
      else rings[rings.length - 1]?.push(point);
    }
    const ellipses = [...this.shapesInPath];
    return (px, py) => {
      if (ellipses.some((r) => r(px, py))) return true;
      return rings.reduce((winding, ring) => winding + windingOf(ring, px, py), 0) !== 0;
    };
  }
  fill(): void {
    this.fills.push({ seq: this.ops++, style: this.fillStyle, alpha: this.globalAlpha, points: this.path.map((p) => through(p.matrix, p.x, p.y)), clips: [...this.clipStack, ...[]], region: this.pathRegion() } as Fill);
  }
  moveTo(x: number, y: number): void { this.path.push({ x, y, matrix: [...this.matrix], move: true }); }
  lineTo(x: number, y: number): void { this.path.push({ x, y, matrix: [...this.matrix], move: false }); }
  closePath(): void {}
  clip(): void { this.clips.push(this.path.map(({ x, y }) => ({ x, y }))); this.clipStack.push(this.pathRegion()); }
  clearRect(x: number, y: number, w: number, h: number): void { this.clears.push([x, y, w, h]); this.clearAt.push(this.ops); this.lit = []; }
  fillRect(x: number, y: number, w: number, h: number): void {
    const rect = { x, y, w, h, style: this.fillStyle };
    this.rects.push(rect);
    this.lit.push(rect);
  }
  drawImage(source: FakeCanvas, ...args: number[]): void {
    this.drawAt.push(this.ops++);
    this.calls.push({ source: source as unknown as HTMLCanvasElement, args, matrix: [...this.matrix], smoothing: this.imageSmoothingEnabled, clips: [...this.clipStack] });
  }
  createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } { return { data: new Uint8ClampedArray(width * height * 4), width, height }; }
  putImageData(image: Put, _dx?: number, _dy?: number, ...dirty: number[]): void {
    const put = { data: Uint8ClampedArray.from(image.data), width: image.width, height: image.height, dirty };
    this.puts.push(put);
    this.canvas.page.puts.push(put);
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

class FakeDocument {
  /** Every putImageData on every canvas, in order. */
  readonly puts: Put[] = [];
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

/** The canvases the layer makes, with no glass: the flakes behind (XMAS-89), the shapes (shadows, faces and Santa) over them, and the flakes in front. */
function layersOf(main: FakeCanvas): { behind: FakeCanvas; shapes: FakeCanvas; fronts: FakeCanvas } {
  const at = page.order.indexOf(main);
  const behind = page.order[at + 1];
  const shapes = page.order[at + 2];
  const fronts = page.order[at + 3];
  if (behind === undefined || shapes === undefined || fronts === undefined) throw new Error('the layers are not on the page');
  return { behind, shapes, fronts };
}

/** XMAS-68: the base's canvas, the last of the layers. */
function baseOf(main: FakeCanvas): FakeCanvas {
  const base = page.order[page.order.indexOf(main) + 4];
  if (base === undefined) throw new Error('the base layer is not on the page');
  return base;
}

/** A fresh layer on a fresh page order (the fake document itself is kept). */
function fresh(): ReturnType<typeof setup> {
  page.made.length = 0;
  page.order.length = 0;
  return setup();
}

function ctxOf(canvas: FakeCanvas): FakeContext {
  const c = canvas.getContext();
  if (c === null) throw new Error('no context');
  return c;
}

/** The '#rrggbb' a flake's colour is drawn in. */
function hex(colour: number): string { return `#${colour.toString(16).padStart(6, '0')}`; }

/** The device pixels ("x,y", sorted, once each) that rects cover. */
function keysOf(rects: readonly Rect[]): string[] {
  const out = new Set<string>();
  for (const r of rects) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) out.add(`${r.x + i},${r.y + j}`);
  return [...out].sort();
}

function px(value: string): number { return Number.parseFloat(value); }

/** The matrix and clip the layer should use for a step, worked out from the step alone. */
function expectedMatrix(step: FaceDraw, k: number): Matrix {
  const ox = (LAYOUT.globe.cx - BOX.left) * k;
  const oy = (LAYOUT.globe.cy - BOX.top) * k;
  const { a, b, d, drawing } = step;
  return [(k * (b[0] - a[0])) / drawing.width, (k * (b[1] - a[1])) / drawing.width, (k * (d[0] - a[0])) / drawing.height, (k * (d[1] - a[1])) / drawing.height, ox + k * a[0], oy + k * a[1]];
}

function near(p: readonly number[], q: readonly number[]): boolean { return p.length === q.length && p.every((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) < 1e-6); }

/** The winding number of the closed ring `pts` about (px, py): an edge crossing the point's row counts +1 if it goes up with the point on its left, -1 if down with the point on its right. */
function windingOf(pts: readonly Point[], px: number, py: number): number {
  let winding = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax = 0, ay = 0] = pts[i] ?? [];
    const [bx = 0, by = 0] = pts[(i + 1) % pts.length] ?? [];
    const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py && by > py && side > 0) winding += 1;
    else if (by <= py && ay > py && side < 0) winding -= 1;
  }
  return winding;
}

/** The device corners (top-left, top-right, bottom-left, bottom-right) the layer should cover for a step: the drawing's own footprint. */
function expectedQuad(step: FaceDraw, k: number): Point[] {
  const m = expectedMatrix(step, k);
  const { width: w, height: h } = step.drawing;
  return [through(m, 0, 0), through(m, w, 0), through(m, 0, h), through(m, w, h)];
}

/** The device corners a recorded drawImage covers: its whole source (padding included), through its destination args and transform. */
function drawnQuad(call: Call): Point[] | undefined {
  const a = call.args;
  // drawImage(img, dx, dy), (img, dx, dy, dw, dh) and (img, sx, sy, sw, sh, dx, dy, dw, dh): the destination is the last two or four numbers.
  const [dx, dy, dw, dh] = a.length === 2 ? [a[0], a[1], undefined, undefined] : a.length === 4 ? a : a.length === 8 ? a.slice(4) : [undefined, undefined, undefined, undefined];
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

  it('puts the flakes-behind canvas (XMAS-89, under the shapes) right after the scene canvas, then the shapes, the flakes in front and the base last, once: a second draw adds none', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { behind, shapes, fronts } = layersOf(main);
    expect(page.order).toEqual([main, behind, shapes, fronts, baseOf(main)]);
    expect(new Set([behind, shapes, fronts]).size).toBe(3);
    const first = [...page.order];
    layer.draw(frame({ turn: 1.9 }), SITE);
    expect(page.order).toEqual(first);
  });

  it('lays the layers fixed, never taking the pointer, and not smoothed when scaled', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { behind, shapes, fronts } = layersOf(main);
    for (const canvas of [behind, shapes, fronts]) {
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
    ['a fractional ratio', FRACTIONAL],
    ['a narrow window: the picture overhangs, left negative', NARROW],
  ];

  for (const [name, site] of SITES) {
    it(`${name}: all three layers sit on the lean box in CSS pixels, one canvas pixel per device pixel`, () => {
      const { main, layer } = setup();
      layer.draw(frame(), site);
      const css = site.scale / site.ratio;
      for (const canvas of Object.values(layersOf(main))) {
        expect(px(canvas.style.left)).toBeCloseTo(site.left + BOX.left * css, 6);
        expect(px(canvas.style.top)).toBeCloseTo(BOX.top * css, 6);
        expect(px(canvas.style.width)).toBeCloseTo(BW * css, 6);
        expect(px(canvas.style.height)).toBeCloseTo(BH * css, 6);
        expect([canvas.width, canvas.height]).toEqual([BW * site.scale, BH * site.scale]);
        // A device pixel is 1 / ratio CSS pixels: the canvas's CSS size times the ratio is its pixel size.
        expect(px(canvas.style.width) * site.ratio).toBeCloseTo(canvas.width, 6);
        expect(px(canvas.style.height) * site.ratio).toBeCloseTo(canvas.height, 6);
      }
    });

    it(`${name}: the layer's left edge lands on a whole device pixel when the picture's does`, () => {
      const wholeLeft = Math.round(site.left * site.ratio) / site.ratio;
      const { main, layer } = setup();
      layer.draw(frame(), { ...site, left: wholeLeft });
      const { shapes } = layersOf(main);
      const device = px(shapes.style.left) * site.ratio;
      expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-6);
    });
  }

  it('follows a resize: a new picture width moves and re-sizes the layers, and a ratio change re-places them', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const wide = sceneLayout(W + 40, H, 7);
    const wideBox = leanBox(W + 40, wide);
    const wideFrame = { layout: wide, width: W + 40, turn: 0.4, lean: 0 };
    layer.draw(wideFrame, { scale: 2, ratio: 2, left: 3 });
    const { behind, shapes, fronts } = layersOf(main);
    for (const canvas of [behind, shapes, fronts]) expect(canvas.width).toBe((wideBox.right - wideBox.left + 1) * 2);
    expect(px(shapes.style.left)).toBeCloseTo(3 + wideBox.left * 1, 6);
    layer.draw(wideFrame, { scale: 2, ratio: 1, left: 3 });
    expect(px(shapes.style.left)).toBeCloseTo(3 + wideBox.left * 2, 6);
    expect(px(shapes.style.width)).toBeCloseTo((wideBox.right - wideBox.left + 1) * 2, 6);
  });

  it('does not touch the canvases\' sizes or styles when nothing changed (a size change would clear them)', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { behind, shapes, fronts } = layersOf(main);
    const touched = (): number[] => [behind, shapes, fronts].flatMap((c) => [c.resizes, c.style.writes]);
    const before = touched();
    layer.draw(frame({ turn: 2.2 }), SITE);
    layer.draw(frame({ turn: 3.1 }), SITE);
    expect(touched()).toEqual(before);
  });

  it('re-sizes the canvases when the scale changes, drawing the new picture fully', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const { shapes } = layersOf(main);
    layer.draw(frame(), { ...SITE, scale: 4, ratio: 2 });
    expect([shapes.width, shapes.height]).toEqual([BW * 4, BH * 4]);
    // Cleared at the new size, then drawn: the last clear covers the whole canvas.
    expect(ctxOf(shapes).clears.at(-1)).toEqual([0, 0, BW * 4, BH * 4]);
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

  it('turns smoothing off and clears the canvas first, and every face is its own save and restore, so a clip does not leak onto the next', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.clears[0]).toEqual([0, 0, BW * SITE.scale, BH * SITE.scale]);
    expect(ctx.saves).toBeGreaterThanOrEqual(shapeDrawList(0.4).length);
    expect(ctx.restores).toBe(ctx.saves);
    expect(ctx.matrix).toEqual(IDENTITY);
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
    // Not one bitmap per face: faces with the same drawing share. The flakes behind are on a canvas of their own, so none is among them.
    expect(first.size).toBeLessThanOrEqual(new Set(shapeDrawList(0.4).map((s) => s.drawing)).size);
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
    for (const lean of [0, 0.2]) expect(() => layer.draw(frame({ lean }), SITE)).not.toThrow();
  });

  it('throws for a non-finite turn rather than drawing garbage, before any shadow is filled', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    ctx.fills.length = 0;
    expect(() => layer.draw(frame({ turn: Number.NaN }), SITE)).toThrow(RangeError);
    expect(ctx.fills).toHaveLength(0);
  });
});

describe('makeFineLayer: the lean is one smooth shear in the draw transforms (XMAS-90, spec 7.4)', () => {
  it('with no lean draws the shapes straight onto the layer, with no row copies', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0 }), SITE);
    const { behind, shapes } = layersOf(main);
    const snow = layersOf(main).fronts;
    const calls = ctxOf(shapes).calls;
    expect(calls.length).toBeGreaterThanOrEqual(shapeDrawList(0.4).length);
    findFaces(calls, shapeDrawList(0.4), SITE.scale);
    // Only the flakes' own layer (XMAS-84) is as wide as the shapes and is not a row copy.
    expect(page.made.some((c) => c !== behind && c !== shapes && c !== snow && c.width === BW * SITE.scale)).toBe(false);
  });

  it('clears the layer on a lean frame after an upright one, and returns to drawing straight onto it when the lean goes back to 0', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0 }), SITE);
    layer.draw(frame({ lean: 0.3 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    expect(ctx.clears.length).toBeGreaterThanOrEqual(2);
    ctx.calls.splice(0);
    layer.draw(frame({ lean: 0 }), SITE);
    findFaces(ctx.calls, shapeDrawList(0.4), SITE.scale);
    expect(ctx.calls.every((c) => c.source !== (ctx.canvas as unknown))).toBe(true);
    expect(ctx.clears.at(-1)).toEqual([0, 0, BW * SITE.scale, BH * SITE.scale]);
  });

  // The shear in device pixels: a point at height y (box device rows, down from the box top) moves lean x (box bottom - y) across.
  const K = SITE.scale;
  const shear = (lean: number, y: number): number => lean * (BH * K - y);
  const upright = (extra: Partial<FineFrame> = {}): FakeContext => drawnOn(0, extra);
  /** A fresh layer's frame at `lean`: the shapes canvas's context. */
  function drawnOn(lean: number, extra: Partial<FineFrame> = {}): FakeContext {
    const { main, layer } = fresh();
    layer.draw(frame({ lean, ...extra }), SITE);
    return ctxOf(layersOf(main).shapes);
  }
  /** Calls that draw a face's bitmap (a box-sized source is the layer's own, a copy of it or Santa's sprite). */
  const faceCalls = (ctx: FakeContext): Call[] => ctx.calls.filter((c) => c.source.width < BW * K);
  /** How many of the device points of a grid inside the box differ in "inside" between the upright regions and the sheared ones. */
  function regionMisses(up: Region[], leaned: Region[], lean: number): { inside: number; misses: number } {
    let inside = 0;
    let misses = 0;
    for (let y = 0; y < BH * K; y += 6) {
      for (let x = 0; x < BW * K; x += 6) {
        const was = up.every((r) => r(x + 0.5, y + 0.5));
        const now = leaned.every((r) => r(x + 0.5 + shear(lean, y + 0.5), y + 0.5));
        if (was) inside++;
        if (was !== now) misses++;
      }
    }
    return { inside, misses };
  }

  it('while leaning, nothing is copied in bands: the layer has no box-sized copy source and no extra box-sized canvas', () => {
    for (const lean of [0.3, -0.35]) {
      const ctx = drawnOn(lean);
      expect(ctx.calls.length).toBeGreaterThan(0);
      expect(ctx.calls.filter((c) => c.source.width >= BW * K)).toEqual([]);
      const shapes = ctx.canvas;
      const fronts = page.order[page.order.indexOf(shapes) + 1];
      const behind = page.order[page.order.indexOf(shapes) - 1];
      expect(page.made.some((c) => c !== behind && c !== shapes && c !== fronts && c.width === BW * K)).toBe(false);
    }
  });

  it('draws every face on the shapes layer with the upright transform sheared, and its clips sheared with it', () => {
    for (const lean of [0.3, -0.35]) {
      const up = faceCalls(upright());
      const leaned = faceCalls(drawnOn(lean));
      expect(up.length).toBeGreaterThan(5);
      expect(leaned, `faces drawn straight onto the layer at lean ${lean}`).toHaveLength(up.length);
      let inside = 0;
      let misses = 0;
      up.forEach((u, n) => {
        const l = leaned[n] as Call;
        const want = drawnQuad(u) as Point[];
        (drawnQuad(l) as Point[]).forEach(([x, y], i) => {
          expect(x, `face ${n} corner ${i} x`).toBeCloseTo((want[i]?.[0] ?? 0) + shear(lean, want[i]?.[1] ?? 0), 4);
          expect(y, `face ${n} corner ${i} y`).toBeCloseTo(want[i]?.[1] ?? 0, 4);
        });
        const r = regionMisses(u.clips, l.clips, lean);
        inside += r.inside;
        misses += r.misses;
      });
      // A clip left upright would let the face's sheared bitmap be cut by the wrong edge.
      expect(inside).toBeGreaterThan(1000);
      expect(misses / inside).toBeLessThan(0.01);
    }
  });

  it('fills the floor shadows on the shapes layer sheared the same way, disc clip included', () => {
    for (const lean of [0.3, -0.35]) {
      const up = upright().fills;
      const leaned = drawnOn(lean).fills;
      expect(leaned, 'the shadows are filled on the layer itself').toHaveLength(up.length);
      up.forEach((u, f) => {
        u.points.forEach(([x, y], i) => {
          expect(leaned[f]?.points[i]?.[0] ?? Number.NaN).toBeCloseTo(x + shear(lean, y), 4);
          expect(leaned[f]?.points[i]?.[1] ?? Number.NaN).toBeCloseTo(y, 4);
        });
        const r = regionMisses([u.region, ...u.clips], [(leaned[f] as Fill).region, ...(leaned[f] as Fill).clips], lean);
        expect(r.inside).toBeGreaterThan(100);
        expect(r.misses / r.inside).toBeLessThan(0.01);
      });
    }
  });

  it('draws Santa with the shear: every sprite copy carries the shear matrix and nothing else moves it', () => {
    let seen = 0;
    for (const lean of [0.3, -0.35]) {
      for (const santaTimeMs of [0, 3000, 6000, 9000, 12000]) {
        const sprites = upright({ santaTimeMs }).calls.filter((c) => c.source.width >= BW * K);
        if (sprites.length === 0) continue;
        const leaned = drawnOn(lean, { santaTimeMs }).calls.filter((c) => c.source.width >= BW * K);
        expect(leaned, `Santa drawn at ${santaTimeMs} ms, lean ${lean}`).toHaveLength(sprites.length);
        for (const call of leaned) {
          [1, 0, -lean, 1, shear(lean, 0), 0].forEach((v, i) => expect(call.matrix[i] ?? Number.NaN, `matrix[${i}]`).toBeCloseTo(v, 6));
        }
        seen++;
      }
    }
    expect(seen, 'Santa is on the layer at some of the times').toBeGreaterThan(1);
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

  it('is clear where no flake drew: the canvas is the box at the screen\'s size, cleared, with nothing drawn on it', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).fronts);
    expect([layersOf(main).fronts.width, layersOf(main).fronts.height]).toEqual([BW * k, BH * k]);
    expect(ctx.clears.at(-1)).toEqual([0, 0, BW * k, BH * k]);
    expect(ctx.rects).toEqual([]);
  });

  it('puts a flake opaque, with its own red, green and blue, at its place in the box, and a plus flake as five squares', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [step(0, 0, 0x112233), step(-5, 3, 0xfdfcfb), step(4, -9, 0x000000) /* black is a colour, not "nothing" */] }), SITE);
    const { lit } = ctxOf(layersOf(main).fronts);
    expect(lit).toEqual([
      { x: k * cx, y: k * cy, w: size, h: size, style: '#112233' },
      { x: k * (cx - 5), y: k * (cy + 3), w: size, h: size, style: '#fdfcfb' },
      { x: k * (cx + 4), y: k * (cy - 9), w: size, h: size, style: '#000000' },
    ]);
    // A plus flake is five squares of the flake size, spaced by that size.
    const plus: SnowStep['shape'] = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
    layer.draw(frame({ snowFront: [{ x: 2, y: 3, colour: 0x123456, shape: plus, depth: 20 }] }), SITE);
    const [x, y] = [k * (cx + 2), k * (cy + 3)];
    expect(ctxOf(layersOf(main).fronts).lit).toEqual(plus.map(([dx = 0, dy = 0]) => ({ x: x + dx * size, y: y + dy * size, w: size, h: size, style: '#123456' })));
  });

  it('drops a flake the lean pushes out of the box instead of wrapping it onto the next row', () => {
    const { main, layer } = setup();
    // The right edge flake on the top row would move right out of the box; the left one ten rows down moves right, in.
    layer.draw(frame({ snowFront: [step(BW - 1 - cx, -cy, 0xabcdef), step(-cx, 10 - cy, 0xfedcba)], lean: 0.5 }), SITE);
    // A canvas drops what is drawn right of its edge; what matters is that nothing lands on the box, and so on a wrapped row.
    const inBox = ctxOf(layersOf(main).fronts).lit.filter((r) => r.x < BW * k && r.x + r.w > 0);
    expect(inBox.length).toBeGreaterThan(0);
    for (const r of inBox) {
      expect(r.y, 'only the second flake\'s rows are lit').toBeGreaterThanOrEqual(10 * k);
      expect(r.y).toBeLessThan(10 * k + size);
    }
  });

  it('does not keep the last frame\'s flakes: a flake gone from the frame is cleared from the canvas and nothing is drawn again', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [step(0, 0, 0x445566)] }), SITE);
    const ctx = ctxOf(layersOf(main).fronts);
    const drawn = ctx.rects.length;
    const clears = ctx.clears.length;
    layer.draw(frame(), SITE);
    expect(ctx.clears.length).toBe(clears + 1);
    expect(ctx.clears.at(-1)).toEqual([0, 0, BW * k, BH * k]);
    expect(ctx.rects.length).toBe(drawn);
    expect(ctx.lit).toEqual([]);
  });

  it('survives a frame with no flake lists at all: nothing is lit on either canvas', () => {
    const { main, layer } = setup();
    expect(() => layer.draw(frame({ snowFront: undefined, snowBehind: undefined }), SITE)).not.toThrow();
    expect(ctxOf(layersOf(main).fronts).rects).toEqual([]);
    expect(ctxOf(layersOf(main).behind).rects).toEqual([]);
  });

  it('draws the flakes after a different-sized frame without keeping the old image size', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const wide = sceneLayout(W + 60, H, 7);
    const wideBox = leanBox(W + 60, wide);
    layer.draw({ layout: wide, width: W + 60, turn: 0.4, lean: 0, snowFront: [step(0, 0, 0x445566)] }, SITE);
    const { fronts } = layersOf(main);
    const [w, h] = [(wideBox.right - wideBox.left + 1) * k, (wideBox.bottom - wideBox.top) * k];
    expect([fronts.width, fronts.height]).toEqual([w, h]);
    expect(ctxOf(fronts).clears.at(-1)).toEqual([0, 0, w, h]);
    expect(ctxOf(fronts).lit).toHaveLength(1);
  });
});

// XMAS-90 round 2: each flake, behind and in front, moves as one block by the shear at its centre rounded to a whole screen pixel.
describe('makeFineLayer: a leaning flake is one block moved by the shear at its centre, rounded to a screen pixel', () => {
  const k = SITE.scale;
  const size = flakeSize(k);
  const gx = LAYOUT.globe.cx - BOX.left;
  const gy = LAYOUT.globe.cy - BOX.top;
  const WHITE = 0xffffff;
  const BEHIND = 0xaebcf0;
  const blockKeys = (x: number, y: number): string[] => Array.from({ length: size * size }, (_, i) => `${x + (i % size)},${y + Math.floor(i / size)}`);
  const sorted = (keys: string[]): string[] => [...new Set(keys)].sort();
  /** A flake at art offset (ax, ay) from the globe's centre, and where the shear puts its block's left: null when the rounding is not clear. */
  function placed(ax: number, ay: number, lean: number): { top: number; x: number; d: number } | null {
    const centre = gy * k + ay * k;
    const top = Math.floor(centre);
    // The flake's centre is its position or the middle of its block: both must round the same, so the test does not pick a convention.
    const moves = [centre, top + size / 2].map((c) => lean * (BH * k - c));
    const d = Math.round(moves[0] as number);
    return moves.every((m) => Math.round(m) === d) ? { top, x: (gx + ax) * k + d, d } : null;
  }
  const cases = (lean: number): { step: (colour: number, depth: number) => SnowStep; top: number; x: number; d: number }[] => {
    const out = [];
    // Rows from 8 art pixels below the picture's top, so every flake lies inside the picture and is drawn.
    for (let ay = 8 - gy; ay <= 60 && out.length < 5; ay += 7.31) {
      const ax = out.length * 9 - 18;
      const at = placed(ax, ay, lean);
      if (at !== null) out.push({ ...at, step: (colour: number, depth: number): SnowStep => ({ x: ax, y: ay, colour, shape: [[0, 0]], depth }) });
    }
    return out;
  };

  it('moves each flake in front as one block, by the shear at its centre rounded to a screen pixel, not a whole art pixel', () => {
    for (const lean of [0.1, -0.15]) {
      const list = cases(lean);
      expect(new Set(list.map((c) => c.d)).size, 'different shears').toBeGreaterThan(2);
      expect(list.some((c) => c.d % k !== 0), 'a shear that is not a whole art pixel').toBe(true);
      const { main, layer } = fresh();
      layer.draw(frame({ lean, snowFront: list.map((c) => c.step(WHITE, 20)) }), SITE);
      expect(keysOf(ctxOf(layersOf(main).fronts).lit)).toEqual(sorted(list.flatMap((c) => blockKeys(c.x, c.top))));
    }
  });

  it('moves each flake behind the glass centre the same way, on the flakes-behind layer under the shapes', () => {
    for (const lean of [0.1, -0.15]) {
      const list = cases(lean);
      const { main, layer } = fresh();
      layer.draw(frame({ lean, snowBehind: list.map((c) => c.step(BEHIND, -20)) }), SITE);
      expect(keysOf(ctxOf(layersOf(main).behind).lit)).toEqual(sorted(list.flatMap((c) => blockKeys(c.x, c.top))));
    }
  });

  it('moves a tumbling flake (a plus) as one block by the shear at its centre, though its arms\' own rounding would differ', () => {
    const lean = 0.3;
    const plus: SnowStep['shape'] = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
    let found: { ay: number; d: number } | undefined;
    for (let ay = 8 - gy; ay <= 60 && found === undefined; ay++) {
      const v = lean * (BH * k - (gy + ay) * k);
      const f = v - Math.floor(v);
      // The centre and the block's middle round alike, and the arms a row up and down round otherwise.
      if (f >= 0.2 && f <= 0.48) found = { ay, d: Math.floor(v) };
    }
    expect(found).toBeDefined();
    const { ay, d } = found as { ay: number; d: number };
    const { main, layer } = setup();
    layer.draw(frame({ lean, snowFront: [{ x: 0, y: ay, colour: 0x123456, shape: plus, depth: 20 }] }), SITE);
    const want = plus.flatMap(([dx = 0, dy = 0]) => blockKeys(gx * k + dx * size + d, Math.floor((gy + ay) * k) + dy * size));
    expect(keysOf(ctxOf(layersOf(main).fronts).lit)).toEqual(sorted(want));
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

  /** The square of a flake whose top-left is the screen pixel (x, y): one fillRect of the flake size in the colour. */
  const square = (x: number, y: number, colour: number): Rect => ({ x, y, w: flakeSize(k), h: flakeSize(k), style: hex(colour) });

  it('lands a flake on the screen pixel its own position picks, so two fractions inside one art pixel land on different screen pixels', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowFront: [flake(10, 0, WHITE, 20)] }), SITE);
    const snow = ctxOf(layersOf(main).fronts);
    const whole = [...snow.lit];
    layer.draw(frame({ snowFront: [flake(10.34, 0, WHITE, 20)] }), SITE);
    const fraction = [...snow.lit];
    // Both flakes are in the same art pixel, but the screen pixel is k to one art pixel: 10.34 is a screen pixel to the right.
    expect(whole).toEqual([square(k * (cx + 10), k * cy, WHITE)]);
    expect(fraction).toEqual([square(k * (cx + 10) + 1, k * cy, WHITE)]);
    expect((fraction[0]?.x ?? 0) % k, 'not a multiple of the art pixel size').not.toBe(0);
  });

  it('a flake behind the glass centre is a flake-sized block on the flakes-behind layer only, on the same screen pixel grid', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(0, 0, BEHIND, -20)] }), SITE);
    const { behind, shapes, fronts } = layersOf(main);
    expect(ctxOf(behind).lit).toEqual([square(k * cx, k * cy, BEHIND)]);
    layer.draw(frame({ snowBehind: [flake(10.34, 0, BEHIND, -20)] }), SITE);
    expect(ctxOf(behind).lit).toEqual([square(k * (cx + 10) + 1, k * cy, BEHIND)]);
    // Not on the front layer, nor on the shapes: the behind flake is drawn only on its own layer.
    expect(ctxOf(shapes).rects).toEqual([]);
    expect(ctxOf(shapes).calls.length).toBeGreaterThan(0);
    expect(ctxOf(fronts).rects).toEqual([]);
  });
});

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

  it('fills all the shadows in one path and one fill (a pixel under two takes the shade once), in the shadow ink at the shadow strength, before the first face', () => {
    const { main, layer } = setup();
    for (const turn of [0.4, 2.2]) {
      layer.draw(frame({ turn }), SITE);
      const ctx = ctxOf(layersOf(main).shapes);
      const { fills } = ctx;
      expect(fills.length).toBe(1);
      expect(fills.length).toBeLessThanOrEqual(globeShapes.length);
      for (const fill of fills) {
        const { rgb, alpha } = resolved(fill);
        expect(rgb).toBe(0x1d3350);
        expect(alpha).toBeCloseTo(0.32, 9);
      }
      // The shadows are under the shapes.
      expect(Math.max(...fills.map((f) => f.seq))).toBeLessThan(Math.min(...ctx.drawAt));
      ctx.fills.length = 0;
      ctx.drawAt.length = 0;
    }
  });

  it('covers the device pixels renderShadowSteps covers at the same scale: the same shadow on the screen\'s grid, disc clip included', () => {
    for (const turn of [0.4, 1.7, 3.0, 5.9]) {
      const { main, layer } = fresh();
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

  for (const site of [SITE, { scale: 5, ratio: 2, left: 0 }, { scale: 2, ratio: 1, left: 9 }]) {
    it(`puts no shadow pixel outside the floor disc, at scale ${site.scale} and several turns`, () => {
      const { cx, cy } = LAYOUT.globe;
      for (const turn of [0, 0.4, 2.5, 4.4]) {
        const { main, layer } = fresh();
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
    }, 30000);
  }

  it('puts the disc clip around the fills: unclipped, the shadows would reach outside the disc', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    // Each fill is made inside a clip (the disc), and at least one polygon alone reaches past it.
    for (const fill of ctx.fills) expect(fill.clips.length).toBeGreaterThan(0);
    const cutBy = (fills: Fill[]): number => {
      let cut = 0;
      for (const fill of fills) {
        for (let y = 0; y < BH * k; y++) for (let x = 0; x < BW * k; x++) if (fill.region(x + 0.5, y + 0.5) && !fill.clips.every((c) => c(x + 0.5, y + 0.5))) cut += 1;
      }
      return cut;
    };
    // Some shape stands near the rim for at least one turn: sweep and require the clip to have cut something.
    let cut = cutBy(ctx.fills);
    for (const turn of [1.0, 2.0, 3.0, 4.0, 5.0]) {
      ctx.fills.length = 0;
      layer.draw(frame({ turn }), SITE);
      cut += cutBy(ctx.fills);
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
    // The distance from (x, y) to the nearest edge of the points: the fill's rings are flat here, so the edges between them count too, which can only shorten a distance.
    const outlineDistance = (pts: readonly Point[], x: number, y: number): number => {
      let best = Number.POSITIVE_INFINITY;
      pts.forEach(([ax = 0, ay = 0], i) => {
        const [bx = 0, by = 0] = pts[(i + 1) % pts.length] ?? [];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
      });
      return best;
    };
    let moved = 0;
    let offGrid = 0;
    before.forEach((pts, n) => {
      pts.forEach(([x, y]) => {
        const d = outlineDistance(after[n] ?? [], x, y);
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

  it('does not keep last frame\'s shadows (the layer is cleared before the fills of a frame), and restores the context so the disc clip does not leak', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const clears = ctx.clears.length;
    const fills = ctx.fills.length;
    layer.draw(frame({ turn: 0.9 }), SITE);
    expect(ctx.clears.length).toBeGreaterThan(clears);
    expect(ctx.fills.length).toBeGreaterThan(fills);
    expect(ctx.fills[fills]?.seq).toBeGreaterThan(-1);
    expect(ctx.restores).toBe(ctx.saves);
    expect(ctx.matrix).toEqual(IDENTITY);
  });
});

/** The floor disc test, allowing the rim to be `slack` art units off (a device pixel's own width). */
function onFloorLoose(x: number, y: number, slack: number): boolean {
  return onFloor(x, y) || [[slack, 0], [-slack, 0], [0, slack], [0, -slack]].some(([dx = 0, dy = 0]) => onFloor(x + dx, y + dy));
}

// XMAS-68: the base is the last layer, over the glass's foot, Santa, the shapes and the flakes in front, drawn at the
// screen's pixel size with hard master colours, and worked out again only when its turn or the scale changes.
describe('makeFineLayer: the base', () => {
  /** The RGBA renderBase's picture gives at the screen's size k and a turn: alpha 0 where it draws nothing. */
  function wanted(k: number, turn: number): number[] {
    const side = BASE_WIDTH * k;
    const picture = new Uint32Array(side * BASE_ROWS * k).fill(NO_FRONT);
    renderBase(picture, side, 0, 0, k, turn);
    return Array.from(picture, (c) => (c === NO_FRONT ? [0, 0, 0, 0] : [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255])).flat();
  }
  const baseImage = (main: FakeCanvas): Put => {
    const image = ctxOf(baseOf(main)).puts.at(-1);
    if (image === undefined) throw new Error('the base was not put on its canvas');
    return image;
  };

  for (const [name, site] of [
    ['scale 3, ratio 1.5', SITE],
    ['a fractional ratio', FRACTIONAL],
    ['a narrow window: left negative', NARROW],
  ] as [string, FineSite][]) {
    it(`${name}: sits centred on the globe with its top ${BASE_SINK} rows above the ground line, in CSS pixels`, () => {
      const { main, layer } = setup();
      layer.draw(frame(), site);
      const canvas = baseOf(main);
      const css = site.scale / site.ratio;
      expect(px(canvas.style.left)).toBeCloseTo(site.left + (LAYOUT.globe.cx - BASE_WIDTH / 2) * css, 6);
      expect(px(canvas.style.top)).toBeCloseTo((LAYOUT.groundTop - BASE_SINK) * css, 6);
      expect(px(canvas.style.width)).toBeCloseTo(BASE_WIDTH * css, 6);
      expect(px(canvas.style.height)).toBeCloseTo(BASE_ROWS * css, 6);
    });
  }

  it.each([0, 0.5, 2.2])('draws true and puts exactly what renderBase draws on the base canvas at the screen\'s size (turn %s): hard colours, clear elsewhere', (turn) => {
    const { main, layer } = setup();
    expect(layer.draw(frame({ turn }), SITE)).toBe(true);
    expect([baseOf(main).width, baseOf(main).height]).toEqual([BASE_WIDTH * SITE.scale, BASE_ROWS * SITE.scale]);
    const image = baseImage(main);
    expect(image.width).toBe(BASE_WIDTH * SITE.scale);
    expect(image.height).toBe(BASE_ROWS * SITE.scale);
    expect(Array.from(image.data)).toEqual(wanted(SITE.scale, turn));
  });

  it('turns with the globe: a new turn puts a new image, which differs from the last', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.5 }), SITE);
    const first = baseImage(main);
    layer.draw(frame({ turn: 0.7 }), SITE);
    const second = baseImage(main);
    expect(ctxOf(baseOf(main)).puts).toHaveLength(2);
    expect(Array.from(second.data)).toEqual(wanted(SITE.scale, 0.7));
    expect(Array.from(second.data)).not.toEqual(Array.from(first.data));
  });

  it('does not work the base out again while the turn and the scale hold, even as the lean and the flakes change', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.5 }), SITE);
    layer.draw(frame({ turn: 0.5, lean: 0.3 }), SITE);
    layer.draw(frame({ turn: 0.5, lean: -0.2, snowFront: [{ x: 0, y: 0, colour: 0xffffff, shape: [[0, 0]], depth: 20 }] }), SITE);
    expect(ctxOf(baseOf(main)).puts).toHaveLength(1);
  });

  it('stands upright under a lean: the base image at lean 0.4 is the one at lean 0', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 1.1, lean: 0.4 }), SITE);
    expect(Array.from(baseImage(main).data)).toEqual(wanted(SITE.scale, 1.1));
  });

  it('works the base out again when the scale changes, at the new size', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.5 }), SITE);
    layer.draw(frame({ turn: 0.5 }), { ...SITE, scale: 4 });
    const puts = ctxOf(baseOf(main)).puts;
    expect(puts).toHaveLength(2);
    expect(puts[1]?.width).toBe(BASE_WIDTH * 4);
    expect(Array.from(puts[1]?.data ?? [])).toEqual(wanted(4, 0.5));
  });

  it('returns to the same image when the turn comes back to a turn it drew before, a whole turn on', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.5 }), SITE);
    layer.draw(frame({ turn: 0.5 + 2 * Math.PI }), SITE);
    const puts = ctxOf(baseOf(main)).puts;
    expect(Array.from(puts.at(-1)?.data ?? [])).toEqual(Array.from(puts[0]?.data ?? []));
  });
});

// XMAS-92b "The glass as one smooth shear on its own layer": with a glass layer the fine layer
// has a canvas of its own for the glass, between the scene canvas and the shapes, and draws the
// glass under the same shear as the shapes. The glass layer here is a small hand-made one.
describe('makeFineLayer: the glass layer (XMAS-92b)', () => {
  const K = SITE.scale;
  const glassOf = (fill: number, over: Partial<GlassLayer> = {}): GlassLayer => {
    const width = 20;
    const height = 30;
    const pixels = new Uint32Array(width * height).fill(fill);
    pixels[0] = 0; // a corner that paints nothing
    return { left: BOX.left + 10, top: BOX.top + 5, width, height, pixels, ...over };
  };
  const GLASS = glassOf(0x336699);
  const withGlass = (glass: GlassLayer | undefined, over: Partial<FineFrame> = {}): FineFrame => ({ ...frame(over), glass }) as FineFrame;
  const glassCanvas = (main: FakeCanvas): FakeCanvas => page.order[page.order.indexOf(main) + 1] as FakeCanvas;
  /** The put images that hold the glass's own pixels (one art pixel each), wherever the layer builds them. */
  const glassPuts = (): Put[] => page.puts.filter((put) => put.width === GLASS.width && put.height === GLASS.height);
  /** The glass's corner places, in the box's device pixels, when drawn upright. */
  const uprightCorners = (g: GlassLayer): Point[] => {
    const [x0, y0] = [(g.left - BOX.left) * K, (g.top - BOX.top) * K];
    return [[x0, y0], [x0 + g.width * K, y0], [x0, y0 + g.height * K], [x0 + g.width * K, y0 + g.height * K]];
  };
  function drawGlass(lean: number, glass: GlassLayer = GLASS): { main: FakeCanvas; glassCtx: FakeContext; shapesCtx: FakeContext } {
    const { main, layer } = fresh();
    layer.draw(withGlass(glass, { lean }), SITE);
    return { main, glassCtx: ctxOf(glassCanvas(main)), shapesCtx: ctxOf(page.order[3] as FakeCanvas) };
  }

  it('adds a canvas right after the scene canvas, before the shapes canvas, and draws the glass on it', () => {
    const { main, layer } = setup();
    layer.draw(withGlass(GLASS), SITE);
    expect(page.order).toHaveLength(6);
    const [first, glass, , shapes] = page.order;
    expect(first).toBe(main);
    // The shapes canvas is the one Santa and the faces go on; the glass canvas is not it.
    expect(ctxOf(shapes as FakeCanvas).calls.length).toBeGreaterThanOrEqual(shapeDrawList(0.4).length);
    expect(ctxOf(glass as FakeCanvas).calls.length).toBeGreaterThan(0);
    expect(glass).not.toBe(shapes);
    expect(glassPuts().length).toBeGreaterThan(0);
    // Colour numbers become opaque pixels; a 0 paints nothing.
    const put = glassPuts()[0] as Put;
    expect(put.data[3]).toBe(0);
    expect(put.data[(GLASS.width + 1) * 4 + 3]).toBe(255);
  });

  it('with no glass layer adds no canvas: the order stays main, flakes behind, shapes, flakes in front, base', () => {
    const { main, layer } = setup();
    layer.draw(withGlass(undefined), SITE);
    expect(page.order).toHaveLength(5);
    expect(page.order[0]).toBe(main);
  });

  /** The first face the shapes layer draws at a lean with the glass on. */
  const firstFace = (ctx: FakeContext): Call => ctx.calls.find((c) => c.source.width < BW * K) as Call;

  it('lands the glass upright at its box position at lean 0, and at a lean draws it once under the shapes\' shear: every corner moves lean x (box bottom - y) across, nothing copied in rows', () => {
    for (const lean of [0, 0.3, -0.35]) {
      const { glassCtx, shapesCtx } = drawGlass(lean);
      expect(glassCtx.calls, `one draw at lean ${lean}`).toHaveLength(1);
      expect(glassCtx.calls[0]?.smoothing, 'nearest-neighbour').toBe(false);
      const quad = drawnQuad(glassCtx.calls[0] as Call) as Point[];
      uprightCorners(GLASS).forEach(([x, y], i) => {
        expect(quad[i]?.[0] ?? Number.NaN, `corner ${i} x`).toBeCloseTo(x + lean * (BH * K - y), lean === 0 ? 6 : 4);
        expect(quad[i]?.[1] ?? Number.NaN, `corner ${i} y`).toBeCloseTo(y, lean === 0 ? 6 : 4);
      });
      // The shapes get the very same shear: a point at the same height moves the same across.
      const [fx, fy] = (drawnQuad(firstFace(shapesCtx)) as Point[])[0] as Point;
      const [ux, uy] = (drawnQuad(firstFace(drawGlass(0).shapesCtx)) as Point[])[0] as Point;
      expect(fx - ux).toBeCloseTo(lean * (BH * K - uy), 4);
      expect(fy).toBeCloseTo(uy, 4);
    }
  });

  it('clears the glass canvas each frame and sizes it once: a second frame with nothing changed writes no size or style', () => {
    const { main, layer } = setup();
    layer.draw(withGlass(GLASS), SITE);
    const canvas = glassCanvas(main);
    const ctx = ctxOf(canvas);
    expect(ctx.clears.at(-1)).toEqual([0, 0, canvas.width, canvas.height]);
    const before = [canvas.resizes, canvas.style.writes, ctx.clears.length];
    layer.draw(withGlass(GLASS, { lean: 0.2, turn: 1.1 }), SITE);
    expect([canvas.resizes, canvas.style.writes]).toEqual(before.slice(0, 2));
    expect(ctx.clears.length).toBe((before[2] ?? 0) + 1);
    expect(ctx.calls).toHaveLength(2);
  });

  it('rebuilds the glass bitmap only for a new glass: the same object over many frames makes one, a new one makes another', () => {
    const { layer } = setup();
    layer.draw(withGlass(GLASS), SITE);
    layer.draw(withGlass(GLASS, { lean: 0.3 }), SITE);
    layer.draw(withGlass(GLASS, { lean: -0.1, turn: 2 }), SITE);
    expect(glassPuts()).toHaveLength(1);
    layer.draw(withGlass(glassOf(0xcc3300)), SITE);
    expect(glassPuts()).toHaveLength(2);
    expect(Array.from((glassPuts()[1] as Put).data)).not.toEqual(Array.from((glassPuts()[0] as Put).data));
  });

  it('drops the glass canvas\'s picture when a later frame has no glass', () => {
    const { main, layer } = setup();
    layer.draw(withGlass(GLASS), SITE);
    const ctx = ctxOf(glassCanvas(main));
    const drawn = ctx.calls.length;
    layer.draw(withGlass(undefined), SITE);
    expect(ctx.calls.length, 'nothing drawn on the glass canvas').toBe(drawn);
    expect(ctx.clears.length, 'and it was cleared').toBeGreaterThanOrEqual(2);
  });
});

// XMAS-89 "The shapes drawn only when they change": the flakes behind have a canvas of their own under the shapes, and the
// shapes canvas (shadows and faces) is redrawn only when the turn, the scale, the lean, the box size or Santa's frame changes.
describe('makeFineLayer: the shapes canvas is redrawn only when it changes (XMAS-89)', () => {
  const k = SITE.scale;
  /** Every drawing operation on a context: a still frame must add none. */
  const work = (ctx: FakeContext): number[] => [ctx.saves, ctx.clips.length, ctx.calls.length, ctx.clears.length, ctx.fills.length];
  const flake = (x: number, y: number, depth: number): SnowStep => ({ x, y, colour: 0xaebcf0, shape: [[0, 0]], depth });
  /** The leftmost lit pixel of the squares on a canvas now. */
  const litLeft = (ctx: FakeContext): number => Math.min(...ctx.lit.map((r) => r.x));

  it('a second draw with the same turn, scale, lean and size and no Santa makes no save, clip, drawImage, clearRect or fill, however the flakes moved', () => {
    const { main, layer } = setup();
    layer.draw(frame({ lean: 0.2, snowBehind: [flake(0, 0, -20)], snowFront: [flake(3, 3, 20)] }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const first = work(ctx);
    expect(first.every((n) => n > 0), 'the first draw draws the shapes').toBe(true);
    layer.draw(frame({ lean: 0.2, snowBehind: [flake(5, 2, -20)], snowFront: [flake(9, 1, 20)] }), SITE);
    layer.draw(frame({ lean: 0.2 }), SITE);
    expect(work(ctx)).toEqual(first);
  });

  it.each<[string, Partial<FineFrame>, FineSite]>([
    ['turn', { turn: 0.9 }, SITE],
    ['lean', { lean: 0.15 }, SITE],
    ['scale', {}, { ...SITE, scale: 4, ratio: 2 }],
  ])('a changed %s redraws the shapes: cleared, shadows filled and every face drawn again', (_name, over, site) => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    ctx.calls.splice(0);
    const [saves, clips, , clears, fills] = work(ctx);
    layer.draw(frame(over), site);
    expect(ctx.clears.length).toBeGreaterThan(clears ?? 0);
    expect(ctx.fills.length).toBeGreaterThan(fills ?? 0);
    expect(ctx.saves).toBeGreaterThan(saves ?? 0);
    expect(ctx.clips.length).toBeGreaterThan(clips ?? 0);
    expect(ctx.calls.length, 'the faces are drawn again').toBeGreaterThan(0);
    // A sheared (leaning) face is not at its upright footprint, so only an unleaned redraw is matched face by face.
    if (over.lean === undefined) findFaces(ctx.calls, shapeDrawList(over.turn ?? 0.4), site.scale);
  });

  it('moves the flakes behind each frame on their own canvas, cleared and under the shapes, while the shapes are left alone', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(10, 0, -20)] }), SITE);
    const { behind, shapes } = layersOf(main);
    const ctx = ctxOf(behind);
    const [shapesWork, clears, left] = [work(ctxOf(shapes)), ctx.clears.length, litLeft(ctx)];
    layer.draw(frame({ snowBehind: [flake(14, 0, -20)] }), SITE);
    expect(litLeft(ctx) - left).toBe(4 * k);
    expect(ctx.clears.length, 'the old flake is cleared').toBe(clears + 1);
    expect(work(ctxOf(shapes))).toEqual(shapesWork);
    expect(page.order.indexOf(behind)).toBeLessThan(page.order.indexOf(shapes));
  });

  it('leaning shears both: the flake behind and the shapes move with the lean in the one frame', () => {
    const { main, layer } = setup();
    layer.draw(frame({ snowBehind: [flake(0, 20, -20)] }), SITE);
    const { behind, shapes } = layersOf(main);
    const upright = litLeft(ctxOf(behind));
    const faces = ctxOf(shapes);
    const uprightCalls = faces.calls.splice(0);
    const lean = 0.3;
    layer.draw(frame({ lean, snowBehind: [flake(0, 20, -20)] }), SITE);
    const centre = Math.floor((LAYOUT.globe.cy - BOX.top + 20) * k) + flakeSize(k) / 2;
    expect(Math.abs(litLeft(ctxOf(behind)) - upright - lean * (BH * k - centre))).toBeLessThanOrEqual(1);
    expect(faces.calls.length).toBe(uprightCalls.length);
    expect(faces.calls.length).toBeGreaterThan(0);
    // setShear composes c - lean * d with the face's own transform.
    faces.calls.forEach((call, i) => {
      const own = uprightCalls[i] as Call;
      expect(call.matrix[3]).toBeCloseTo(own.matrix[3], 6);
      expect(call.matrix[2]).toBeCloseTo(own.matrix[2] - lean * own.matrix[3], 6);
    });
  });

  it('a new box size redraws the shapes, since the canvas is cleared by its resize', () => {
    const { main, layer } = setup();
    layer.draw(frame(), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    ctx.calls.splice(0);
    const tall = sceneLayout(W, H + 120, 7);
    const box = leanBox(W, tall);
    expect(box.bottom - box.top, 'a layout whose box really changes').not.toBe(BH);
    layer.draw({ layout: tall, width: W, turn: 0.4, lean: 0 }, SITE);
    expect(layersOf(main).shapes.height).toBe((box.bottom - box.top) * k);
    expect(ctx.calls.length, 'the faces are drawn again').toBeGreaterThan(0);
  });

  it('a frame with Santa clears and blits the shapes every frame, even at the same turn and time, and the frame after him wipes him once', () => {
    const { main, layer } = setup();
    layer.draw(frame({ santaTimeMs: 3000 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    let [clears, calls] = [ctx.clears.length, ctx.calls.length];
    for (const santaTimeMs of [3000, 3000, 3400]) {
      layer.draw(frame({ santaTimeMs }), SITE);
      expect(ctx.clears.length, `cleared at ${santaTimeMs}`).toBe(clears + 1);
      expect(ctx.calls.length, `drawn at ${santaTimeMs}`).toBeGreaterThan(calls);
      [clears, calls] = [ctx.clears.length, ctx.calls.length];
    }
    layer.draw(frame(), SITE);
    expect(ctx.clears.length, 'Santa is wiped').toBe(clears + 1);
    expect(ctx.calls.length).toBeGreaterThan(calls);
    const without = work(ctx);
    layer.draw(frame(), SITE);
    expect(work(ctx)).toEqual(without);
  });

  it('a new glass does not redraw the shapes', () => {
    const { layer } = setup();
    const glass = (fill: number): GlassLayer => ({ left: BOX.left + 10, top: BOX.top + 5, width: 20, height: 30, pixels: new Uint32Array(600).fill(fill) });
    layer.draw({ ...frame(), glass: glass(0x336699) }, SITE);
    const ctx = ctxOf(page.order[3] as FakeCanvas);
    const glassCtx = ctxOf(page.order[1] as FakeCanvas);
    const [shapesWork, glassCalls] = [work(ctx), glassCtx.calls.length];
    layer.draw({ ...frame(), glass: glass(0xcc3300) }, SITE);
    layer.draw(frame(), SITE);
    expect(work(ctx)).toEqual(shapesWork);
    expect(glassCtx.calls.length).toBe(glassCalls + 1);
  });
});

const blank = (): FineTrace => ({ glassMs: -1, behindMs: -1, shapesMs: -1, frontMs: -1, baseMs: -1, shapesCalls: -1, behindFlakes: -1, frontFlakes: -1, shapesRedrawn: false, glassPainted: false, baseBuilt: false, santaMs: -1, santaPaints: -1, santaSame: -1, shapesClipMs: -1, shapesDrawMs: -1, shapesSameInputs: -1, totalMs: -1, inputsMs: -1, shadowsMs: -1, facesMs: -1, shapesRestMs: -1, width: 0, height: 0, baseWidth: 0, baseHeight: 0 });
/** performance.now moves 2 ms per call, so any timed section reads above 0. */
const tick = (): ReturnType<typeof vi.spyOn> => {
  let t = 0;
  return vi.spyOn(performance, 'now').mockImplementation(() => (t += 2));
};

describe('makeFineLayer: the frame trace (XMAS-102)', () => {
  beforeEach(() => {
    tick();
  });
  afterEach(() => vi.restoreAllMocks());

  it('fills the trace: each section timed, draw calls counted, canvas sizes in device pixels', () => {
    const { layer } = setup();
    const trace = blank();
    layer.draw(frame({ santaTimeMs: 3000 }), { ...SITE, trace });
    for (const ms of [trace.glassMs, trace.behindMs, trace.shapesMs, trace.frontMs, trace.baseMs]) expect(ms).toBeGreaterThan(0);
    expect(trace).toMatchObject({ shapesRedrawn: true, baseBuilt: true });
    for (const n of [trace.shapesCalls, trace.width, trace.height, trace.baseWidth, trace.baseHeight]) expect(n).toBeGreaterThan(0);
  });

  it('counts the shapes canvas drawImage calls and the flakes in each snow layer, per frame', () => {
    const { main, layer } = setup();
    const flakes = (n: number, depth: number): SnowStep[] => Array.from({ length: n }, (_, i) => ({ x: i, y: i, colour: 0xaebcf0, shape: [[0, 0]], depth }));
    const trace = blank();
    layer.draw(frame({ lean: 0, snowBehind: flakes(3, -20), snowFront: flakes(5, 20) }), { ...SITE, trace });
    const ctx = ctxOf(layersOf(main).shapes);
    expect(ctx.calls.length).toBeGreaterThan(0);
    expect(trace.shapesCalls).toBe(ctx.calls.length);
    expect(trace).toMatchObject({ behindFlakes: 3, frontFlakes: 5 });
    // A redraw (new turn) counts only that frame's calls, not the running total.
    const before = ctx.calls.length;
    layer.draw(frame({ turn: 0.9, lean: 0, snowBehind: flakes(2, -20), snowFront: [] }), { ...SITE, trace });
    expect(trace.shapesCalls).toBe(ctx.calls.length - before);
    expect(trace.shapesCalls).toBeGreaterThan(0);
    expect(trace).toMatchObject({ behindFlakes: 2, frontFlakes: 0 });
    // A still frame redraws no shapes but the flakes still move.
    layer.draw(frame({ turn: 0.9, lean: 0, snowBehind: flakes(4, -20), snowFront: flakes(1, 20) }), { ...SITE, trace });
    expect(trace).toMatchObject({ shapesRedrawn: false, shapesCalls: 0, behindFlakes: 4, frontFlakes: 1 });
  });

  it('splits a shapes redraw into clip ms and drawImage ms (XMAS-108); a repeated identical still frame redraws no shapes, builds no base and reads 0 for all of it', () => {
    const { layer } = setup();
    const trace = blank();
    layer.draw(frame(), { ...SITE, trace });
    expect(trace.shapesClipMs).toBeGreaterThan(0);
    expect(trace.shapesDrawMs).toBeGreaterThan(0);
    expect(trace.shapesMs).toBeGreaterThanOrEqual(trace.shapesClipMs);
    layer.draw(frame(), { ...SITE, trace });
    expect(trace).toMatchObject({ shapesRedrawn: false, shapesCalls: 0, behindFlakes: 0, frontFlakes: 0, glassPainted: false, baseBuilt: false, shapesClipMs: 0, shapesDrawMs: 0, shapesSameInputs: 0 });
  });

  it('counts a redraw with the same turn, scale, lean and size as same inputs: Santa moving, then the wipe frame; not the first draw', () => {
    const { layer } = setup();
    const trace = blank();
    layer.draw(frame({ santaTimeMs: 3000 }), { ...SITE, trace });
    expect(trace).toMatchObject({ shapesRedrawn: true, shapesSameInputs: 0 });
    layer.draw(frame({ santaTimeMs: 3400 }), { ...SITE, trace });
    expect(trace).toMatchObject({ shapesRedrawn: true, shapesSameInputs: 1 });
    layer.draw(frame(), { ...SITE, trace });
    expect(trace).toMatchObject({ shapesRedrawn: true, shapesSameInputs: 1 });
    layer.draw(frame(), { ...SITE, trace });
    expect(trace).toMatchObject({ shapesRedrawn: false, shapesSameInputs: 0 });
  });

  it('is not same inputs when the turn, lean or place changed since the last redraw, even with Santa', () => {
    const { layer } = setup();
    const trace = blank();
    layer.draw(frame({ santaTimeMs: 3000 }), { ...SITE, trace });
    for (const over of [{ turn: 0.9 }, { lean: 0.15 }]) {
      layer.draw(frame({ santaTimeMs: 3000, ...over }), { ...SITE, trace });
      expect(trace.shapesSameInputs, JSON.stringify(over)).toBe(0);
    }
    layer.draw(frame({ santaTimeMs: 3000, lean: 0.15 }), { ...SITE, scale: 4, ratio: 2, trace });
    expect(trace.shapesSameInputs, 'scale').toBe(0);
  });

  it('without a trace it never reads the clock and draws the same as with one', () => {
    const spy = vi.mocked(performance.now);
    const plain = setup();
    plain.layer.draw(frame({ santaTimeMs: 3000 }), SITE);
    expect(spy).not.toHaveBeenCalled();
    const traced = setup();
    traced.layer.draw(frame({ santaTimeMs: 3000 }), { ...SITE, trace: blank() });
    expect(ctxOf(layersOf(traced.main).shapes).calls.length).toBe(ctxOf(layersOf(plain.main).shapes).calls.length);
  });
});

// XMAS-108: with Santa on and nothing else changed, the shapes are cached below and above him and blitted.
describe('makeFineLayer: the shapes cached below and above Santa (XMAS-108)', () => {
  beforeEach(() => {
    tick();
  });
  afterEach(() => vi.restoreAllMocks());

  /** Where Santa sits in the draw list at a time: his split index. */
  const splitAt = (ms: number): number => shapeDrawList(0.4, globeShapes, ms).findIndex((s) => 'sprite' in s);
  /** Times a little apart that share a split, and times with another split. */
  const times = ((): { run: number[]; other: number[] } => {
    const all = Array.from({ length: 600 }, (_, i) => i * 40);
    const run: number[] = [];
    for (const t of all) {
      if (run.length > 0 && splitAt(t) !== splitAt(run[0] as number)) {
        if (run.length >= 4) break;
        run.length = 0;
      }
      run.push(t);
    }
    const first = splitAt(run[0] as number);
    const start = all.find((t) => t > (run.at(-1) as number) && splitAt(t) !== first) as number;
    const other = all.filter((t) => t >= start && splitAt(t) === splitAt(start)).slice(0, 3);
    return { run: run.slice(0, 4), other };
  })();

  /** What the shapes canvas holds, as its drawing: the ops since its last clear in order, with any cached layer it blits expanded. */
  function flat(canvas: FakeCanvas): string[] {
    const ctx = ctxOf(canvas);
    const cleared = ctx.clearAt.at(-1) ?? 0;
    const ops: { seq: number; text: string }[] = [];
    const clip = (regions: Region[]): string => {
      let out = '';
      for (let j = 0; j < 18; j++) for (let i = 0; i < 24; i++) out += regions.every((r) => r(((i + 0.5) * canvas.width) / 24, ((j + 0.5) * canvas.height) / 18)) ? '1' : '0';
      return out;
    };
    ctx.fills.forEach((f) => ops.push({ seq: f.seq, text: `F ${f.style} ${f.alpha} ${f.points.map((p) => p.map((v) => v.toFixed(3))).join(';')} ${clip(f.clips)}` }));
    ctx.calls.forEach((c, i) => {
      const source = c.source as unknown as FakeCanvas;
      const seq = ctx.drawAt[i] as number;
      const puts = ctxOf(source).puts;
      const isCache = source !== canvas && puts.length === 0 && source.width === canvas.width && source.height === canvas.height && page.order.indexOf(source) === -1;
      if (isCache) flat(source).forEach((text, n) => ops.push({ seq: seq + n / 1000, text }));
      else ops.push({ seq, text: `D ${source.width}x${source.height} ${c.args.join(',')} ${c.matrix.map((v) => v.toFixed(3)).join(',')} ${clip(c.clips)} ${inkOf(puts.at(-1))}` });
    });
    return ops.filter((o) => o.seq >= cleared).sort((a, b) => a.seq - b.seq).map((o) => o.text);
  }

  /** A digest of the pixels a put wrote (its dirty rectangle): what was left from earlier frames outside it does not show. */
  const inkOf = (put: Put | undefined): string => {
    if (put === undefined) return '';
    const [x = 0, y = 0, w = put.width, h = put.height] = put.dirty ?? [];
    let sum = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) for (let c = 0; c < 4; c++) sum = (sum * 31 + (put.data[(j * put.width + i) * 4 + c] ?? 0) + 1) % 1000003;
    return `${x},${y},${w},${h}:${sum}`;
  };
  const shapesOf = (main: FakeCanvas): FakeCanvas => layersOf(main).shapes;
  /** The frame drawn as a fresh layer's first frame, which is direct. */
  const direct = (f: FineFrame, site: FineSite = SITE): string[] => {
    const { main, layer } = setup();
    layer.draw(f, site);
    return flat(shapesOf(main));
  };

  it('with Santa on and the inputs and split unchanged, a frame clears, blits the cached layers and paints Santa: no face is drawn', () => {
    const { main, layer } = setup();
    const trace = blank();
    const [t0, t1, t2, t3] = times.run as [number, number, number, number];
    // The first frame has nothing to compare with, the second builds the cache.
    layer.draw(frame({ santaTimeMs: t0 }), { ...SITE, trace });
    const ctx = ctxOf(shapesOf(main));
    layer.draw(frame({ santaTimeMs: t1 }), { ...SITE, trace });
    for (const t of [t2, t3]) {
      const calls = ctx.calls.length;
      const clears = ctx.clears.length;
      layer.draw(frame({ santaTimeMs: t }), { ...SITE, trace });
      expect(trace).toMatchObject({ shapesRedrawn: true, shapesClipMs: 0, shapesDrawMs: 0 });
      expect(trace.shapesCalls).toBeLessThanOrEqual(4);
      expect(ctx.clears.length).toBe(clears + 1);
      const drawn = ctx.calls.slice(calls);
      expect(drawn.length).toBe(trace.shapesCalls);
      // Only whole-canvas layers and Santa's sprite are copied: no small face bitmap.
      expect(drawn.every((c) => c.source.width >= shapesOf(main).width), `at ${t}`).toBe(true);
    }
  });

  it('draws the same shapes pixels with the cache as directly, at several times and across a change of Santa\'s split', () => {
    expect(splitAt(times.run[0] as number)).not.toBe(splitAt(times.other[0] as number));
    const { main, layer } = setup();
    for (const t of [...times.run, ...times.other]) {
      layer.draw(frame({ santaTimeMs: t }), SITE);
      expect(flat(shapesOf(main)), `at ${t}`).toEqual(direct(frame({ santaTimeMs: t })));
    }
  });

  it('a frame whose inputs differ from the previous redraw (a drag) draws every face directly, every frame', () => {
    const { layer } = setup();
    const trace = blank();
    for (let i = 0; i < 5; i++) {
      const f = frame({ santaTimeMs: times.run[0] as number, turn: 0.4 + i * 0.07 });
      layer.draw(f, { ...SITE, trace });
      const expected = blank();
      setup().layer.draw(f, { ...SITE, trace: expected });
      expect(trace.shapesCalls, `frame ${i}`).toBe(expected.shapesCalls);
      expect(trace.shapesClipMs, `frame ${i}`).toBeGreaterThan(0);
    }
  });

  it('rebuilds when the lean or the scale changes: the next frames equal a direct draw, not the old cache', () => {
    for (const [over, site] of [[{ lean: 0.15 }, SITE], [{}, { ...SITE, scale: 4, ratio: 2 }]] as const) {
      const { main, layer } = setup();
      for (const t of times.run) layer.draw(frame({ santaTimeMs: t }), SITE);
      for (const t of times.other) {
        layer.draw(frame({ santaTimeMs: t, ...over }), site);
        expect(flat(shapesOf(main)), `${JSON.stringify(over)} ${site.scale} at ${t}`).toEqual(direct(frame({ santaTimeMs: t, ...over }), site));
      }
    }
  });

  it('the frame after Santa leaves wipes him: it equals a never-Santa draw', () => {
    const { main, layer } = setup();
    for (const t of times.run) layer.draw(frame({ santaTimeMs: t }), SITE);
    layer.draw(frame(), SITE);
    expect(flat(shapesOf(main))).toEqual(direct(frame()));
  });
});
