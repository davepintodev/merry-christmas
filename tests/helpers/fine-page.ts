// The fake page the fine layer tests draw on (shared by fine-layer.test.ts and
// fine-layer-shadows.test.ts): a document whose canvases and 2d contexts record
// what is done to them, the picture and site the layer is checked at, and the
// helpers that find the layer's canvases on the page.
import { afterEach, beforeEach } from 'vitest';
import { leanBox } from '../../src/scene/lean.ts';
import { sceneLayout } from '../../src/scene/frame.ts';
import { makeFineLayer, type FineFrame, type FineSite } from '../../src/page/fine-layer.ts';
import { IDENTITY, through, type Matrix, type Point } from './matrix.ts';

export const W = 240;
export const H = 180;
export const LAYOUT = sceneLayout(W, H, 7);
export const BOX = leanBox(W, LAYOUT);
export const BW = BOX.right - BOX.left + 1;
export const BH = BOX.bottom - BOX.top;
export const SITE: FineSite = { scale: 3, ratio: 1.5, left: 7 };
export const FRACTIONAL: FineSite = { scale: 5, ratio: 1.25, left: 12.8 };
export const NARROW: FineSite = { scale: 3, ratio: 1.5, left: -41.333333333333336 };


export type Call = { source: HTMLCanvasElement; args: number[]; matrix: Matrix; smoothing: boolean; clips: Region[] };
/** XMAS-82: a region of the canvas in device pixels, as a test of a device point. */
export type Region = (x: number, y: number) => boolean;
export type Fill = { seq: number; style: string; alpha: number; points: Point[]; clips: Region[]; region: Region };
export type Put = { data: Uint8ClampedArray; width: number; height: number; dirty?: number[] };
/** A fillRect with the fill style in force at the call. */
export type Rect = { x: number; y: number; w: number; h: number; style: string };

export class FakeStyle {
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

export class FakeContext {
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

export class FakeCanvas {
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

export class FakeDocument {
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

/** The fake page of the running test; useFakePage puts a new one in place before each test. */
export let page: FakeDocument;

/** Call at the top level of a test file: before each test a fresh fake page stands in as the document, and after it the real one is put back. */
export function useFakePage(): void {
  let original: unknown;
  beforeEach(() => {
    original = (globalThis as { document?: unknown }).document;
    page = new FakeDocument();
    (globalThis as { document?: unknown }).document = page;
  });
  afterEach(() => {
    (globalThis as { document?: unknown }).document = original;
  });
}

/** The scene canvas on the fake page, and the layer over it. */
export function setup(): { main: FakeCanvas; layer: ReturnType<typeof makeFineLayer> } {
  const main = new FakeCanvas(page);
  page.order.push(main);
  return { main, layer: makeFineLayer(main as unknown as HTMLCanvasElement) };
}

export function frame(over: Partial<FineFrame> = {}): FineFrame {
  return { layout: LAYOUT, width: W, turn: 0.4, lean: 0, ...over };
}

/** The canvases the layer makes, with no glass: the flakes behind (XMAS-89), the shapes (shadows, faces and Santa) over them, and the flakes in front. */
export function layersOf(main: FakeCanvas): { behind: FakeCanvas; shapes: FakeCanvas; fronts: FakeCanvas } {
  const at = page.order.indexOf(main);
  const behind = page.order[at + 1];
  const shapes = page.order[at + 2];
  const fronts = page.order[at + 3];
  if (behind === undefined || shapes === undefined || fronts === undefined) throw new Error('the layers are not on the page');
  return { behind, shapes, fronts };
}

/** XMAS-68: the base's canvas, the last of the layers. */
export function baseOf(main: FakeCanvas): FakeCanvas {
  const base = page.order[page.order.indexOf(main) + 4];
  if (base === undefined) throw new Error('the base layer is not on the page');
  return base;
}

/** A fresh layer on a fresh page order (the fake document itself is kept). */
export function fresh(): ReturnType<typeof setup> {
  page.made.length = 0;
  page.order.length = 0;
  return setup();
}

export function ctxOf(canvas: FakeCanvas): FakeContext {
  const c = canvas.getContext();
  if (c === null) throw new Error('no context');
  return c;
}

export function near(p: readonly number[], q: readonly number[]): boolean { return p.length === q.length && p.every((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) < 1e-6); }

/** The winding number of the closed ring `pts` about (px, py): an edge crossing the point's row counts +1 if it goes up with the point on its left, -1 if down with the point on its right. */
export function windingOf(pts: readonly Point[], px: number, py: number): number {
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
