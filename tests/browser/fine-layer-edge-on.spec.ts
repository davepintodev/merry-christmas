// XMAS-87 "Faces seen nearly edge-on stay thin on the fine layer".
//
// The real fine layer (src/page/fine-layer.ts, bundled for the page by vite) draws on a real browser canvas at 5 screen
// pixels to the art pixel, and its pixels are compared with the CPU renderer's (renderDrawList + renderShadowSteps at zoom 5):
//   extra:   a drawn screen pixel with no CPU-covered pixel within one screen pixel (the stretched column, the dark sliver);
//   missing: a screen pixel inside the CPU's solid art that the layer leaves clear or part clear;
//   wrong:   one inside it with another colour.
import { build } from 'vite';
import { expect, test, type Page } from '@playwright/test';
import { leanBox } from '../../src/scene/lean.ts';
import { sceneLayout } from '../../src/scene/frame.ts';
import { pagePixels } from '../../src/page/pixel.ts';
import { renderDrawList, renderShadowSteps, shadowDrawList, shapeDrawList } from '../../src/scene/shape-draw-list.ts';
import { globeShapes, type GlobeShape } from '../../src/scene/shapes.ts';

const SEED = 1; // src/page/scene.ts
let K = 5; // screen pixels to the art pixel: 5 for the reference pictures with the fine layer; the scale tests below set 2 and 3
const { width, height } = pagePixels({ width: 800, height: 600 }, 1);
const layout = sceneLayout(width, height, SEED);
const box = leanBox(width, layout);
const bw = box.right - box.left + 1;
const bh = box.bottom - box.top;
const TOLERANCE = 0.002; // of the covered screen pixels
const MISSING_LIMIT = 0; // seams inside solid art are never allowed; only the outer outline may soften
const TINT = 40; // per channel: an edge pixel of the layer blends a little differently from the CPU's

let bundle = '';
test.beforeAll(async () => {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'src/page/fine-layer.ts', formats: ['iife'], name: 'FineLayer' } },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []));
  const chunk = outputs.find((o) => o.type === 'chunk');
  bundle = chunk !== undefined && 'code' in chunk ? chunk.code : '';
  expect(bundle.length, 'the fine layer bundled for the page').toBeGreaterThan(0);
});

async function openPage(page: Page): Promise<void> {
  await page.setContent('<canvas id="main"></canvas>');
  await page.addScriptTag({ content: bundle });
}

/** The layer's shapes canvas for one turn, as RGBA over the box at 5 screen pixels to the art pixel. */
async function fineRgba(page: Page, turn: number): Promise<Uint8Array> {
  const base64 = await page.evaluate(
    ({ frame, k }) => {
      const main = document.querySelector<HTMLCanvasElement>('#main')!;
      const w = window as unknown as { FineLayer: { makeFineLayer: (c: HTMLCanvasElement) => { draw: (f: unknown, s: unknown) => boolean } } };
      const layer = ((window as unknown as { layer?: ReturnType<typeof w.FineLayer.makeFineLayer> }).layer ??= w.FineLayer.makeFineLayer(main));
      if (!layer.draw(frame, { scale: k, ratio: 1, left: 0 })) throw new Error('no 2d context');
      const shapes = main.nextElementSibling!.nextElementSibling as HTMLCanvasElement;
      const data = shapes.getContext('2d')!.getImageData(0, 0, shapes.width, shapes.height).data;
      let binary = '';
      for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
      return btoa(binary);
    },
    { frame: { layout, width, turn, lean: 0 }, k: K },
  );
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** The CPU reference of `shapes` over two fills, so a solid pixel (same on both) is told from a blended or empty one. */
function cpuOver(turn: number, shapes: readonly GlobeShape[]): { black: Uint32Array; white: Uint32Array } {
  const side = width * K;
  const make = (fill: number): Uint32Array => {
    const picture = new Uint32Array(side * layout.height * K).fill(fill);
    renderShadowSteps(picture, width, layout, shadowDrawList(turn, shapes), K);
    renderDrawList(picture, width, layout, shapeDrawList(turn, shapes), K);
    return picture;
  };
  return { black: make(0x000000), white: make(0xffffff) };
}

interface Faults { covered: number; extra: number; missing: number; wrong: number; where: string }

/** Compares the layer's pixels with the CPU's inside the screen window [x0, x1) x [y0, y1) (box coordinates). */
function compare(rgba: Uint8Array, cpu: { black: Uint32Array; white: Uint32Array }, [x0, y0, x1, y1]: [number, number, number, number]): Faults {
  const side = width * K;
  const sw = bw * K;
  const sh = bh * K;
  const at = (x: number, y: number): number => (box.top * K + y) * side + box.left * K + x;
  const covered = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < sw && y < sh && (cpu.black[at(x, y)] !== 0 || cpu.white[at(x, y)] !== 0xffffff);
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < sw && y < sh && cpu.black[at(x, y)] === cpu.white[at(x, y)];
  // Inside one flat colour of the CPU picture: the whole 3x3 around it is that colour, so a face's edge softening cannot show.
  const flat = (x: number, y: number): boolean => near((u, v) => solid(u, v) && cpu.black[at(u, v)] === cpu.black[at(x, y)], true, x, y);
  const near = (f: (x: number, y: number) => boolean, all: boolean, x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (f(x + dx, y + dy) !== all) return !all;
    return all;
  };
  const faults: Faults = { covered: 0, extra: 0, missing: 0, wrong: 0, where: '' };
  const note = (kind: string, x: number, y: number): void => {
    if (faults.where.length < 80) faults.where += `${kind}(${Math.floor(x / K)},${Math.floor(y / K)}) `;
  };
  for (let y = Math.max(0, y0); y < Math.min(sh, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(sw, x1); x++) {
      const i = (y * sw + x) * 4;
      const a = rgba[i + 3] ?? 0;
      if (covered(x, y)) faults.covered++;
      if (a > 0 && !near(covered, false, x, y)) {
        faults.extra++;
        note('extra', x, y);
      } else if (solid(x, y) && flat(x, y)) {
        const c = cpu.black[at(x, y)] as number;
        if (a < 255) {
          faults.missing++;
          note('missing', x, y);
        } else if ([16, 8, 0].some((s, n) => Math.abs((rgba[i + n] ?? 0) - ((c >> s) & 255)) > TINT)) {
          faults.wrong++;
          note('wrong', x, y);
        }
      }
    }
  }
  return faults;
}

/** A shape's window: its own CPU coverage's screen extent, a few art pixels wider so a stretched column still lands in it. */
function windowOf(turn: number, shape: GlobeShape): [number, number, number, number] {
  const cpu = cpuOver(turn, [shape]);
  const side = width * K;
  const pad = 10 * K;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < bh * K; y++) {
    for (let x = 0; x < bw * K; x++) {
      const i = (box.top * K + y) * side + box.left * K + x;
      if (cpu.black[i] === 0 && cpu.white[i] === 0xffffff) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
    }
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function expectSimilar(f: Faults, label: string): void {
  expect(f.missing, `${label}: seams, pixels inside flat CPU art the layer leaves clear or part clear (HEAD had 0); ${f.where}`).toBeLessThanOrEqual(MISSING_LIMIT);
  const bad = f.extra + f.wrong;
  expect(bad, `${label}: ${f.extra} extra, ${f.missing} missing, ${f.wrong} wrong of ${f.covered} covered; ${f.where}`).toBeLessThanOrEqual(f.covered * TOLERANCE);
}

const EDGE_ON = [1.57, 4.71];
const SEAM_TURNS = [6.25, 0.05]; // seams seen at columns 413 and 582

test.describe('near edge-on faces on the fine layer match the CPU renderer', () => {
  for (const turn of [...EDGE_ON, ...SEAM_TURNS]) {
    test(`turn ${turn}: the whole scene matches, with no dark sliver beside the presents and no stretched column`, async ({ page }) => {
      await openPage(page);
      const rgba = await fineRgba(page, turn);
      expect(rgba.length).toBe(bw * K * bh * K * 4);
      expectSimilar(compare(rgba, cpuOver(turn, globeShapes), [0, 0, bw * K, bh * K]), `turn ${turn}`);
    });
  }

  for (const turn of EDGE_ON) {
    test(`turn ${turn}: each shape (present, house, pines, lamp) stays inside its art-grid outline`, async ({ page }) => {
      await openPage(page);
      const rgba = await fineRgba(page, turn);
      const whole = cpuOver(turn, globeShapes);
      for (const shape of globeShapes) expectSimilar(compare(rgba, whole, windowOf(turn, shape)), `turn ${turn}, ${shape.kind}`);
    });
  }

  // The clip margins are screen pixels converted by the scale, so other integer scales are checked with the same fractions.
  for (const k of [2, 3]) {
    for (const turn of [...EDGE_ON, 6.25]) {
      test(`scale ${k}, turn ${turn}: the whole scene matches the CPU renderer at the same scale`, async ({ page }) => {
        K = k;
        try {
          await openPage(page);
          const rgba = await fineRgba(page, turn);
          expect(rgba.length).toBe(bw * K * bh * K * 4);
          expectSimilar(compare(rgba, cpuOver(turn, globeShapes), [0, 0, bw * K, bh * K]), `scale ${k}, turn ${turn}`);
        } finally {
          K = 5;
        }
      });
    }
  }

  test('a turn sweep in fine steps around both edge-on angles, and the full circle, matches the whole scene', async ({ page }) => {
    await openPage(page);
    const turns: number[] = [];
    for (const centre of [Math.PI / 2, (3 * Math.PI) / 2]) for (let d = -0.1; d <= 0.1001; d += 0.02) turns.push(centre + d);
    for (let t = 0; t < 2 * Math.PI; t += 0.3) turns.push(t);
    turns.push(...SEAM_TURNS);
    const failed: string[] = [];
    for (const turn of turns) {
      const f = compare(await fineRgba(page, turn), cpuOver(turn, globeShapes), [0, 0, bw * K, bh * K]);
      if (f.missing > MISSING_LIMIT || f.extra + f.wrong > f.covered * TOLERANCE) failed.push(`${turn.toFixed(3)}: ${f.extra}/${f.missing}/${f.wrong}`);
    }
    expect(failed, 'turns that differ from the CPU picture (extra/missing/wrong)').toEqual([]);
  });
});
