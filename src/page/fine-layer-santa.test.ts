// XMAS-83 part B "Santa on the fine layer": the fine layer paints Santa's sprite
// step on its shapes canvas, in the draw list's order among the shapes' faces, as
// whole device-pixel blocks. The frame carries his time as `santaTimeMs`; with no
// time there is no Santa. The CPU renderer (renderDrawList at the layer's whole
// zoom) is the reference for his pixels.
//
// A fake page stands in for the browser, as in fine-layer.test.ts, but its
// contexts also rasterise whatever is NOT a face: fillRect, putImageData and
// drawImage under a pure translation (the way Santa could be painted, however the
// layer chooses to do it), through the clips in force. A face's drawImage (under
// a scaling transform) is only logged, so the shapes canvas's "ink" is Santa alone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { sceneLayout } from '../scene/frame.ts';
import { NO_FRONT } from '../scene/globe.ts';
import { leanBox, rowShift } from '../scene/lean.ts';
import { renderDrawList, shapeDrawList, type DrawStep, type SantaDraw } from '../scene/shape-draw-list.ts';
import { globeShapes } from '../scene/shapes.ts';
import type { FaceDraw } from '../scene/shapes-draw.ts';
import { flakeSize, type SnowStep } from '../scene/snow-draw-list.ts';
import { makeFineLayer, type FineFrame, type FineSite } from './fine-layer.ts';

const W = 240;
const H = 180;
const LAYOUT = sceneLayout(W, H, 7);
const BOX = leanBox(W, LAYOUT);
const BW = BOX.right - BOX.left + 1;
const BH = BOX.bottom - BOX.top;
const IDENTITY = [1, 0, 0, 1, 0, 0];

type Matrix = number[];
type Point = [number, number];
type Op = { canvas: FakeCanvas; kind: 'face' | 'ink'; seq: number; args: number[]; matrix: Matrix };

function near(p: readonly number[], q: readonly number[]): boolean {
  return p.length === q.length && p.every((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) < 1e-6);
}

/** Whether a matrix is a pure translation, so its draw is a copy and not a face. */
function copying(m: readonly number[]): boolean {
  return near(m.slice(0, 4), IDENTITY.slice(0, 4));
}

function through(m: readonly number[], x: number, y: number): Point {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

function inside(poly: readonly Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Point;
    const [xj, yj] = poly[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** '#rrggbb', 'rgb(r, g, b)' or 'rgba(r, g, b, a)' as an opaque pixel word (0 for a clear one). */
function wordOfStyle(style: string): number {
  if (style.startsWith('#')) {
    const hex = style.length === 4 ? [...style.slice(1)].map((c) => c + c).join('') : style.slice(1, 7);
    return (0xff000000 | Number.parseInt(hex, 16)) >>> 0;
  }
  const n = /rgba?\(([^)]*)\)/.exec(style)?.[1]?.split(',').map((s) => Number.parseFloat(s)) ?? [];
  if ((n[3] ?? 1) === 0) return 0;
  return (0xff000000 | ((n[0] ?? 0) << 16) | ((n[1] ?? 0) << 8) | (n[2] ?? 0)) >>> 0;
}

class FakeStyle {
  private values = new Map<string, string>();
  set cssText(text: string) {
    this.values.set('cssText', text);
  }
  get cssText(): string {
    return this.values.get('cssText') ?? '';
  }
  get left(): string { return this.values.get('left') ?? ''; }
  set left(v: string) { this.values.set('left', v); }
  get top(): string { return this.values.get('top') ?? ''; }
  set top(v: string) { this.values.set('top', v); }
  get width(): string { return this.values.get('width') ?? ''; }
  set width(v: string) { this.values.set('width', v); }
  get height(): string { return this.values.get('height') ?? ''; }
  set height(v: string) { this.values.set('height', v); }
}

class FakeContext {
  imageSmoothingEnabled = true;
  fillStyle: string = '#000000';
  matrix: Matrix = [...IDENTITY];
  private saved: { matrix: Matrix; clips: number }[] = [];
  private clipPolys: Point[][] = [];
  private path: Point[] = [];
  readonly puts: { data: Uint8ClampedArray; width: number; height: number }[] = [];
  constructor(readonly canvas: FakeCanvas) {}
  save(): void {
    this.saved.push({ matrix: [...this.matrix], clips: this.clipPolys.length });
  }
  restore(): void {
    const top = this.saved.pop();
    this.matrix = top?.matrix ?? [...IDENTITY];
    this.clipPolys.length = top?.clips ?? 0;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = this.matrix;
    this.matrix = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(x: number, y: number): void {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = this.matrix;
    this.matrix = [a * x, b * x, c * y, d * y, e, f];
  }
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path.push(through(this.matrix, x, y));
  }
  lineTo(x: number, y: number): void {
    this.path.push(through(this.matrix, x, y));
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
  }
  arc(x: number, y: number, r: number): void {
    for (let i = 0; i < 90; i++) this.lineTo(x + r * Math.cos((i * Math.PI) / 45), y + r * Math.sin((i * Math.PI) / 45));
  }
  closePath(): void {}
  clip(): void {
    this.clipPolys.push([...this.path]);
  }
  private open(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.canvas.width && y < this.canvas.height && this.clipPolys.every((poly) => inside(poly, x + 0.5, y + 0.5));
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    const ink = this.canvas.ink();
    for (let py = Math.max(0, Math.round(y)); py < Math.min(this.canvas.height, Math.round(y + h)); py++) {
      for (let px = Math.max(0, Math.round(x)); px < Math.min(this.canvas.width, Math.round(x + w)); px++) ink[py * this.canvas.width + px] = 0;
    }
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const [x0, y0] = through(this.matrix, x, y);
    const [x1, y1] = through(this.matrix, x + w, y + h);
    this.paint(Math.round(Math.min(x0, x1)), Math.round(Math.min(y0, y1)), Math.round(Math.max(x0, x1)), Math.round(Math.max(y0, y1)), () => wordOfStyle(this.fillStyle));
  }
  /** Writes `word(px, py)` (0 skips) over the device rectangle, where the clips are open; logs one ink op if any pixel was written. */
  private paint(x0: number, y0: number, x1: number, y1: number, word: (px: number, py: number) => number, args: number[] = []): void {
    const ink = this.canvas.ink();
    let wrote = 0;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (!this.open(px, py)) continue;
        const w = word(px, py);
        if (w === 0) continue;
        ink[py * this.canvas.width + px] = w;
        wrote++;
      }
    }
    if (wrote > 0) this.canvas.page.log({ canvas: this.canvas, kind: 'ink', args, matrix: [...this.matrix] });
  }
  drawImage(source: FakeCanvas, ...args: number[]): void {
    if (!copying(this.matrix)) {
      this.canvas.page.log({ canvas: this.canvas, kind: 'face', args, matrix: [...this.matrix] });
      return;
    }
    const [sx, sy, sw, sh, dx, dy, dw, dh] =
      args.length === 8 ? args : args.length === 4 ? [0, 0, source.width, source.height, ...args] : [0, 0, source.width, source.height, args[0], args[1], source.width, source.height];
    if ([sx, sy, sw, sh, dx, dy, dw, dh].some((v) => v === undefined)) throw new Error('drawImage with odd arguments');
    const [ex = 0, ey = 0] = [this.matrix[4], this.matrix[5]];
    const from = source.ink();
    const x0 = Math.round((dx as number) + ex);
    const y0 = Math.round((dy as number) + ey);
    this.paint(x0, y0, x0 + Math.round(dw as number), y0 + Math.round(dh as number), (px, py) => {
      const u = Math.floor((sx as number) + ((px - x0 + 0.5) * (sw as number)) / (dw as number));
      const v = Math.floor((sy as number) + ((py - y0 + 0.5) * (sh as number)) / (dh as number));
      if (u < 0 || v < 0 || u >= source.width || v >= source.height) return 0;
      return from[v * source.width + u] ?? 0;
    }, args);
  }
  createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
  putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, dx = 0, dy = 0): void {
    this.puts.push({ data: Uint8ClampedArray.from(image.data), width: image.width, height: image.height });
    const ink = this.canvas.ink();
    let wrote = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue;
        const i = (y * image.width + x) * 4;
        const alpha = image.data[i + 3] ?? 0;
        const word = alpha === 0 ? 0 : (0xff000000 | ((image.data[i] ?? 0) << 16) | ((image.data[i + 1] ?? 0) << 8) | (image.data[i + 2] ?? 0)) >>> 0;
        ink[py * this.canvas.width + px] = word;
        if (word !== 0) wrote++;
      }
    }
    if (wrote > 0) this.canvas.page.log({ canvas: this.canvas, kind: 'ink', args: [dx, dy], matrix: [...this.matrix] });
  }
}

class FakeCanvas {
  readonly style = new FakeStyle();
  private w = 300;
  private h = 150;
  private pixels: Uint32Array | null = null;
  private context: FakeContext | null = null;
  constructor(readonly page: FakeDocument) {}
  get width(): number { return this.w; }
  set width(v: number) { this.w = v; this.pixels = null; }
  get height(): number { return this.h; }
  set height(v: number) { this.h = v; this.pixels = null; }
  /** What non-face drawing left, as opaque words (0 for clear); a size change clears it. */
  ink(): Uint32Array {
    this.pixels ??= new Uint32Array(this.w * this.h);
    return this.pixels;
  }
  getContext(): FakeContext {
    this.context ??= new FakeContext(this);
    return this.context;
  }
  after(node: FakeCanvas): void {
    const order = this.page.order;
    order.splice(order.indexOf(this) + 1, 0, node);
  }
}

class FakeDocument {
  readonly order: FakeCanvas[] = [];
  readonly ops: Op[] = [];
  private count = 0;
  log(op: Omit<Op, 'seq'>): void {
    this.ops.push({ ...op, seq: this.count++ });
  }
  createElement(tag: string): FakeCanvas {
    if (tag !== 'canvas') throw new Error(`only canvases are made, not ${tag}`);
    return new FakeCanvas(this);
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

function setup(): { main: FakeCanvas; layer: ReturnType<typeof makeFineLayer> } {
  const main = new FakeCanvas(page);
  page.order.push(main);
  return { main, layer: makeFineLayer(main as unknown as HTMLCanvasElement) };
}

function siteOf(k: number): FineSite {
  return { scale: k, ratio: 1.5, left: 7 };
}

function frame(over: Partial<FineFrame> = {}): FineFrame {
  return { layout: LAYOUT, width: W, turn: 0.4, lean: 0, ...over };
}

function canvasesOf(main: FakeCanvas): { shapes: FakeCanvas; fronts: FakeCanvas } {
  const at = page.order.indexOf(main);
  const shapes = page.order[at + 1];
  const fronts = page.order[at + 2];
  if (shapes === undefined || fronts === undefined) throw new Error('the layers are not on the page');
  return { shapes, fronts };
}

/** Draws one frame on a fresh layer and returns the shapes canvas. */
function drawOnce(k: number, over: Partial<FineFrame> & { santaTimeMs?: number }): { shapes: FakeCanvas; fronts: FakeCanvas } {
  const { main, layer } = setup();
  layer.draw(frame(over), siteOf(k));
  return canvasesOf(main);
}

/** Santa's step in the list for a turn and time. */
function santaOf(turn: number, time: number): SantaDraw {
  const step = shapeDrawList(turn, globeShapes, time).find((s): s is SantaDraw => 'sprite' in s);
  if (step === undefined) throw new Error('no Santa in the list');
  return step;
}

/** Santa alone, painted by the CPU renderer at zoom k over the whole picture, as the layer's box expects it (0 where he is not). */
function reference(turn: number, time: number, k: number): Uint32Array {
  const picture = new Uint32Array(W * k * H * k).fill(NO_FRONT);
  renderDrawList(picture, W, LAYOUT, [santaOf(turn, time)], k);
  const out = new Uint32Array(BW * k * BH * k);
  for (let y = 0; y < BH * k; y++) {
    for (let x = 0; x < BW * k; x++) {
      const c = picture[(BOX.top * k + y) * W * k + BOX.left * k + x] ?? NO_FRONT;
      out[y * BW * k + x] = c === NO_FRONT ? 0 : (0xff000000 | c) >>> 0;
    }
  }
  return out;
}

function count(words: Uint32Array): number {
  return words.reduce((n, w) => n + (w === 0 ? 0 : 1), 0);
}

const CASES: [turn: number, time: number][] = [
  [0.4, 1500],
  [2.1, 7300],
  [5.0, 12100],
  [3.3, 20450],
];

describe('the fine layer paints Santa as the CPU renderer does', () => {
  for (const k of [2, 3]) {
    for (const [turn, time] of CASES) {
      it(`zoom ${k}, turn ${turn}, ${time} ms: the shapes canvas holds exactly the reference's Santa pixels`, () => {
        const want = reference(turn, time, k);
        expect(count(want), 'the fixture shows Santa').toBeGreaterThan(0);
        const { shapes } = drawOnce(k, { turn, santaTimeMs: time });
        expect([shapes.width, shapes.height]).toEqual([BW * k, BH * k]);
        const got = shapes.ink();
        const bad = got.findIndex((w, i) => w !== want[i]);
        expect(bad, `first differing device pixel (x ${bad % (BW * k)}, y ${Math.floor(bad / (BW * k))})`).toBe(-1);
      });
    }
  }

  it('draws only whole master colours, never a blend', () => {
    const colours = new Set(masterColours.map((c) => (0xff000000 | Number.parseInt(c.slice(1), 16)) >>> 0));
    const { shapes } = drawOnce(3, { turn: 2.1, santaTimeMs: 7300 });
    const odd = [...shapes.ink()].filter((w) => w !== 0 && !colours.has(w));
    expect(count(shapes.ink())).toBeGreaterThan(0);
    expect(odd).toEqual([]);
  });

  it('puts no ink outside the glass', () => {
    const k = 3;
    const { cx, cy, radius } = LAYOUT.globe;
    for (const [turn, time] of CASES) {
      const { shapes } = drawOnce(k, { turn, santaTimeMs: time });
      const ink = shapes.ink();
      let outside = 0;
      for (let y = 0; y < BH * k; y++) {
        for (let x = 0; x < BW * k; x++) {
          if (ink[y * BW * k + x] === 0) continue;
          const dx = (BOX.left * k + x + 0.5) / k - cx;
          const dy = (BOX.top * k + y + 0.5) / k - cy;
          if (dx * dx + dy * dy > radius * radius) outside++;
        }
      }
      expect(count(ink), `Santa is painted at turn ${turn}, ${time} ms`).toBeGreaterThan(0);
      expect(outside, `turn ${turn}, ${time} ms`).toBe(0);
    }
  });

  it('paints no Santa when the frame has no time', () => {
    const { shapes } = drawOnce(3, { turn: 2.1 });
    expect(count(shapes.ink())).toBe(0);
  });

  it('paints the same faces with or without Santa', () => {
    const faces = (over: { santaTimeMs?: number }): number[][] => {
      page = new FakeDocument();
      (globalThis as { document?: unknown }).document = page;
      const { shapes } = drawOnce(3, { turn: 2.1, ...over });
      return page.ops.filter((o) => o.canvas === shapes && o.kind === 'face').map((o) => [...o.matrix, ...o.args]);
    };
    const without = faces({});
    expect(without.length).toBeGreaterThan(0);
    expect(faces({ santaTimeMs: 7300 })).toEqual(without);
  });

  it('draws him at the new time on a redraw of the same turn, and clears him when the time goes', () => {
    const { main, layer } = setup();
    const k = 2;
    layer.draw(frame({ turn: 2.1, santaTimeMs: 1500 }), siteOf(k));
    const { shapes } = canvasesOf(main);
    expect([...shapes.ink()]).toEqual([...reference(2.1, 1500, k)]);
    layer.draw(frame({ turn: 2.1, santaTimeMs: 4100 }), siteOf(k));
    expect([...shapes.ink()], 'the second time replaces the first, with no trail').toEqual([...reference(2.1, 4100, k)]);
    layer.draw(frame({ turn: 2.1 }), siteOf(k));
    expect(count(shapes.ink())).toBe(0);
  });

  it('leaves the flakes-in-front canvas free of Santa: only the flakes in front are on it', () => {
    const k = 3;
    const flake: SnowStep = { x: 0, y: 0, colour: 0xffffff, shape: [[0, 0]], depth: 20 };
    const { fronts } = drawOnce(k, { turn: 2.1, santaTimeMs: 7300, snowFront: [flake] });
    expect(count(fronts.ink())).toBe(flakeSize(k) ** 2);
    const empty = drawOnce(k, { turn: 2.1, santaTimeMs: 7300 });
    expect(count(empty.fronts.ink())).toBe(0);
  });

  it('orders the flakes round him: those behind first on the shapes canvas, under the faces and him, those in front on the canvas over it', () => {
    const k = 3;
    const behind: SnowStep = { x: 0, y: 0, colour: 0xaebcf0, shape: [[0, 0]], depth: -20 };
    const front: SnowStep = { x: 0, y: 0, colour: 0xffffff, shape: [[0, 0]], depth: 20 };
    const { shapes, fronts } = drawOnce(k, { turn: 2.1, santaTimeMs: 7300, snowBehind: [behind], snowFront: [front] });
    const onShapes = page.ops.filter((o) => o.canvas === shapes);
    const first = onShapes[0];
    expect(first?.kind, 'the flakes behind are the first thing on the shapes canvas').toBe('ink');
    expect(onShapes.some((o) => o.kind === 'face'), 'faces follow').toBe(true);
    expect(onShapes.filter((o) => o.kind === 'ink').length, 'Santa follows the flakes').toBeGreaterThanOrEqual(2);
    expect(page.ops.filter((o) => o.canvas === fronts).every((o) => o.kind === 'ink')).toBe(true);
    const lastOnShapes = Math.max(...onShapes.map((o) => o.seq));
    const firstOnFronts = Math.min(...page.ops.filter((o) => o.canvas === fronts).map((o) => o.seq));
    expect(firstOnFronts, 'the flakes in front are drawn after everything on the shapes canvas').toBeGreaterThan(lastOnShapes);
    expect(page.order.indexOf(fronts), 'and sit over it in the page').toBeGreaterThan(page.order.indexOf(shapes));
  });

  it('shears him with the shapes: every row moves by its own whole art-pixel shift, as rowShift gives', () => {
    const k = 2;
    const lean = 0.3;
    const turn = 2.1;
    const time = 7300;
    const upright = reference(turn, time, k);
    const { shapes } = drawOnce(k, { turn, lean, santaTimeMs: time });
    const got = shapes.ink();
    const bw = BW * k;
    const bad: string[] = [];
    for (let y = 0; y < BH * k; y++) {
      const shift = rowShift(lean, BOX.bottom, BOX.top + Math.floor(y / k)) * k;
      for (let x = 0; x < bw; x++) {
        const from = x - shift;
        const want = from < 0 || from >= bw ? 0 : (upright[y * bw + from] ?? 0);
        if (got[y * bw + x] !== want) bad.push(`${x},${y}`);
      }
    }
    expect(count(upright)).toBeGreaterThan(0);
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('the fine layer orders Santa among the faces by the draw list', () => {
  /** Where Santa sits among the shapes' faces in the list: how many faces come before him, and how many in all. */
  function slot(turn: number, time: number): { before: number; faces: number } {
    const list: DrawStep[] = shapeDrawList(turn, globeShapes, time);
    const at = list.findIndex((s) => 'sprite' in s);
    return { before: at, faces: list.length - 1 };
  }

  /** The first (turn, time) in a search whose Santa has at least `min` and at most `max` faces before him (max as a share of all faces, when fractional), or undefined. */
  function find(pick: (s: { before: number; faces: number }) => boolean): [number, number] | undefined {
    for (let turn = 0.1; turn < 6.3; turn += 0.37) {
      for (let time = 0; time < 40_000; time += 700) {
        if (pick(slot(turn, time))) return [turn, time];
      }
    }
    return undefined;
  }

  /** Face ops on the shapes canvas, in order, and the Santa ink ops there. */
  function opsOf(turn: number, time: number): { faces: Op[]; ink: Op[]; steps: FaceDraw[] } {
    page = new FakeDocument();
    (globalThis as { document?: unknown }).document = page;
    const { shapes } = drawOnce(3, { turn, santaTimeMs: time });
    const steps = shapeDrawList(turn, globeShapes, time).filter((s): s is FaceDraw => !('sprite' in s));
    return { faces: page.ops.filter((o) => o.canvas === shapes && o.kind === 'face'), ink: page.ops.filter((o) => o.canvas === shapes && o.kind === 'ink'), steps };
  }

  /**
   * The seq of the last face op of each step before Santa, and of the first of each step after him. A face is
   * told by its transform: the footprint of its drawing, within a pixel of art, as the layer's own tests do.
   */
  function around(turn: number, time: number, k = 3): { lastBefore: number; firstAfter: number; ink: number[] } {
    const { faces, ink, steps } = opsOf(turn, time);
    const list = shapeDrawList(turn, globeShapes, time);
    const at = list.findIndex((s) => 'sprite' in s);
    const ox = (LAYOUT.globe.cx - BOX.left) * k;
    const oy = (LAYOUT.globe.cy - BOX.top) * k;
    const seqOf = (step: FaceDraw): number[] =>
      faces
        .filter((o) => {
          const { a, b, d, drawing } = step;
          const [ax, ay, bx, by] = [(b[0] - a[0]) / drawing.width, (b[1] - a[1]) / drawing.width, (d[0] - a[0]) / drawing.height, (d[1] - a[1]) / drawing.height];
          // The bitmap's origin is one drawing pixel up and left of the face's corner (its pad).
          const want = [k * ax, k * ay, k * bx, k * by, ox + k * (a[0] - ax - bx), oy + k * (a[1] - ay - by)];
          return near(o.matrix, want);
        })
        .map((o) => o.seq);
    const before = steps.slice(0, at).flatMap(seqOf);
    const after = steps.slice(at).flatMap(seqOf);
    return { lastBefore: before.length === 0 ? -1 : Math.max(...before), firstAfter: after.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...after), ink: ink.map((o) => o.seq) };
  }

  const fixtures: [string, (all: { before: number; faces: number }[]) => number][] = [
    ['farthest back he goes', (all) => all.reduce((m, s, i) => (s.before < (all[m] as { before: number }).before ? i : m), 0)],
    ['farthest forward he goes', (all) => all.reduce((m, s, i) => (s.before > (all[m] as { before: number }).before ? i : m), 0)],
  ];

  for (const [name, choose] of fixtures) {
    it(`paints him after the faces of the shapes behind him and before those in front of him, at ${name}`, () => {
      const moments: [number, number][] = [];
      for (let turn = 0.1; turn < 6.3; turn += 0.37) for (let time = 0; time < 40_000; time += 700) moments.push([turn, time]);
      const at = moments[choose(moments.map(([turn, time]) => slot(turn, time)))] as [number, number];
      const { lastBefore, firstAfter, ink } = around(at[0], at[1]);
      expect(lastBefore, 'faces of shapes behind him are found').toBeGreaterThanOrEqual(0);
      expect(firstAfter, 'faces of shapes in front of him are found').toBeLessThan(Number.POSITIVE_INFINITY);
      expect(ink.length, 'he is painted').toBeGreaterThan(0);
      for (const seq of ink) {
        expect(seq, 'after the shapes behind him').toBeGreaterThan(lastBefore);
        expect(seq, 'before the shapes in front of him').toBeLessThan(firstAfter);
      }
    });
  }
});
