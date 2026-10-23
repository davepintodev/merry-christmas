// XMAS-31b "Scene core", page runtime, in the built page (vite preview of
// dist/, which holds both built outputs: the countdown script inlined in
// index.html and the scene file under /assets/).
//
// The scene draws on <canvas id="scene">: one small canvas, one canvas pixel
// per art pixel, scaled up by CSS with hard edges to the page's one art pixel
// size (pagePixels), the same size the countdown uses. The scene file loads
// after the countdown shows; if it fails, the countdown stays on its plain
// sky, silently. The scene's space is reserved up front, so its arrival
// never moves the countdown. One frame per screen refresh, none while the tab
// is hidden; `globe-ready` is marked when the first frame is drawn.
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { skyAndInk } from '../../src/countdown/colours.ts';
import { countdownFrame } from '../../src/countdown/render.ts';
import { pagePixels } from '../../src/page/pixel.ts';
import { sceneFrame, sceneLayout } from '../../src/scene/frame.ts';
import { phaseAt, timeLeft } from '../../src/shared/clock.ts';
import { decodePng } from '../../tools/png.ts';

const NOW = '2026-12-01T22:00:00';
const AT = new Date(2026, 11, 1, 22, 0, 0);
const SCENE_FILE = /\/assets\/[^/]+\.m?js(\?.*)?$/;

type Rect = { x: number; y: number; width: number; height: number };
type Probe = {
  raf: { requested: number; fired: number; max: number };
  draws: number;
  shift: number;
  rejections: number;
  errors: number;
};

/** Counts frame requests, scene canvas draws, layout shifts and stray errors from the very start. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = { raf: { requested: 0, fired: 0, max: 0 }, draws: 0, shift: 0, rejections: 0, errors: 0 };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    const live = new Set<number>();
    const realRequest = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      probe.raf.requested++;
      const id = realRequest((time) => {
        live.delete(id);
        probe.raf.fired++;
        callback(time);
      });
      live.add(id);
      probe.raf.max = Math.max(probe.raf.max, live.size);
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      live.delete(id);
      realCancel(id);
    };
    const proto = CanvasRenderingContext2D.prototype;
    for (const name of ['putImageData', 'drawImage'] as const) {
      const real = proto[name] as (...args: unknown[]) => void;
      (proto as unknown as Record<string, unknown>)[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        // XMAS-81: only the scene canvas counts; the fine layer's canvases draw many faces per frame.
        if (this.canvas.id === 'scene') probe.draws++;
        return real.apply(this, args);
      };
    }
    window.addEventListener('unhandledrejection', () => probe.rejections++);
    window.addEventListener('error', () => probe.errors++);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.shift += (entry as unknown as { value: number }).value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // layout-shift is Chromium-only; the bounding box checks still run.
    }
  });
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __probe: Probe }).__probe)) as Probe);
}

async function marks(page: Page, name: string): Promise<number[]> {
  return page.evaluate((n) => performance.getEntriesByName(n, 'mark').map((m) => m.startTime), name);
}

async function open(page: Page, now = NOW): Promise<void> {
  await page.goto(`/?now=${now}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
}

async function globeReady(page: Page): Promise<void> {
  await page.waitForFunction(() => performance.getEntriesByName('globe-ready', 'mark').length > 0, null, { timeout: 10_000 });
}

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** One canvas pixel's [r, g, b, a]; the scene canvas holds one canvas pixel per art pixel. */
async function canvasPixel(page: Page, selector: string, x: number, y: number): Promise<number[]> {
  return page.locator(selector).evaluate(
    (el, { x, y }) => Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data),
    { x, y },
  );
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

function numberRgb(n: number): number[] {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The screen as the device shows it, in physical pixels. */
async function screen(page: Page): Promise<{ width: number; height: number; at: (x: number, y: number) => number[] }> {
  const png = decodePng(new Uint8Array(await page.screenshot({ scale: 'device' })));
  return {
    width: png.width,
    height: png.height,
    at: (x, y) => Array.from(png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)),
  };
}

async function hide(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function sized(browser: Browser, viewport: { width: number; height: number }, dpr: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await instrument(page);
  return { context, page };
}

test.describe('globe-ready and the lazy scene file', () => {
  test('globe-ready is marked once, after countdown-visible, when the scene has drawn', async ({ page }) => {
    await instrument(page);
    await open(page);
    await globeReady(page);
    const [visible] = await marks(page, 'countdown-visible');
    const [ready] = await marks(page, 'globe-ready');
    expect(ready).toBeGreaterThanOrEqual(visible!);
    expect((await probe(page)).draws).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1500); // later frames add no further mark
    expect(await marks(page, 'globe-ready')).toHaveLength(1);
    await expect(page.locator('canvas#scene')).toBeVisible();
    // The scene really shows: the bottom of the screen is ground, not the countdown's plain sky.
    const shot = await screen(page);
    expect(shot.at(shot.width >> 1, shot.height - 2)).not.toEqual(rgb(skyAndInk(phaseAt(AT)).sky));
  });

  test('the scene file is requested only after the countdown shows', async ({ page }) => {
    const sceneRequests: string[] = [];
    page.on('request', (req) => {
      if (SCENE_FILE.test(req.url())) sceneRequests.push(req.url());
    });
    await open(page);
    await globeReady(page);
    expect(sceneRequests.length).toBeGreaterThanOrEqual(1);
    const timing = await page.evaluate(() => {
      const visible = performance.getEntriesByName('countdown-visible', 'mark')[0]?.startTime ?? Number.NaN;
      const files = performance
        .getEntriesByType('resource')
        .filter((e) => /\/assets\/[^/]+\.m?js/.test(e.name))
        .map((e) => e.startTime);
      return { visible, files };
    });
    expect(timing.files.length).toBeGreaterThanOrEqual(1);
    for (const start of timing.files) expect(start).toBeGreaterThanOrEqual(timing.visible);
  });
});

const FAILURES: readonly [string, (route: Route) => Promise<void>][] = [
  ['the request is aborted', (route) => route.abort('failed')],
  ['the server answers 404', (route) => route.fulfill({ status: 404, body: 'not found' })],
  ['the server answers 500', (route) => route.fulfill({ status: 500, body: '' })],
  [
    'the file throws as it runs',
    (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: "throw new Error('scene boom');" }),
  ],
  ['the file is not JavaScript', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '<!doctype html><p>oops' })],
];

for (const [name, fail] of FAILURES) {
  test(`if the scene file fails (${name}) the countdown stays on its plain sky, silently`, async ({ page }) => {
    await instrument(page);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      // The browser's own network line for a failed fetch is not the page's doing.
      if (msg.type() === 'error' && !/Failed to load resource|net::ERR_/.test(msg.text())) consoleErrors.push(msg.text());
    });
    let hits = 0;
    await page.route(SCENE_FILE, async (route) => {
      hits++;
      await fail(route);
    });
    await open(page);
    await page.waitForTimeout(2000);
    expect(hits, 'the page asked for the scene file').toBeGreaterThanOrEqual(1);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    const p = await probe(page);
    expect(p.rejections, 'unhandled promise rejection').toBe(0);
    expect(p.errors, 'error event on window').toBe(0);
    expect(await marks(page, 'globe-ready')).toEqual([]);
    expect(await marks(page, 'countdown-visible')).toHaveLength(1);
    // No message: the live region is still empty and no error text is shown.
    expect(await page.locator('#countdown-announce').textContent()).toBe('');
    expect((await page.locator('body').innerText()).trim()).not.toMatch(/error|retry|failed|loading|scene/i);
    // The plain sky everywhere outside the countdown: corners and the bottom.
    const sky = rgb(skyAndInk(phaseAt(AT)).sky);
    const shot = await screen(page);
    for (const [x, y] of [
      [2, 2],
      [shot.width - 3, 2],
      [2, shot.height - 3],
      [shot.width - 3, shot.height - 3],
      [shot.width >> 1, shot.height - 3],
    ] as const) {
      expect(shot.at(x, y), `screen pixel ${x},${y}`).toEqual(sky);
    }
    // The countdown keeps going: the colons blink.
    const before = await page.locator('canvas#countdown').evaluate((el) => (el as HTMLCanvasElement).toDataURL());
    await page.waitForTimeout(1100);
    const after = await page.locator('canvas#countdown').evaluate((el) => (el as HTMLCanvasElement).toDataURL());
    expect(after).not.toBe(before);
  });
}

test.describe('the scene arrives without moving the countdown', () => {
  for (const [label, viewport, dpr] of [
    ['desktop', { width: 1280, height: 720 }, 1],
    ['phone', { width: 390, height: 844 }, 3],
  ] as const) {
    test(`${label}: the countdown box is identical before and after the scene loads`, async ({ browser }) => {
      const { context, page } = await sized(browser, viewport, dpr);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(SCENE_FILE, async (route) => {
        await gate;
        await route.continue();
      });
      await open(page);
      await page.waitForTimeout(300);
      expect(await marks(page, 'globe-ready')).toEqual([]); // the scene is still held back
      const before = await rect(page, 'canvas#countdown');
      release();
      await globeReady(page);
      await page.waitForTimeout(300);
      const after = await rect(page, 'canvas#countdown');
      expect(after).toEqual(before);
      expect((await probe(page)).shift).toBe(0);
      await context.close();
    });
  }

  test('the countdown sits in the same place whether the scene loads or fails', async ({ browser }) => {
    const viewport = { width: 1024, height: 700 };
    const loaded = await sized(browser, viewport, 1);
    await open(loaded.page);
    await globeReady(loaded.page);
    const failed = await sized(browser, viewport, 1);
    await failed.page.route(SCENE_FILE, (route) => route.abort('failed'));
    await open(failed.page);
    await failed.page.waitForTimeout(1000);
    expect(await rect(failed.page, 'canvas#countdown')).toEqual(await rect(loaded.page, 'canvas#countdown'));
    await loaded.context.close();
    await failed.context.close();
  });

  test('the countdown is drawn over the scene, inside the scene\'s countdown strip', async ({ page }) => {
    await open(page);
    await globeReady(page);
    const scene = await rect(page, 'canvas#scene');
    const countdown = await rect(page, 'canvas#countdown');
    const viewport = page.viewportSize()!;
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const { scale, width, height } = pagePixels(viewport, dpr);
    const strip = sceneLayout(width, height, 1).countdown;
    const artCss = scale / dpr;
    expect(countdown.y).toBeGreaterThanOrEqual(scene.y + strip.y * artCss - 0.05);
    expect(countdown.y + countdown.height).toBeLessThanOrEqual(scene.y + (strip.y + strip.height) * artCss + 0.05);
    expect(countdown.x).toBeGreaterThanOrEqual(scene.x - 0.05);
    expect(countdown.x + countdown.width).toBeLessThanOrEqual(scene.x + scene.width + 0.05);
    const onTop = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      { x: countdown.x + countdown.width / 2, y: countdown.y + countdown.height / 2 },
    );
    expect(onTop).toBe('countdown');
  });
});

test.describe('the countdown ink stays inside the scene\'s reserved countdown strip', () => {
  const VIEWS = [
    ['1920x1130 at 1', { width: 1920, height: 1130 }, 1],
    ['1280x800 at 1', { width: 1280, height: 800 }, 1],
    ['2560x1440 at 1', { width: 2560, height: 1440 }, 1],
    ['360x700 at 2', { width: 360, height: 700 }, 2],
    ['412x800 at 2.6', { width: 412, height: 800 }, 2.6],
    ['1600x500 at 1 (height-bound picture)', { width: 1600, height: 500 }, 1],
  ] as const;
  const WHEN = [
    ['the greeting', '2026-12-25T10:00:00'],
    ['the normal countdown', '2026-12-01T22:00:00'],
  ] as const;

  for (const [label, viewport, dpr] of VIEWS) {
    for (const [what, now] of WHEN) {
      test(`${label}: the last inked row of ${what} is inside the strip`, async ({ browser }) => {
        const { context, page } = await sized(browser, viewport, dpr);
        await open(page, now);
        const { scale, width, height } = pagePixels(viewport, dpr);
        const strip = sceneLayout(width, height, 1).countdown;
        const box = await rect(page, 'canvas#countdown');
        const inkRow = await page.locator('canvas#countdown').evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          const key = (i: number): string => `${d[i]},${d[i + 1]},${d[i + 2]}`;
          const sky = key(0);
          for (let y = c.height - 1; y >= 0; y--) {
            for (let x = 0; x < c.width; x++) if (key((y * c.width + x) * 4) !== sky) return y;
          }
          return -1;
        });
        expect(inkRow).toBeGreaterThanOrEqual(0);
        const artCss = scale / dpr;
        const lastArtRow = Math.floor((box.y + (inkRow + 0.5) / dpr) / artCss + 1e-6);
        expect(lastArtRow).toBeLessThanOrEqual(strip.y + strip.height - 1);
        await context.close();
      });
    }
  }
});

test.describe('one art pixel size, whole physical pixels, hard edges', () => {
  const CASES = [
    ['1280x720 at 1', { width: 1280, height: 720 }, 1],
    ['800x600 at 2', { width: 800, height: 600 }, 2],
    ['390x844 at 3', { width: 390, height: 844 }, 3],
    ['1366x768 at 1.25', { width: 1366, height: 768 }, 1.25],
    ['2560x1080 at 1', { width: 2560, height: 1080 }, 1],
  ] as const;

  for (const [label, viewport, dpr] of CASES) {
    test(`${label}: the scene fills the window at the page's art pixel size, never stretched`, async ({ browser }) => {
      const { context, page } = await sized(browser, viewport, dpr);
      await open(page);
      await globeReady(page);
      const want = pagePixels(viewport, dpr);
      const canvas = await page.locator('canvas#scene').evaluate((el) => {
        const c = el as HTMLCanvasElement;
        return { width: c.width, height: c.height, rendering: getComputedStyle(c).imageRendering };
      });
      // One small canvas: one canvas pixel per art pixel.
      expect([canvas.width, canvas.height]).toEqual([want.width, want.height]);
      expect(canvas.rendering).toBe('pixelated');
      // Scaled by a whole number of physical pixels, the same both ways (Chromium lays out on a 1/64 CSS px grid).
      const box = await rect(page, 'canvas#scene');
      expect(Math.abs(box.width * dpr - want.width * want.scale)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(box.height * dpr - want.height * want.scale)).toBeLessThanOrEqual(0.05);
      // Fills the window, with no scroll bars for the part-pixel over the edge.
      expect(box.x).toBeLessThanOrEqual(0.05);
      expect(box.y).toBeLessThanOrEqual(0.05);
      expect(box.x + box.width).toBeGreaterThanOrEqual(viewport.width - 0.05);
      expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 0.05);
      const scroll = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - window.innerWidth,
        y: document.documentElement.scrollHeight - window.innerHeight,
      }));
      expect(scroll).toEqual({ x: 0, y: 0 });
      // The countdown uses the same art pixel size.
      const frame = countdownFrame(timeLeft(AT), true, want.digitScale);
      const countdown = await rect(page, 'canvas#countdown');
      expect(Math.abs((countdown.width * dpr) / frame.width - want.scale)).toBeLessThanOrEqual(0.01);
      expect(Math.abs((countdown.height * dpr) / frame.height - want.scale)).toBeLessThanOrEqual(0.01);
      await context.close();
    });
  }

  for (const [dpr, viewport] of [
    [1, { width: 1365, height: 768 }],
    [1.5, { width: 375, height: 667 }],
    [2, { width: 1365, height: 768 }],
    [3, { width: 375, height: 667 }],
  ] as const) {
    test(`at ${dpr}, ${viewport.width} wide: the scene canvas starts on a whole device pixel`, async ({ browser }) => {
      const { context, page } = await sized(browser, viewport, dpr);
      await open(page);
      await globeReady(page);
      // Its left edge, in device pixels, is a whole number, so every art pixel is a whole number of device pixels.
      // The offset is a 32-bit transform, so it lands within about 1e-5 device pixels; a 1/64 px miss would show as 0.0156.
      const box = await rect(page, 'canvas#scene');
      const device = box.x * dpr;
      expect(Math.abs(device - Math.round(device))).toBeLessThanOrEqual(1e-4);
      await context.close();
    });
  }

  test('hard edges on screen: colours change only on art pixel boundaries', async ({ browser }) => {
    const viewport = { width: 800, height: 600 };
    const dpr = 2;
    const { context, page } = await sized(browser, viewport, dpr);
    await open(page);
    await globeReady(page);
    const { scale } = pagePixels(viewport, dpr);
    expect(scale).toBeGreaterThan(1);
    const box = await rect(page, 'canvas#scene');
    const top = Math.round(box.y * dpr);
    const left = Math.round(box.x * dpr);
    const shot = await screen(page);
    // The column one art pixel in from the right edge: sky bands, horizon and ground, clear of the countdown.
    const x = left + (Math.floor((shot.width - 1 - left) / scale) - 1) * scale + (scale >> 1);
    const changes: number[] = [];
    // Stop above the shake button in the bottom-right corner: its own pixels are not art.
    const shake = await rect(page, 'button#shake');
    const bottom = Math.min(shot.height, Math.floor(shake.y * dpr));
    for (let y = 1; y < bottom; y++) {
      if (shot.at(x, y).join() !== shot.at(x, y - 1).join()) changes.push(y);
    }
    expect(changes.length).toBeGreaterThanOrEqual(2); // at least the sky bands and the horizon
    expect(changes.filter((y) => (y - top) % scale !== 0)).toEqual([]);
    await context.close();
  });

  test('a wider, then taller window gets more art pixels at the new size', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await open(page);
    await globeReady(page);
    for (const viewport of [
      { width: 1800, height: 600 },
      { width: 1800, height: 1100 },
      { width: 500, height: 400 },
    ]) {
      await page.setViewportSize(viewport);
      const want = pagePixels(viewport, 1);
      await expect
        .poll(() => page.locator('canvas#scene').evaluate((el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height]))
        .toEqual([want.width, want.height]);
      const box = await rect(page, 'canvas#scene');
      expect(Math.abs(box.width - want.width * want.scale)).toBeLessThanOrEqual(0.05);
    }
  });
});

test.describe('one frame per screen refresh, none while the tab is hidden', () => {
  test('draws about once per refresh, with never more than one frame request waiting', async ({ page }) => {
    await instrument(page);
    await open(page);
    await globeReady(page);
    const a = await probe(page);
    await page.waitForTimeout(1000);
    const b = await probe(page);
    const fired = b.raf.fired - a.raf.fired;
    const drawn = b.draws - a.draws;
    expect(fired).toBeGreaterThan(20);
    expect(drawn).toBeLessThanOrEqual(fired);
    expect(drawn).toBeGreaterThanOrEqual(fired - 2);
    expect(b.raf.max).toBe(1);
  });

  test('two visible events in a row start one loop, not two', async ({ page }) => {
    await instrument(page);
    await open(page);
    await globeReady(page);
    await hide(page, true);
    await hide(page, false);
    await hide(page, false);
    await page.waitForTimeout(500);
    const a = await probe(page);
    await page.waitForTimeout(1000);
    const b = await probe(page);
    expect(b.raf.max).toBe(1);
    expect(b.draws - a.draws).toBeLessThanOrEqual(b.raf.fired - a.raf.fired);
  });

  test('a page opened in a hidden tab draws nothing until it is shown', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    });
    await instrument(page);
    await page.goto(`/?now=${NOW}`);
    await page.waitForTimeout(1500);
    expect((await probe(page)).draws).toBe(0);
    expect(await marks(page, 'globe-ready')).toEqual([]);
    await hide(page, false);
    await globeReady(page);
    expect((await probe(page)).draws).toBeGreaterThanOrEqual(1);
  });
});

// The scene's copy of the shared clock (in the scene file) and the
// countdown's copy (inlined in index.html) are separate built outputs; for
// the same ?now both must give the same phase. The scene's countdown strip is
// the countdown's plain sky, so the two canvases' top-left pixels must match,
// and match the clock read here.
for (const timezoneId of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
  test.describe(`the scene's clock agrees with the countdown's (${timezoneId})`, () => {
    test.use({ timezoneId });

    for (const now of ['2026-12-01T03:00:00', '2026-12-01T07:15:00', '2026-12-01T12:00:00', '2026-12-01T18:15:00']) {
      test(`at ${now} both show the same phase`, async ({ page }) => {
        await open(page, now);
        await globeReady(page);
        const [d, t] = now.split('T') as [string, string];
        const [y, mo, day] = d.split('-').map(Number) as [number, number, number];
        const [h, mi, s] = t.split(':').map(Number) as [number, number, number];
        const at = new Date(y, mo - 1, day, h, mi, s);
        const sky = rgb(skyAndInk(phaseAt(at)).sky);
        expect((await canvasPixel(page, 'canvas#countdown', 0, 0)).slice(0, 3)).toEqual(sky);
        expect((await canvasPixel(page, 'canvas#scene', 0, 0)).slice(0, 3)).toEqual(sky);
        // The ground, which no seed or time changes, is the engine's for that phase.
        const viewport = page.viewportSize()!;
        const { width, height } = pagePixels(viewport, await page.evaluate(() => window.devicePixelRatio));
        const frame = sceneFrame({ time: 0, drag: 0, phase: phaseAt(at), seed: 1, width, height });
        const ground = numberRgb(frame.picture[(height - 1) * width] ?? -1);
        expect((await canvasPixel(page, 'canvas#scene', 0, height - 1)).slice(0, 3)).toEqual(ground);
      });
    }

    test('inside a blend (06:20, Purple night into Dawn) both show the same mixed sky', async ({ page }) => {
      await open(page, '2026-12-01T06:20:00');
      await globeReady(page);
      const want = rgb(skyAndInk(phaseAt(new Date(2026, 11, 1, 6, 20, 0))).sky);
      const countdown = (await canvasPixel(page, 'canvas#countdown', 0, 0)).slice(0, 3);
      const scene = (await canvasPixel(page, 'canvas#scene', 0, 0)).slice(0, 3);
      // The countdown reads whole seconds and the scene each frame: allow one step of rounding, no more.
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(countdown[i]! - want[i]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(scene[i]! - countdown[i]!)).toBeLessThanOrEqual(1);
      }
    });
  });
}

// XMAS-31b review round 1: the scene draws on every refresh even when its
// picture holds still. At noon (Frosty morning) there are no stars to
// twinkle, so nothing changes from frame to frame; frames are drawn anyway.
test.describe('every refresh, even with a still picture', () => {
  const NOON = '2026-12-01T12:00:00';

  for (const now of [NOW, NOON]) {
    test(`at ${now} frames keep being drawn once per refresh, two seconds in and later`, async ({ page }) => {
      await instrument(page);
      await open(page, now);
      await globeReady(page);
      await page.waitForTimeout(2000); // long past any "held still for a second"
      const a = await probe(page);
      await page.waitForTimeout(1000);
      const b = await probe(page);
      const fired = b.raf.fired - a.raf.fired;
      const drawn = b.draws - a.draws;
      expect(fired).toBeGreaterThan(20);
      expect(drawn).toBeLessThanOrEqual(fired);
      expect(drawn).toBeGreaterThanOrEqual(fired - 2);
      expect(b.raf.max).toBe(1);
    });
  }

  test('a tab hidden at noon and shown at 22:00 shows the night on the very next frame', async ({ page }) => {
    // The page's clock runs on a skewable Date, so time can jump while the tab is hidden.
    await page.addInitScript(() => {
      const w = window as unknown as { __skew: number };
      w.__skew = 0;
      const RealDate = Date;
      const realNow = RealDate.now.bind(RealDate);
      class SkewedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(realNow() + w.__skew);
          else super(...(args as [number]));
        }
        static override now(): number {
          return realNow() + w.__skew;
        }
      }
      (window as unknown as { Date: DateConstructor }).Date = SkewedDate as unknown as DateConstructor;
    });
    await instrument(page);
    await open(page, NOON);
    await globeReady(page);
    await page.waitForTimeout(1500); // the noon picture has held still for over a second
    const noonSky = rgb(skyAndInk(phaseAt(new Date(2026, 11, 1, 12, 0, 0))).sky);
    expect((await canvasPixel(page, 'canvas#scene', 0, 0)).slice(0, 3)).toEqual(noonSky);
    await hide(page, true);
    await page.evaluate((ms) => {
      (window as unknown as { __skew: number }).__skew = ms;
    }, 10 * 60 * 60 * 1000); // ten hours on: 22:00, Purple night
    const nightSky = rgb(skyAndInk(phaseAt(new Date(2026, 11, 1, 22, 0, 0))).sky);
    expect(nightSky).not.toEqual(noonSky);
    // Show the tab, then wait two screen refreshes: the first frame after showing has been drawn.
    const pixel = await page.evaluate(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const c = document.querySelector<HTMLCanvasElement>('canvas#scene')!;
      return Array.from(c.getContext('2d')!.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    expect(pixel).toEqual(nightSky);
  });
});

// XMAS-31b review round 1 [nit]: when the window is narrower than the
// smallest picture, the picture overhangs it; the scene's countdown strip
// (full picture width) must still sit centred under the countdown, so the
// countdown and the globe's place stay lined up.
test.describe('the countdown stays centred on the scene', () => {
  for (const viewport of [
    { width: 150, height: 400 },
    { width: 240, height: 500 },
    { width: 1280, height: 720 },
  ]) {
    test(`at ${viewport.width}x${viewport.height} the countdown's centre is the picture's centre`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page);
      await globeReady(page);
      const { scale } = pagePixels(viewport, 1);
      const scene = await rect(page, 'canvas#scene');
      const countdown = await rect(page, 'canvas#countdown');
      // Within one art pixel: the picture may overhang the window by a part-pixel.
      expect(Math.abs(countdown.x + countdown.width / 2 - (scene.x + scene.width / 2))).toBeLessThanOrEqual(scale);
      // The picture still covers the window.
      expect(scene.x).toBeLessThanOrEqual(0.05);
      expect(scene.x + scene.width).toBeGreaterThanOrEqual(viewport.width - 0.05);
    });
  }
});
