// XMAS-81 "Fine layer on the page: the shapes", in the built page (vite preview of dist/).
//
// Two canvases follow #scene in the page, both at the screen's own pixel size and
// laid exactly over the glass: the shapes, with Santa among them in depth order
// (XMAS-83) and the flakes behind the glass centre under them all (XMAS-84), and
// over it a layer holding only the flakes in front. They are read from the page
// the way a visitor sees them: by their on-screen boxes and their pixels, with no
// test hook.
//
// Alignment is read from the boxes: the layer's left and top land on whole
// device pixels, its canvas pixels are device pixels one to one, and its box
// sits on the art grid where the scene canvas has it (the lean box), at 360x700
// at 2x, 1920x1130 at 1x, a fractional ratio, a narrow overhanging window, and
// after a resize. What the shapes layer drew is read through those boxes: all of
// it lies inside the glass, so a shifted or doubled layer would show outside.
//
// The lean while dragging runs on Playwright's fake clock (as drag.spec.ts does),
// so a leaning picture and the upright picture of the same turn can be compared:
// every row of the leaning shapes is the upright row moved by a whole number of
// art pixels, and those moves are one lean's moves (rowShift of a single lean).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { masterColours } from '../../art/colours.ts';
import { leanBox, rowShift } from '../../src/scene/lean.ts';
import { santaPlacement } from '../../src/scene/santa.ts';
import { sceneLayout } from '../../src/scene/frame.ts';
import { DRAG_SETTINGS } from '../../src/page/drag.ts';
import { pagePixels } from '../../src/page/pixel.ts';
import { shapeDrawList, renderDrawList } from '../../src/scene/shape-draw-list.ts';
import { globeShapes, type GlobeShape } from '../../src/scene/shapes.ts';
import { shapesFarFirst } from '../../src/scene/shapes-draw.ts';
import { drawings } from '../../src/shared/art.generated.ts';

const NOW = '2026-12-01T22:00:00';
const SEED = 1; // src/page/scene.ts
const STEP_MS = 16;
/** The master colour number (1 based) only Santa's trot drawings use; no shape's drawing has it. */
const SANTA_ONLY = 48;

type Rect = { x: number; y: number; width: number; height: number };
type Viewport = { width: number; height: number };

async function openLive(browser: Browser, viewport: Viewport, dpr: number, search = ''): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.goto(`/?now=${NOW}${search}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
  await page.waitForFunction(() => performance.getEntriesByName('globe-ready', 'mark').length > 0, null, { timeout: 10_000 });
  await layersReady(page);
  return { context, page };
}

/** The shapes canvas that follows #scene. */
const SHAPES = "canvas#scene + canvas";
/** The flakes in front, over the shapes and Santa: a screen pixel layer that holds nothing but those flakes (XMAS-84). */
const FRONTS = "canvas#scene + canvas + canvas";

async function layersReady(page: Page): Promise<void> {
  await expect(page.locator(SHAPES)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(FRONTS)).toHaveCount(1);
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas#scene + canvas');
    return c !== null && c.style.width !== '';
  });
}

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

async function sizeOf(page: Page, selector: string): Promise<{ width: number; height: number }> {
  return page.locator(selector).evaluate((el) => ({ width: (el as HTMLCanvasElement).width, height: (el as HTMLCanvasElement).height }));
}

/** Everything the layout says about where the lean box is, in CSS pixels from the scene canvas's top left. */
function expectedBox(viewport: Viewport, dpr: number): { x: number; y: number; width: number; height: number; scale: number; artWidth: number; layout: ReturnType<typeof sceneLayout> } {
  const { scale, width, height } = pagePixels(viewport, dpr);
  const layout = sceneLayout(width, height, SEED);
  const box = leanBox(width, layout);
  const css = scale / dpr;
  return { x: box.left * css, y: box.top * css, width: (box.right - box.left + 1) * css, height: (box.bottom - box.top) * css, scale, artWidth: width, layout };
}

const VIEWPORTS: [string, Viewport, number][] = [
  ['360x700 at 2x', { width: 360, height: 700 }, 2],
  ['1920x1130 at 1x', { width: 1920, height: 1130 }, 1],
  ['1366x768 at a fractional 1.25', { width: 1366, height: 768 }, 1.25],
  ['1024x600 at a fractional 1.5', { width: 1024, height: 600 }, 1.5],
  ['a narrow window, the picture overhanging it (100x400 at 1x)', { width: 100, height: 400 }, 1],
];

/** Checks one page's layers against the scene canvas and the layout, at the viewport and ratio it is in now. */
async function expectLinedUp(page: Page, viewport: Viewport, dpr: number): Promise<void> {
  const scene = await rect(page, 'canvas#scene');
  const shapes = await rect(page, SHAPES);
  const fronts = await rect(page, FRONTS);
  const want = expectedBox(viewport, dpr);
  // On the lean box, where the scene canvas has it.
  // The scene canvas's own offset is a 32-bit transform, so it may be off by a hair of a device pixel.
  expect(Math.abs(shapes.x - scene.x - want.x), 'the shapes layer\'s left on the box').toBeLessThan(0.02);
  expect(Math.abs(shapes.y - scene.y - want.y), 'the shapes layer\'s top on the box').toBeLessThan(0.02);
  // (the browser's layout reports sizes and offsets in 1/64 CSS pixel steps)
  expect(Math.abs(shapes.width - want.width)).toBeLessThan(0.02);
  expect(Math.abs(shapes.height - want.height)).toBeLessThan(0.02);
  // The flakes' layer is the very same box.
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(fronts[key], `front ${key}`).toBeCloseTo(shapes[key], 4);
  // Whole device pixels: no half pixel left or top (which would double or shift every edge).
  for (const v of [shapes.x * dpr, shapes.y * dpr]) expect(Math.abs(v - Math.round(v)), 'whole device pixel').toBeLessThanOrEqual(0.02); // within the layout's 1/64 px steps, so paint snaps it to the same device pixel
  // One canvas pixel per device pixel for the shapes: never stretched or squeezed by the browser.
  const size = await sizeOf(page, SHAPES);
  expect(Math.abs(size.width - shapes.width * dpr)).toBeLessThan(0.05);
  expect(Math.abs(size.height - shapes.height * dpr)).toBeLessThan(0.05);
  expect(size.width % want.scale).toBe(0);
  // The flakes' layer is at the screen's pixel size too.
  const flakes = await sizeOf(page, FRONTS);
  expect(flakes.width).toBe(size.width);
  expect(flakes.height).toBe(size.height);
}

/** The shapes layer's opaque pixels as art-pixel offsets from the globe's centre, read through the layer's on-screen box. */
async function shapePixelsAroundGlobe(page: Page, viewport: Viewport, dpr: number): Promise<{ count: number; farthest: number }> {
  const want = expectedBox(viewport, dpr);
  const scene = await rect(page, 'canvas#scene');
  const shapes = await rect(page, SHAPES);
  const { cx, cy } = want.layout.globe;
  const stride = Math.max(1, Math.floor(want.scale / 2));
  const found = await page.locator(SHAPES).evaluate((el, s) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const points: number[] = [];
    for (let y = 0; y < c.height; y += s) for (let x = 0; x < c.width; x += s) if ((data[(y * c.width + x) * 4 + 3] ?? 0) > 0) points.push(x, y);
    return points;
  }, stride);
  let farthest = 0;
  for (let i = 0; i < found.length; i += 2) {
    // device pixel -> CSS pixel on the screen -> art pixel from the scene canvas's left and top.
    const ax = (shapes.x + (found[i]! + 0.5) / dpr - scene.x) / (want.scale / dpr);
    const ay = (shapes.y + (found[i + 1]! + 0.5) / dpr - scene.y) / (want.scale / dpr);
    farthest = Math.max(farthest, Math.hypot(ax - cx, ay - cy));
  }
  return { count: found.length / 2, farthest };
}

test.describe('the layer lines up with the glass', () => {
  for (const [name, viewport, dpr] of VIEWPORTS) {
    test(`${name}: both layers sit on the lean box, on whole device pixels, one canvas pixel to the device pixel`, async ({ browser }) => {
      const { context, page } = await openLive(browser, viewport, dpr);
      await expectLinedUp(page, viewport, dpr);
      await context.close();
    });

    test(`${name}: every shape pixel lies inside the glass, so none is shifted or doubled outside it`, async ({ browser }) => {
      const { context, page } = await openLive(browser, viewport, dpr);
      const { count, farthest } = await shapePixelsAroundGlobe(page, viewport, dpr);
      const { layout } = expectedBox(viewport, dpr);
      expect(count, 'the shapes are drawn').toBeGreaterThan(200);
      expect(farthest, 'the farthest shape pixel from the globe\'s centre').toBeLessThanOrEqual(layout.globe.radius);
      await context.close();
    });
  }

  test('the layers keep their place through a resize and a rotation of the window', async ({ browser }) => {
    const { context, page } = await openLive(browser, { width: 800, height: 600 }, 1);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 360, height: 700 }, { width: 700, height: 360 }, { width: 801, height: 599 }, { width: 100, height: 400 }]) {
      await page.setViewportSize(viewport);
      // The next frame lays the layers out for the new window.
      await page.waitForFunction(
        (w) => {
          const c = document.querySelector<HTMLCanvasElement>('canvas#scene');
          return c !== null && Math.abs(c.getBoundingClientRect().width - 0) >= 0 && window.innerWidth === w;
        },
        viewport.width,
      );
      await expect
        .poll(async () => {
          const scene = await rect(page, 'canvas#scene');
          const shapes = await rect(page, SHAPES);
          const want = expectedBox(viewport, 1);
          return Math.abs(shapes.x - scene.x - want.x) < 0.01 && Math.abs(shapes.width - want.width) < 0.01;
        }, { timeout: 5000 })
        .toBe(true);
      await expectLinedUp(page, viewport, 1);
    }
    await context.close();
  });

  test('the shapes layer is over the scene canvas and under the countdown, and never takes the pointer', async ({ browser }) => {
    const { context, page } = await openLive(browser, { width: 800, height: 600 }, 1);
    const info = await page.evaluate(() => {
      const order = [...document.querySelectorAll('canvas')].map((c) => c.id || (c.previousElementSibling?.id ? 'after-' + c.previousElementSibling.id : 'anon'));
      const read = (sel: string) => {
        const el = document.querySelector(sel)!;
        const s = getComputedStyle(el);
        return { position: s.position, pointer: s.pointerEvents, z: s.zIndex, rendering: s.imageRendering };
      };
      return { order, shapes: read('canvas#scene + canvas'), fronts: read('canvas#scene + canvas + canvas'), countdown: read('canvas#countdown') };
    });
    expect(info.order.indexOf('countdown')).toBeGreaterThanOrEqual(0);
    for (const layer of [info.shapes, info.fronts]) {
      expect(layer.position).toBe('fixed');
      expect(layer.pointer).toBe('none');
      expect(layer.rendering).toMatch(/pixelated|crisp-edges/);
      expect(Number(layer.z) || 0).toBeLessThan(Number(info.countdown.z));
    }
    // The pointer still reaches what is under the layers (the scene canvas takes the drag), at the globe's centre.
    const hit = await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.5)?.id ?? '');
    expect(['scene', 'countdown']).toContain(hit);
    await context.close();
  });
});

// ---- the fake-clock part: dragging ----

async function boot(browser: Browser, viewport: Viewport, search = ''): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(2026, 11, 1, 22, 0, 0) });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/[^/]+\.m?js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/?now=${NOW}${search}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
  await page.clock.pauseAt(new Date(2026, 11, 1, 22, 0, 30));
  release();
  await page.waitForTimeout(300);
  for (let k = 0; k < 400 && (await page.locator(SHAPES).count()) === 0; k++) {
    await page.clock.runFor(STEP_MS);
    await page.waitForTimeout(20);
  }
  expect(await page.locator(SHAPES).count(), 'the layers arrived').toBe(1);
  await idle(page, 400);
  return { context, page };
}

async function idle(page: Page, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += STEP_MS) await page.clock.runFor(STEP_MS);
}

/**
 * The shapes layer's rows, one string per art row of the layer, sampled on the middle device row of the row's band.
 * A cell is '.' where nothing is drawn, its hex colour where it is one of the shapes' own colours (matched exactly), and '*'
 * where it is a colour the flakes (white and the dim blue) or Santa can put on the layer, or a blend with one (XMAS-84): those are
 * the cells that move on their own clock behind the glass.
 */
async function shapeRows(page: Page, scale: number): Promise<string[]> {
  /** The colours the named drawings use, as numbers (a drawing's pixels are a Uint8Array, so this is a loop, not a map). */
  const coloursOf = (names: string[]): number[] => {
    const out: number[] = [];
    for (const name of names) {
      for (const pixel of drawings[name]?.pixels ?? []) if (pixel > 0) out.push(Number.parseInt(masterColours[pixel - 1]!.slice(1), 16));
    }
    return out;
  };
  const movable = [0xffffff, 0xaebcf0, ...coloursOf(['santa-trot-1', 'santa-trot-2'])];
  // Only the shapes' own colours are kept exact; the flakes' two colours and Santa's are movable even where a shape's drawing uses them
  // too (a flake or Santa behind the glass over such a shape pixel cannot be told from it, and the other colours of the row still pin
  // the shear). Any other colour is a shape edge's blend over him or a flake (a face's antialiased edge over a behind pixel), so it too is movable.
  const own = [...new Set(coloursOf(Object.keys(drawings).filter((name) => !name.startsWith('santa-'))))].filter((c) => !movable.includes(c));
  return page.locator(SHAPES).evaluate(
    (el, { k, own }) => {
      const c = el as HTMLCanvasElement;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const rows: string[] = [];
      for (let band = 0; band < c.height / k; band++) {
        const y = band * k + (k >> 1);
        const cells: string[] = [];
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if ((data[i + 3] ?? 0) === 0) {
            cells.push('.');
            continue;
          }
          const colour = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
          cells.push(own.includes(colour) ? colour.toString(16) : '*');
        }
        rows.push(cells.join(','));
      }
      return rows;
    },
    { k: scale, own },
  );
}

/** Whether two rows agree cell for cell, a '*' cell (a flake, Santa or a blend) agreeing with any. */
function sameRow(a: string, b: string): boolean {
  const x = a.split(',');
  const y = b.split(',');
  return x.length === y.length && x.every((c, i) => c === y[i] || c === '*' || y[i] === '*');
}

/** The whole art-pixel shifts s at which a leaning row is the upright row moved by s art pixels, over the pixels both show; a '*' cell (a flake) matches any cell. */
function fits(lean: string, upright: string, scale: number): number[] {
  const l = lean.split(',');
  const u = upright.split(',');
  if (u.filter((c) => c !== '.').length < 20) return []; // too little shape to tell a shift from none
  const out: number[] = [];
  for (let s = -60; s <= 60; s++) {
    let overlap = 0;
    let ok = true;
    for (let x = 0; x < l.length && ok; x++) {
      const from = x - s * scale;
      if (from < 0 || from >= u.length) continue;
      overlap++;
      if (l[x] !== u[from] && l[x] !== '*' && u[from] !== '*') ok = false;
    }
    if (ok && overlap > l.length / 2) out.push(s);
  }
  return out;
}

test.describe('the layer follows the lean while dragging', () => {
  test('just after a fast drag every row of the shapes is the upright row moved a whole number of art pixels, by one lean; later it is upright again', async ({ browser }) => {
    const viewport = { width: 800, height: 600 };
    const { scale, width, height } = pagePixels(viewport, 1);
    const layout = sceneLayout(width, height, SEED);
    const box = leanBox(width, layout);
    const { context, page } = await boot(browser, viewport);
    const scene = await rect(page, 'canvas#scene');
    const from = { x: scene.x + layout.globe.cx * scale, y: scene.y + layout.globe.cy * scale };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) {
      await page.mouse.move(from.x + (60 * scale * k) / 6, from.y);
      await page.clock.runFor(STEP_MS);
    }
    await page.mouse.up();
    await idle(page, 50);
    const leaning = await shapeRows(page, scale);
    await idle(page, 9000);
    const upright = await shapeRows(page, scale);
    expect(leaning).toHaveLength(box.bottom - box.top);
    expect(upright).toHaveLength(leaning.length);
    // The turn is the same at both moments (the release has settled), so only the lean differs. Find one lean that moves every row.
    // Santa flies between the two captures and is painted on this canvas, sheared with the shapes: leave out the art rows he can be on
    // (his whole orbit's reach of y, his 12 rows tall, and the bob) rather than any shape row.
    let santaTop = Infinity;
    let santaBottom = -Infinity;
    for (let a = 0; a < 64; a++) {
      const y = layout.globe.cy + santaPlacement(a * ((2 * Math.PI) / 64) - 2, 0).y;
      santaTop = Math.min(santaTop, y);
      santaBottom = Math.max(santaBottom, y);
    }
    const santaRow = (y: number): boolean => y >= santaTop - 6 - 3 && y <= santaBottom + 6 + 3;
    const rows = leaning.map((row, n) => ({ y: box.top + n, shifts: fits(row, upright[n] ?? '', scale) })).filter((r) => r.shifts.length > 0 && !santaRow(r.y));
    expect(rows.length, 'rows with shape pixels to compare').toBeGreaterThan(30);
    const inexact = leaning.map((row, n) => ({ n, has: (upright[n] ?? '').split(',').filter((c) => c !== '.').length >= 20 })).filter((r) => r.has && !santaRow(box.top + r.n) && !rows.some((x) => x.y === box.top + r.n));
    expect(inexact.map((r) => r.n), 'rows that are not the upright row moved by whole art pixels').toEqual([]);
    // A row's whole shift holds over a lean window 1 / (its height above the ground line) wide, so the rows near the top
    // (about 70 art px up) leave a window under 0.0005 wide: the search steps finer than that.
    let found: number | null = null;
    for (let lean = -0.5; lean <= 0.5 && found === null; lean += 0.00005) {
      if (Math.abs(lean) < 0.02) continue;
      if (rows.every((r) => r.shifts.includes(rowShift(lean, box.bottom, r.y)))) found = lean;
    }
    expect(found, 'one lean that explains every row\'s move').not.toBeNull();
    // And it really leans: the highest rows have moved at least two art pixels.
    const highest = rows[0]!;
    expect(Math.abs(rowShift(found!, box.bottom, highest.y))).toBeGreaterThanOrEqual(2);
    // Settled, the layer is upright: every row is its own upright row.
    await idle(page, 4000);
    const settled = await shapeRows(page, scale);
    expect(settled.filter((row, n) => !sameRow(row, upright[n] ?? '') && !santaRow(box.top + n)).length).toBeLessThanOrEqual(2);
    await context.close();
  });
});

test.describe('the front snow shows in front of the shapes and Santa', () => {
  test('after a flick the front layer holds opaque white snow, and only fully opaque or fully clear pixels', async ({ browser }) => {
    const viewport = { width: 800, height: 600 };
    const { scale, width, height } = pagePixels(viewport, 1);
    const layout = sceneLayout(width, height, SEED);
    const { context, page } = await boot(browser, viewport);
    const scene = await rect(page, 'canvas#scene');
    const from = { x: scene.x + layout.globe.cx * scale, y: scene.y + layout.globe.cy * scale };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) {
      await page.mouse.move(from.x + (60 * scale * k) / 6, from.y);
      await page.clock.runFor(STEP_MS);
    }
    await page.mouse.up();
    await idle(page, 400);
    const counts = await page.locator(FRONTS).evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let white = 0;
      let opaque = 0;
      let partial = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        if (a === 255) {
          opaque++;
          if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) white++;
        } else if (a !== 0) partial++;
      }
      return { white, opaque, partial };
    });
    expect(counts.partial, 'no half-transparent pixel: flakes are hard blocks').toBe(0);
    expect(counts.opaque, 'something is drawn in front of the shapes').toBeGreaterThan(0);
    expect(counts.white, 'the front snow is white').toBeGreaterThan(0);
    await context.close();
  });

  test('Santa is on the shapes canvas at some moment of his flight, and the front canvas has none of his colours', async ({ browser }) => {
    const { context, page } = await boot(browser, { width: 800, height: 600 });
    // The master colour only Santa's two trot drawings use (no shape's drawing has it), as 0xRRGGBB.
    const santaColour = Number.parseInt(masterColours[SANTA_ONLY - 1]!.slice(1), 16);
    const countOf = (selector: string): Promise<number> =>
      page.locator(selector).evaluate((el, colour) => {
        const c = el as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        const [r, g, b] = [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];
        let n = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] === r && data[i + 1] === g && data[i + 2] === b && data[i + 3] === 255) n++;
        return n;
      }, santaColour);
    let onShapes = 0;
    let onFront = 0;
    for (let t = 0; t < 40 && onShapes === 0; t++) {
      await idle(page, 500);
      onShapes = Math.max(onShapes, await countOf(SHAPES));
      onFront = Math.max(onFront, await countOf(FRONTS));
    }
    expect(onShapes, 'Santa drew on the shapes canvas within 20 s').toBeGreaterThan(0);
    expect(onFront, 'the front canvas holds the snow in front, not Santa').toBe(0);
    await context.close();
  });
});

test.describe('?perf reports the layer\'s cost', () => {
  test('the readout has a "fine layer" row, a number of milliseconds, next to the scene draw row', async ({ browser }) => {
    const { context, page } = await openLive(browser, { width: 1280, height: 720 }, 1, '&perf');
    await expect(page.locator('#perf-readout')).toBeVisible({ timeout: 10_000 });
    const row = page.locator('#perf-readout [data-perf="fine-layer"]');
    await expect(row, 'a fine layer row in the readout').toHaveCount(1);
    await expect.poll(async () => (await row.textContent()) ?? '', { timeout: 10_000 }).toMatch(/^\d+(\.\d+)? ms$/);
    await expect(page.locator('#perf-readout')).toContainText('fine layer');
    // The layer's cost is part of the scene draw's, not more than it.
    const num = async (key: string): Promise<number> => Number(/-?\d+(?:\.\d+)?/.exec((await page.locator(`#perf-readout [data-perf="${key}"]`).textContent()) ?? '')?.[0]);
    await expect.poll(async () => (await num('fine-layer')) <= (await num('work')) + 0.5, { timeout: 5000 }).toBe(true);
    await context.close();
  });

  test('the worst frame stays inside the smoothness rule (50 ms) while the layer runs', async ({ browser }) => {
    const { context, page } = await openLive(browser, { width: 1280, height: 720 }, 1, '&perf');
    await expect(page.locator('#perf-readout')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(6000);
    const text = (await page.locator('#perf-readout [data-perf="worst-frame"]').textContent()) ?? '';
    const worst = Number(/\d+(?:\.\d+)?/.exec(text)?.[0]);
    expect(worst).toBeGreaterThan(0);
    expect(worst, `worst frame ${text}`).toBeLessThanOrEqual(50);
    await context.close();
  });
});

// ---- no seams: the faces meet without a half-clear pixel between them ----

/**
 * The art cells where a seam inside the house counts, at one turn: the cells of the house's faces
 * (their draw list rendered on the CPU at zoom 1) left after shrinking the union one art pixel
 * from its outer silhouette, and not within one art pixel of any shape drawn after (in front of) the house.
 * Cells are picture coordinates, one byte each over the picture's width x height.
 */
function houseCells(turn: number, width: number, layout: ReturnType<typeof sceneLayout>): { cells: Uint8Array; inner: number } {
  const height = layout.height;
  const mask = (shapes: readonly GlobeShape[]): Uint8Array => {
    const out = new Uint8Array(width * height);
    // Two backgrounds, so a face colour of 0 still shows as drawn.
    const a = new Uint32Array(width * height);
    const b = new Uint32Array(width * height).fill(0xffffff);
    const steps = shapeDrawList(turn, shapes);
    renderDrawList(a, width, layout, steps, 1);
    renderDrawList(b, width, layout, steps, 1);
    for (let i = 0; i < out.length; i++) out[i] = a[i] !== 0 || b[i] !== 0xffffff ? 1 : 0;
    return out;
  };
  const order = shapesFarFirst(globeShapes, turn);
  const at = order.findIndex((s) => s.kind === 'house');
  const house = mask([order[at]!]);
  const near = mask(order.slice(at + 1));
  const within = (m: Uint8Array, x: number, y: number, want: 'all' | 'any'): boolean => {
    let any = false;
    let all = true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const on = xx >= 0 && yy >= 0 && xx < width && yy < height && m[yy * width + xx] === 1;
        any ||= on;
        all &&= on;
      }
    }
    return want === 'all' ? all : any;
  };
  const cells = new Uint8Array(width * height);
  let inner = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (house[y * width + x] === 1 && within(house, x, y, 'all') && !within(near, x, y, 'any')) {
        cells[y * width + x] = 1;
        inner++;
      }
    }
  }
  return { cells, inner };
}

/**
 * Partly opaque pixels (0 < alpha < 255) with a fully opaque pixel on both sides, left and right or above and below,
 * counted only in the house's cells (see houseCells): a seam inside the house. `where` lists the first few as art cells.
 */
async function houseSeams(
  page: Page,
  box: { left: number; top: number; width: number },
  scale: number,
  cells: Uint8Array,
): Promise<{ seams: number; partial: number; opaqueShare: number; where: string[] }> {
  return page.locator(SHAPES).evaluate(
    (el, arg) => {
      const c = el as HTMLCanvasElement;
      const w = c.width;
      const h = c.height;
      const data = c.getContext('2d')!.getImageData(0, 0, w, h).data;
      const a = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (data[(y * w + x) * 4 + 3] ?? 0));
      const cellAt = (x: number, y: number): boolean => arg.cells[(arg.top + Math.floor(y / arg.scale)) * arg.width + arg.left + Math.floor(x / arg.scale)] === 1;
      let seams = 0;
      let partial = 0;
      let inside = 0;
      let opaque = 0;
      const where: string[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!cellAt(x, y)) continue;
          const v = a(x, y);
          inside++;
          if (v === 255) opaque++;
          if (v === 0 || v === 255) continue;
          partial++;
          if ((a(x - 1, y) === 255 && a(x + 1, y) === 255) || (a(x, y - 1) === 255 && a(x, y + 1) === 255)) {
            seams++;
            if (where.length < 4) where.push(`art (${arg.left + Math.floor(x / arg.scale)}, ${arg.top + Math.floor(y / arg.scale)})`);
          }
        }
      }
      return { seams, partial, opaqueShare: inside === 0 ? 0 : opaque / inside, where };
    },
    { left: box.left, top: box.top, width: box.width, scale, cells: Array.from(cells) },
  );
}

test.describe('the faces of the house meet with no seam', () => {
  const SEAM_VIEWPORTS: [string, Viewport, number][] = [
    ['360x700 at 2x', { width: 360, height: 700 }, 2],
    ['1920x1130 at 1x', { width: 1920, height: 1130 }, 1],
  ];
  for (const [name, viewport, dpr] of SEAM_VIEWPORTS) {
    test(`${name}: after drags to several turn angles, no partly opaque pixel sits between opaque ones inside the house's faces`, async ({ browser }) => {
      const { context, page } = await openLive(browser, viewport, dpr);
      const { scale, width, height } = pagePixels(viewport, dpr);
      const layout = sceneLayout(width, height, SEED);
      const box = leanBox(width, layout);
      const scene = await rect(page, 'canvas#scene');
      const css = scale / dpr;
      const from = { x: scene.x + layout.globe.cx * css, y: scene.y + layout.globe.cy * css };
      // The turn is known: it starts at src/page/scene.ts's START_TURN and each art pixel dragged sideways adds turnPerPixel.
      let turn = 0.5;
      let seams = 0;
      let partial = 0;
      let reads = 0;
      const where: string[] = [];
      for (const dx of [23, 41, -37, 58, -19, 77]) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let k = 1; k <= 4; k++) await page.mouse.move(from.x + (dx * css * k) / 4, from.y);
        await page.mouse.up();
        turn += dx * DRAG_SETTINGS.turnPerPixel;
        // The lean springs back upright (about e^-3t): wait until its shift is under half an art pixel everywhere.
        await page.waitForTimeout(2200);
        const { cells, inner } = houseCells(turn, width, layout);
        expect(inner, 'the house has cells to look at').toBeGreaterThan(100);
        for (let r = 0; r < 3; r++) {
          const found = await houseSeams(page, { left: box.left, top: box.top, width }, scale, cells);
          // The turn I worked out is the page's: the house's cells are drawn.
          expect(found.opaqueShare, `the house's cells are opaque on the layer at turn ${turn.toFixed(3)}`).toBeGreaterThan(0.95);
          seams += found.seams;
          partial += found.partial;
          if (found.seams > 0) where.push(`turn ${turn.toFixed(3)}: ${found.where.join(', ')}`);
          reads++;
        }
      }
      expect(reads).toBe(18);
      expect(seams, `seam pixels inside the house (${partial} partly opaque in its cells); ${where.join('; ')}`).toBe(0);
      await context.close();
    });
  }
});
