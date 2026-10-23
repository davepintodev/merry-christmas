// XMAS-41b2 "Drag input", in the built page: a drag on the globe turns it, a
// flick stirs the snow, touch and mouse both work, the page does not scroll or
// zoom, and the pointer is listened to before `globe-ready` is marked.
//
// Determinism: each scenario runs on Playwright's fake clock (page.clock), so
// the page's requestAnimationFrame, performance.now and timers move only when
// the test runs the clock. Two runs that do the same things at the same fake
// times draw the same picture to the pixel, so "the globe turned" is read as
// "the picture differs from a run with no drag". The scene canvas is read
// pixel by pixel (one canvas pixel per art pixel); no test hook is added to the
// page.
//
// Reading the stir: a stirred globe has snow in the air. The flakes in front are
// white on the snow layer over Santa (XMAS-84), which holds nothing else, so its
// white pixels in the upper part of the glass, well above the floor line where
// resting snow lies, are counted. A flick and a slow drag of the same distance turn
// the globe the same amount, so the only difference left between them is the
// snow, and the flick must have more of it in the air at the same moment
// after the release.
import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { pagePixels } from '../../src/page/pixel.ts';
import { sceneLayout } from '../../src/scene/frame.ts';
import { leanBox } from '../../src/scene/lean.ts';

const NOW = '2026-12-01T22:00:00';
const VIEWPORT = { width: 800, height: 600 };
const STEP_MS = 16; // Playwright's fake requestAnimationFrame interval
/** The flakes in front, over the shapes and Santa: a screen pixel layer that holds nothing but those flakes (XMAS-84, XMAS-83). */
const SNOW_FRONTS = "canvas#scene + canvas + canvas + canvas + canvas";

/** The base layer, drawn last (XMAS-68). */
const BASE_LAYER = "canvas#scene + canvas + canvas + canvas + canvas + canvas";

type Geometry = { art: (x: number, y: number) => { x: number; y: number }; cx: number; cy: number; radius: number; baseTop: number; baseBottom: number; scale: number; boxLeft: number; boxTop: number };
type Point = { x: number; y: number };
type Session = { context: BrowserContext; page: Page; cdp: CDPSession | null; geometry: Geometry };

async function boot(browser: Browser, options: { touch?: boolean; mobile?: boolean; viewport?: { width: number; height: number } } = {}): Promise<Session> {
  const viewport = options.viewport ?? VIEWPORT;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: options.touch === true,
    isMobile: options.mobile === true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __prevented: boolean[]; __downs: number };
    w.__prevented = [];
    w.__downs = 0;
    // Seen after the canvas's own listeners have run (bubbling up to the window).
    window.addEventListener('pointerdown', (event) => {
      w.__downs++;
      w.__prevented.push(event.defaultPrevented);
    });
  });
  await page.clock.install({ time: new Date(2026, 11, 1, 22, 0, 0) });
  // The fake clock runs by itself until it is paused, so the scene file is held back
  // until the clock is paused: the scene's first frame is then at a known fake moment
  // however long the network takes, and every picture after it is the same each run.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/[^/]+\.m?js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/?now=${NOW}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
  await page.clock.pauseAt(new Date(2026, 11, 1, 22, 0, 30));
  release();
  await page.waitForTimeout(300);
  // The fake clock leaves performance.mark with nothing to read back, so the first
  // frame is seen as the scene canvas getting its CSS size (it is sized as it first draws).
  for (let k = 0; k < 400 && (await sceneDrawn(page)) === 0; k++) {
    await page.clock.runFor(STEP_MS); // one frame at a time, so the scene's first frame is always the same fake moment
    await page.waitForTimeout(20); // the scene file arrives over the real network
  }
  expect(await sceneDrawn(page), 'the scene drew its first frame').toBe(1);
  await idle(page, 200);
  const cdp = options.touch === true ? await context.newCDPSession(page) : null;
  return { context, page, cdp, geometry: await geometryOf(page, viewport) };
}

async function sceneDrawn(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas#scene')?.style.width ? 1 : 0);
}

async function geometryOf(page: Page, viewport: { width: number; height: number }): Promise<Geometry> {
  const box = await page.locator('canvas#scene').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const { scale, width, height } = pagePixels(viewport, 1);
  const layout = sceneLayout(width, height, 1);
  const { cx, cy, radius } = layout.globe;
  const lean = leanBox(width, layout);
  return {
    art: (x, y) => ({ x: box.x + x * scale, y: box.y + y * scale }),
    cx,
    cy,
    radius,
    baseTop: cy + radius + 1,
    baseBottom: Math.min(height - 1, cy + radius + 20),
    scale,
    boxLeft: lean.left,
    boxTop: lean.top,
  };
}

/** Runs the fake clock on for `ms`, rounded up to whole frames: one call, so a long wait is not one round trip per frame. */
async function idle(page: Page, ms: number): Promise<void> {
  if (ms > 0) await page.clock.runFor(Math.ceil(ms / STEP_MS) * STEP_MS);
}

/** The scene canvas's pixels in a rectangle of art pixels, as r,g,b,a numbers. */
async function pixels(page: Page, x: number, y: number, width: number, height: number): Promise<number[]> {
  return page.locator('canvas#scene').evaluate(
    (el, r) => Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(r.x, r.y, r.width, r.height).data),
    { x, y, width, height },
  );
}

function differing(a: number[], b: number[]): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

const isFlake = (data: number[], i: number): boolean => {
  const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
  return rgb === 0xffffff || rgb === 0xaebcf0;
};

/**
 * Pixels inside the glass (a square picture of the globe's box, so a circle in it) that
 * differ, leaving out every place where either picture shows a flake (or resting snow,
 * which is the same white). The snow depends on how the drag was timed (the page reads
 * the clock when each pointer event is delivered, and the browser delivers them on
 * frames), and the sky outside the glass twinkles, so what a turn or a lean alone
 * changes is read without them.
 */
function differingIgnoringSnow(a: number[], b: number[]): number {
  expect(a.length).toBe(b.length);
  const width = Math.round(Math.sqrt(a.length / 4));
  const mid = (width - 1) / 2;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const px = (i / 4) % width;
    const py = Math.floor(i / 4 / width);
    if (Math.hypot(px - mid, py - mid) > mid - 3) continue;
    if (isFlake(a, i) || isFlake(b, i)) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

function globeBox(g: Geometry): { x: number; y: number; width: number; height: number } {
  return { x: g.cx - g.radius, y: g.cy - g.radius, width: 2 * g.radius + 1, height: 2 * g.radius + 1 };
}

/** The glass layer's pixels (XMAS-92b): the turn-dependent glass reflections are on this screen-pixel canvas, not on the scene canvas. */
async function glassPixels(s: Session): Promise<number[]> {
  return s.page.locator('canvas#scene + canvas').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
  });
}

async function globePixels(s: Session): Promise<number[]> {
  const b = globeBox(s.geometry);
  return pixels(s.page, b.x, b.y, b.width, b.height);
}

/** The base: its own layer at the screen's pixel size (XMAS-68), over the snow in front, whole. */
async function basePixels(s: Session): Promise<number[]> {
  return s.page.locator(BASE_LAYER).evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
  });
}

/**
 * How many flakes are in the air: the white pixels in the upper part of the glass, well above the floor line,
 * on the snow layer in front (at the screen's size, `scale` device pixels to an art pixel, so the rectangle is read in art
 * pixels from the lean box's top left and scaled to device pixels).
 */
async function airborne(s: Session): Promise<number> {
  const g = s.geometry;
  // x from 50 either side of the centre, inclusive; y from 50 above it to 18 below, exclusive.
  const k = g.scale;
  const area = { left: (g.cx - 50 - g.boxLeft) * k, right: (g.cx + 51 - g.boxLeft) * k - 1, top: (g.cy - 50 - g.boxTop) * k, bottom: (g.cy + 18 - g.boxTop) * k };
  return s.page.locator(SNOW_FRONTS).evaluate((el, a) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let y = Math.max(0, a.top); y < Math.min(c.height, a.bottom); y++) {
      for (let x = Math.max(0, a.left); x <= Math.min(c.width - 1, a.right); x++) {
        const i = (y * c.width + x) * 4;
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255) n++;
      }
    }
    return n;
  }, area);
}

/** The shapes' own canvas (the fine layer, XMAS-81): the third canvas after the scene canvas, after the glass and the flakes behind the glass centre, which holds the shapes and Santa. */
const SHAPES_LAYER = 'canvas#scene + canvas + canvas + canvas'; // the glass and the flakes-behind layers sit between the scene and the shapes (XMAS-92b, XMAS-89)
const FRONT_ROWS = { from: 24, to: 44 }; // below the globe's centre: the near part of the floor, where the presents and the snowman stand
const FRONT_HALF = 45;

/**
 * Where the near strip of the floor is filled, as the number of opaque shape-layer pixels in each art column,
 * from the globe's centre - 45 to + 45. Shapes decide it (they are opaque; the floor and shadows are not).
 */
async function frontBand(s: Session): Promise<number[]> {
  const g = s.geometry;
  const k = g.scale;
  const area = {
    left: (g.cx - FRONT_HALF - g.boxLeft) * k,
    top: (g.cy + FRONT_ROWS.from - g.boxTop) * k,
    width: (2 * FRONT_HALF + 1) * k,
    height: (FRONT_ROWS.to - FRONT_ROWS.from) * k,
    k,
  };
  return s.page.locator(SHAPES_LAYER).evaluate((el, a) => {
    const data = (el as HTMLCanvasElement).getContext('2d')!.getImageData(a.left, a.top, a.width, a.height).data;
    const columns: number[] = Array.from({ length: a.width / a.k }, () => 0);
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (data[(y * a.width + x) * 4 + 3] === 255) columns[Math.floor(x / a.k)]!++;
      }
    }
    return columns;
  }, area);
}

/** The horizontal shift s (art pixels, positive is rightward) at which `before` slid by s best matches `moved`. */
function bestShift(before: number[], moved: number[]): number {
  let best = 0;
  let bestError = Infinity;
  for (let s = -30; s <= 30; s++) {
    let error = 0;
    let n = 0;
    for (let x = 30; x < before.length - 30; x++) {
      error += Math.abs(moved[x]! - before[x - s]!);
      n++;
    }
    if (error / n < bestError) {
      bestError = error / n;
      best = s;
    }
  }
  return best;
}

/** The point on the globe a drag starts from, in client pixels. */
function onGlobe(s: Session): Point {
  return s.geometry.art(s.geometry.cx, s.geometry.cy);
}

type DragOptions = { artPx: number; moves: number; msPerMove: number; release?: boolean };

async function mouseDrag(s: Session, from: Point, { artPx, moves, msPerMove, release = true }: DragOptions): Promise<void> {
  const dx = artPx * s.geometry.scale;
  await s.page.mouse.move(from.x, from.y);
  await s.page.mouse.down();
  for (let k = 1; k <= moves; k++) {
    await s.page.mouse.move(from.x + (dx * k) / moves, from.y);
    await s.page.clock.runFor(msPerMove);
  }
  if (release) await s.page.mouse.up();
}

/**
 * The snow in the air, summed over samples every 200 ms for the second after the release. One sample is chaotic
 * (a single moment's count swings with where the stirred flakes happen to be), the sum is not.
 */
async function airborneOverTheNextSecond(s: Session): Promise<number> {
  let total = 0;
  for (let i = 0; i < 5; i++) {
    await idle(s.page, 200);
    total += await airborne(s);
  }
  return total;
}

type Touch = { x: number; y: number; id: number };

async function touch(s: Session, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Touch[]): Promise<void> {
  await s.cdp!.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

/** A one-finger drag along x. */
async function touchDrag(s: Session, from: Point, { artPx, moves, msPerMove, release = true }: DragOptions): Promise<void> {
  const dx = artPx * s.geometry.scale;
  await touch(s, 'touchStart', [{ x: from.x, y: from.y, id: 1 }]);
  for (let k = 1; k <= moves; k++) {
    await touch(s, 'touchMove', [{ x: from.x + (dx * k) / moves, y: from.y, id: 1 }]);
    await s.page.clock.runFor(msPerMove);
  }
  if (release) await touch(s, 'touchEnd', []);
}

const SLOW: DragOptions = { artPx: 60, moves: 12, msPerMove: 64 }; // 12 moves over 768 ms: about 78 art px/s
const FAST: DragOptions = { artPx: 60, moves: 6, msPerMove: 16 }; // 6 moves over 96 ms: about 625 art px/s

test.describe('a drag turns the whole globe, base included', () => {
  test('a mouse drag across the globe turns it, and the base with it, and the turn stays after the button is let go', async ({ browser }) => {
    const still = await boot(browser);
    await idle(still.page, 4000);
    const stillGlobe = await globePixels(still);
    const stillGlass = await glassPixels(still);
    const stillBase = await basePixels(still);
    await still.context.close();

    const dragged = await boot(browser);
    await mouseDrag(dragged, onGlobe(dragged), SLOW);
    await idle(dragged.page, 4000 - SLOW.moves * SLOW.msPerMove);
    expect(differing(await globePixels(dragged), stillGlobe) + differing(await glassPixels(dragged), stillGlass), 'the globe is turned').toBeGreaterThan(200);
    expect(differing(await basePixels(dragged), stillBase), 'the base is turned with it').toBeGreaterThan(0);
    await dragged.context.close();
  });

  test('dragging right moves the front surface of the globe to the right, dragging left moves it to the left (XMAS-67)', async ({ browser }) => {
    const BIG: DragOptions = { artPx: 15, moves: 10, msPerMove: 64 };
    const still = await boot(browser);
    await idle(still.page, BIG.moves * BIG.msPerMove + 4000);
    const stillBand = await frontBand(still);
    await still.context.close();

    const shifts: Record<string, number> = {};
    for (const [name, artPx] of [['right', BIG.artPx], ['left', -BIG.artPx]] as const) {
      const s = await boot(browser);
      await mouseDrag(s, onGlobe(s), { ...BIG, artPx });
      await idle(s.page, 4000);
      shifts[name] = bestShift(stillBand, await frontBand(s));
      await s.context.close();
    }
    // The presents and the snowman stand on the near side of the floor: they slide with the finger.
    expect(shifts.right, `a rightward drag shifts the front right (shifts ${JSON.stringify(shifts)})`).toBeGreaterThan(2);
    expect(shifts.left, `a leftward drag shifts the front left (shifts ${JSON.stringify(shifts)})`).toBeLessThan(-2);
  });

  test('a touch drag turns the globe exactly as the same mouse drag does', async ({ browser }) => {
    const mouse = await boot(browser);
    await mouseDrag(mouse, onGlobe(mouse), SLOW);
    await idle(mouse.page, 3000);
    const viaMouse = await globePixels(mouse);
    const viaMouseGlass = await glassPixels(mouse);
    const viaMouseBase = await basePixels(mouse);
    await mouse.context.close();

    const still = await boot(browser, { touch: true });
    await idle(still.page, SLOW.moves * SLOW.msPerMove + 3000);
    const stillGlobe = await globePixels(still);
    const stillGlass = await glassPixels(still);
    await still.context.close();

    const finger = await boot(browser, { touch: true });
    await touchDrag(finger, onGlobe(finger), SLOW);
    await idle(finger.page, 3000);
    const viaTouch = await globePixels(finger);
    const viaTouchGlass = await glassPixels(finger);
    const viaTouchBase = await basePixels(finger);
    expect(differing(viaTouch, stillGlobe) + differing(viaTouchGlass, stillGlass), 'a touch drag turns it').toBeGreaterThan(200);
    // The glass reflections are a pure function of the turn, so they match the mouse drag to the pixel.
    expect(differing(viaTouchGlass, viaMouseGlass), 'the glass layer is the same turn as the mouse').toBe(0);
    // The turn is exact: the base moves only with the turn, so it is the same to the pixel.
    expect(differing(viaTouchBase, viaMouseBase), 'and the same turn as the mouse').toBe(0);
    // The snow's lighter shades and the like differ a little (event delivery times differ by a frame or
    // two between the runs, and the page reads the clock then); a different turn differs by thousands.
    const noise = differingIgnoringSnow(viaTouch, viaMouse) + differing(viaTouchGlass, viaMouseGlass);
    expect(noise, 'and the same picture as the mouse, the snow aside').toBeLessThan((differingIgnoringSnow(viaTouch, stillGlobe) + differing(viaTouchGlass, stillGlass)) / 20);
    await finger.context.close();
  });

  test('a drag that begins away from the globe, on the open ground, still turns it (the whole canvas listens)', async ({ browser }) => {
    const still = await boot(browser);
    await idle(still.page, 3000 + SLOW.moves * SLOW.msPerMove);
    const stillBase = await basePixels(still);
    await still.context.close();

    const s = await boot(browser);
    // Far enough left that the rightward drag starts and ends between the pause and shake buttons along the bottom.
    const ground = s.geometry.art(s.geometry.cx - 20, s.geometry.baseBottom + 4);
    await mouseDrag(s, ground, SLOW);
    await idle(s.page, 3000);
    expect(differing(await basePixels(s), stillBase)).toBeGreaterThan(0);
    await s.context.close();
  });
});

test.describe('the globe leans into a drag and springs back', () => {
  test('just after a drag the glass is tilted, and a few seconds later it is upright', async ({ browser }) => {
    const total = FAST.moves * FAST.msPerMove;
    const [s, calm] = await Promise.all([boot(browser), boot(browser)]);

    // The same two moments with no drag: what the scene's own animation changes in that time.
    // Its own page, run alongside the drag session.
    const calmRun = (async () => {
      await idle(calm.page, total + 50);
      const calmA = await globePixels(calm);
      const calmGlassA = await glassPixels(calm);
      await idle(calm.page, 3000);
      const calmB = await globePixels(calm);
      const calmGlassB = await glassPixels(calm);
      await calm.context.close();
      return { calmA, calmGlassA, calmB, calmGlassB };
    })();

    await mouseDrag(s, onGlobe(s), FAST);
    await idle(s.page, 50);
    const leaningGlassLayer = await glassPixels(s);
    const leaningGlass = await globePixels(s); // same turn as the later picture: only the lean (and the snow and the sky) can differ
    await idle(s.page, 3000);
    const uprightGlass = await globePixels(s);
    const uprightGlassLayer = await glassPixels(s);
    await s.context.close();
    const { calmA, calmGlassA, calmB, calmGlassB } = await calmRun;

    const tilt = differingIgnoringSnow(leaningGlass, uprightGlass) + differing(leaningGlassLayer, uprightGlassLayer);
    const calmChange = differingIgnoringSnow(calmA, calmB) + differing(calmGlassA, calmGlassB);
    expect(tilt, 'the glass was tilted and is upright now, far beyond the scene animating alone').toBeGreaterThan(calmChange * 5);
  });
});

test.describe('a flick stirs the snow', () => {
  test('a fast flick leaves more snow in the air than a slow drag of the same distance, the same time after the release', async ({ browser }) => {
    const slow = await boot(browser);
    await mouseDrag(slow, onGlobe(slow), SLOW);
    const slowAir = await airborneOverTheNextSecond(slow);
    await slow.context.close();

    const fast = await boot(browser);
    await mouseDrag(fast, onGlobe(fast), FAST);
    const fastAir = await airborneOverTheNextSecond(fast);
    await fast.context.close();

    expect(fastAir).toBeGreaterThan(slowAir * 1.2);
  });

  test('any drag stirs in proportion to its distance, with no threshold: a long slow drag (under the flick speed) leaves much more snow in the air than a short one or none', async ({ browser }) => {
    const PASS = { artPx: 40, moves: 9, msPerMove: 30 }; // about 150 art px/s, under the 200 threshold
    const passes = 6;
    const settle = 100;
    const air = async (count: number): Promise<number> => {
      const s = await boot(browser);
      // Back and forth, so the pointer is never faster than 150 art px/s and never lifted until the end.
      const from = onGlobe(s);
      const dx = PASS.artPx * s.geometry.scale;
      await s.page.mouse.move(from.x, from.y);
      await s.page.mouse.down();
      for (let p = 0; p < count; p++) {
        for (let k = 1; k <= PASS.moves; k++) {
          const along = (dx * k) / PASS.moves;
          await s.page.mouse.move(from.x + (p % 2 === 0 ? along : dx - along), from.y);
          await s.page.clock.runFor(PASS.msPerMove);
        }
      }
      await s.page.mouse.up();
      await idle(s.page, settle);
      const n = await airborne(s);
      await s.context.close();
      return n;
    };
    const none = await air(0);
    const short = await air(1);
    const long = await air(passes);
    // A short slow drag (stir 0.24) barely lifts a flake; six times the path (1.44) lifts many.
    expect(long, `a long slow drag stirs well over no drag (none ${none}, short ${short}, long ${long})`).toBeGreaterThan(none * 1.5);
    expect(long, `and well over a short one (none ${none}, short ${short}, long ${long})`).toBeGreaterThan(short * 1.5);
  });
});

test.describe('the page does not scroll or zoom on a drag on the globe', () => {
  test('a pointer down on the globe has its default prevented; a mouse drag does not scroll the page', async ({ browser }) => {
    const s = await boot(browser);
    await mouseDrag(s, onGlobe(s), { artPx: 30, moves: 5, msPerMove: 16 });
    const seen = await s.page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);
    expect(seen).toEqual([true]);
    expect(await s.page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    await s.context.close();
  });

  test('a touch drag does not scroll the page, and a two-finger spread on the globe does not zoom it', async ({ browser }) => {
    const s = await boot(browser, { touch: true, mobile: true, viewport: { width: 390, height: 844 } });
    const centre = onGlobe(s);
    const scale = s.geometry.scale;
    await touchDrag(s, centre, { artPx: 40, moves: 8, msPerMove: 16 });
    // A pinch: two fingers on the globe moving apart.
    await touch(s, 'touchStart', [
      { x: centre.x - 10 * scale, y: centre.y, id: 1 },
      { x: centre.x + 10 * scale, y: centre.y, id: 2 },
    ]);
    for (let k = 1; k <= 8; k++) {
      await touch(s, 'touchMove', [
        { x: centre.x - (10 + 3 * k) * scale, y: centre.y, id: 1 },
        { x: centre.x + (10 + 3 * k) * scale, y: centre.y, id: 2 },
      ]);
      await s.page.clock.runFor(16);
    }
    await touch(s, 'touchEnd', []);
    const view = await s.page.evaluate(() => ({ scroll: [window.scrollX, window.scrollY], zoom: window.visualViewport?.scale ?? 1 }));
    expect(view.scroll).toEqual([0, 0]);
    expect(view.zoom).toBe(1);
    expect(await s.page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented.every(Boolean))).toBe(true);
    await s.context.close();
  });
});

test.describe('input is attached before globe-ready', () => {
  test('all four pointer listeners are on the scene canvas by the time globe-ready is marked', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __types: string[]; __atReady: string[] | null };
      w.__types = [];
      w.__atReady = null;
      const realAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
        if (this instanceof HTMLCanvasElement && this.id === 'scene') w.__types.push(type);
        return (realAdd as (...a: unknown[]) => void).call(this, type, ...rest);
      } as typeof EventTarget.prototype.addEventListener;
      const realMark = performance.mark.bind(performance);
      performance.mark = ((name: string, ...rest: unknown[]) => {
        if (name === 'globe-ready') w.__atReady = [...w.__types];
        return (realMark as (...a: unknown[]) => PerformanceMark)(name, ...rest);
      }) as typeof performance.mark;
    });
    await page.goto(`/?now=${NOW}`);
    await page.waitForFunction(() => performance.getEntriesByName('globe-ready', 'mark').length > 0, null, { timeout: 10_000 });
    const atReady = await page.evaluate(() => (window as unknown as { __atReady: string[] | null }).__atReady);
    expect(atReady).not.toBeNull();
    expect(atReady).toEqual(expect.arrayContaining(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']));
  });

  test('a drag made the moment globe-ready appears is taken, not lost', async ({ browser }) => {
    const s = await boot(browser);
    // boot returns as soon as the mark exists, then runs the clock a little; drag at once from there.
    await mouseDrag(s, onGlobe(s), { artPx: 30, moves: 5, msPerMove: 16 });
    expect(await s.page.evaluate(() => (window as unknown as { __downs: number }).__downs)).toBe(1);
    expect(await s.page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented)).toEqual([true]);
    await s.context.close();
  });
});
