// XMAS-84: flakes bigger than one pixel. renderSnowSteps draws each shape
// point as a size x size square (top-left at the snapped pixel); flakeSize
// picks the side from the fine layer's zoom.
import { describe, expect, it } from 'vitest';
import { sceneLayout } from '../../src/scene/frame.ts';
import { flakeSize, renderSnowSteps, type SnowStep } from '../../src/scene/snow-draw-list.ts';

const W = 240;
const H = 180;
const LAYOUT = sceneLayout(W, H, 777);
const CX = LAYOUT.globe.cx;
const CY = LAYOUT.globe.cy;
const WHITE = 0xffffff;
const RED = 0xff0000;
const PLUS: SnowStep['shape'] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

function step(x: number, y: number, colour = WHITE, shape: SnowStep['shape'] = [[0, 0]]): SnowStep {
  return { x, y, colour, shape, depth: 1 };
}
function render(steps: SnowStep[], zoom: number, size?: number): Uint32Array {
  const picture = new Uint32Array(W * zoom * H * zoom);
  if (size === undefined) renderSnowSteps(picture, W, LAYOUT, steps, zoom);
  else renderSnowSteps(picture, W, LAYOUT, steps, zoom, size);
  return picture;
}
function lit(picture: Uint32Array, zoom: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  picture.forEach((c, i) => {
    if (c !== 0) out.push([i % (W * zoom), Math.floor(i / (W * zoom)), c]);
  });
  return out;
}
function square(x: number, y: number, size: number, colour = WHITE): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push([x + i, y + j, colour]);
  return out;
}
const byPlace = (a: number[], b: number[]): number => (a[1] ?? 0) - (b[1] ?? 0) || (a[0] ?? 0) - (b[0] ?? 0);

describe('renderSnowSteps: size', () => {
  const steps = [step(3, -2), step(-5.5, 4, RED, PLUS)];

  for (const zoom of [1, 3]) {
    it(`size 1 equals the default at zoom ${zoom}`, () => {
      expect(render(steps, zoom, 1)).toEqual(render(steps, zoom));
    });
  }

  for (const size of [2, 3]) {
    it(`size ${size} is a ${size}x${size} square with its top-left at the snapped pixel`, () => {
      const zoom = 4;
      const got = lit(render([step(3.75, -2.5)], zoom, size), zoom);
      expect(got).toEqual(square(Math.floor((CX + 3.75) * zoom), Math.floor((CY - 2.5) * zoom), size));
    });
  }

  it('clips a square at the right and bottom edges of the picture', () => {
    const zoom = 2;
    const side = W * zoom;
    const rows = H * zoom;
    const got = lit(render([step(W - CX - 0.25, H - CY - 0.25)], zoom, 3), zoom);
    const x = Math.floor((CX + W - CX - 0.25) * zoom);
    const y = Math.floor((CY + H - CY - 0.25) * zoom);
    expect(got).toEqual(square(x, y, 3).filter(([px, py]) => px < side && py < rows));
    expect(got.length).toBeLessThan(9);
    expect(got.length).toBeGreaterThan(0);
  });

  it('clips a square at the left and top edges without wrapping onto the other side', () => {
    const zoom = 2;
    const got = lit(render([step(-CX - 0.5, -CY - 0.5)], zoom, 3), zoom);
    // Top-left is at (-1, -1): only the 2x2 inside shows, at the corner.
    expect(got.sort(byPlace)).toEqual(square(0, 0, 2));
  });

  it('draws nothing for a square wholly off the picture', () => {
    expect(lit(render([step(-CX - 10, 0), step(0, H), step(W, 0)], 2, 3), 2)).toEqual([]);
  });

  it('a later step overwrites an earlier one where their squares overlap', () => {
    const zoom = 2;
    const got = lit(render([step(0, 0, WHITE), step(0.5, 0, RED)], zoom, 3), zoom);
    const x = CX * zoom;
    const y = CY * zoom;
    const want = new Map<string, number>();
    for (const [px, py] of square(x, y, 3)) want.set(`${px},${py}`, WHITE);
    for (const [px, py] of square(x + 1, y, 3)) want.set(`${px},${py}`, RED);
    expect(got.map(([px, py, c]) => [`${px},${py}`, c])).toEqual(expect.arrayContaining([...want]));
    expect(got).toHaveLength(want.size);
    expect(got.find(([px, py]) => px === x + 1 && py === y)?.[2]).toBe(RED);
    expect(got.find(([px, py]) => px === x && py === y)?.[2]).toBe(WHITE);
  });

  it('draws tumble arms as size squares joined to the centre, spaced by the size', () => {
    const zoom = 4;
    const size = 3;
    const x = Math.floor(CX * zoom);
    const y = Math.floor(CY * zoom);
    const got = lit(render([step(0, 0, WHITE, PLUS)], zoom, size), zoom);
    const want = new Map<string, number>();
    for (const [dx, dy] of PLUS) for (const [px, py] of square(x + dx * size, y + dy * size, size)) want.set(`${px},${py}`, WHITE);
    expect(got).toHaveLength(want.size);
    for (const [px, py] of got) expect(want.has(`${px},${py}`)).toBe(true);
    // Joined: the plus is one connected block, 3 squares wide and tall through the centre.
    expect(got).toHaveLength(5 * size * size);
    for (let i = -size; i < 2 * size; i++) {
      expect(want.has(`${x + i},${y + 1}`)).toBe(true);
      expect(want.has(`${x + 1},${y + i}`)).toBe(true);
    }
  });

  it('keeps arms spaced by the zoom when the size is 1', () => {
    const zoom = 3;
    const x = Math.floor(CX * zoom);
    const y = Math.floor(CY * zoom);
    const got = lit(render([step(0, 0, WHITE, PLUS)], zoom, 1), zoom).sort(byPlace);
    expect(got).toEqual(PLUS.map(([dx, dy]) => [x + dx * zoom, y + dy * zoom, WHITE]).sort(byPlace));
  });

  for (const size of [0, 1.5, -1, Number.NaN]) {
    it(`throws a RangeError for size ${size}`, () => {
      expect(() => render([step(0, 0)], 2, size)).toThrow(RangeError);
    });
  }

  it('leaves the picture untouched when the size is invalid', () => {
    const picture = new Uint32Array(W * H);
    expect(() => renderSnowSteps(picture, W, LAYOUT, [step(0, 0)], 1, 0)).toThrow(RangeError);
    expect(picture.every((c) => c === 0)).toBe(true);
  });
});

describe('flakeSize', () => {
  it('is 2 at zoom 1', () => {
    expect(flakeSize(1)).toBe(2);
  });

  it('is at least 4, and the zoom once it is above that, for zoom 2..12', () => {
    for (let zoom = 2; zoom <= 12; zoom++) expect(flakeSize(zoom), `zoom ${zoom}`).toBe(Math.max(4, zoom));
  });

  for (const zoom of [0, -1, 1.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`throws a RangeError for zoom ${zoom}`, () => {
      expect(() => flakeSize(zoom)).toThrow(RangeError);
    });
  }
});
