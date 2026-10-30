// XMAS-43b "Shake wiring and the shake button", XMAS-125 "Shake button covers the base lettering", in the built page:
// where the browser needs a tap first, a real button reads "TAP TO SHAKE" as a sign in the snow, under the globe's base
// on phones (never over it, nor over the sound and pause buttons), inside the viewport and off the globe's glass. What a
// tap does (granted, refused, silent, no tap needed) is covered by the unit tests. Motion is pretended: a fake
// DeviceMotionEvent is defined before the page runs.
// Determinism: as in pause.spec.ts, the page runs on Playwright's fake clock.
import { expect, test, type Page } from '@playwright/test';
import { pagePixels } from '../../src/page/pixel.ts';
import { sceneLayout } from '../../src/scene/frame.ts';

const START = new Date(2026, 11, 1, 22, 0, 0);
const NOW = '2026-12-01T22:00:00';
const VIEWPORT = { width: 360, height: 700 };
const SETTLE_MS = 30_000;
const SHAKE_NAME = 'TAP TO SHAKE';
const STEP_MS = 16;

/** Defines a pretend DeviceMotionEvent that needs a tap and grants access, and counts the page's devicemotion listeners (added minus removed). */
async function pretend(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__listening = 0;
    w.__asked = 0;
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'devicemotion') (w.__listening as number)++;
      return (add as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'devicemotion') (w.__listening as number)--;
      return (remove as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof window.removeEventListener;
    class Fake extends Event {}
    (Fake as unknown as Record<string, unknown>).requestPermission = () => {
      (w.__asked as number)++;
      return Promise.resolve('granted');
    };
    w.DeviceMotionEvent = Fake;
  });
}

async function boot(page: Page, viewport = VIEWPORT, now = NOW): Promise<void> {
  const start = now === NOW ? START : new Date(now);
  await page.setViewportSize(viewport);
  await page.clock.install({ time: start });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/[^/]+\.m?js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/?now=${now}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
  await page.clock.pauseAt(new Date(start.getTime() + SETTLE_MS));
  release();
  await page.waitForTimeout(300);
  for (let k = 0; k < 400 && !(await page.evaluate(() => Boolean(document.querySelector<HTMLCanvasElement>('canvas#scene')?.style.width))); k++) {
    await page.clock.runFor(STEP_MS);
    await page.waitForTimeout(20);
  }
}

const state = (page: Page) => page.evaluate(() => ({ listening: (window as never as Record<string, number>).__listening!, asked: (window as never as Record<string, number>).__asked! }));
const shakeButton = (page: Page) => page.getByRole('button', { name: SHAKE_NAME, exact: true });

test('where a tap is needed the button is shown from the start, named, with a tap area of 44 pixels or more, and nothing listens yet', async ({ page }) => {
  await pretend(page);
  await boot(page);
  await expect(shakeButton(page)).toBeVisible();
  const box = (await page.locator('button#shake').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await state(page)).toEqual({ listening: 0, asked: 0 });
});

/** The phone sizes the ticket names, with each one's real device pixel ratio (a new context per size: setViewportSize alone stays at 1). */
const PHONES = [
  [320, 568, 2], [375, 667, 2], [390, 600, 3], [390, 664, 3], [393, 727, 2.75], [430, 739, 3], [360, 700, 3], [412, 839, 2.625],
] as const;
const NIGHT = NOW;
const PHASE_TIMES = ['2026-12-01T07:00:00', '2026-12-01T12:00:00', '2026-12-01T18:00:00', '2026-12-25T10:00:00'];

for (const [width, height, dpr] of PHONES) {
  const times = (width === 390 && height === 600) || width === 320 ? [NIGHT, ...PHASE_TIMES] : [NIGHT];
  for (const now of times) {
    test(`XMAS-125: at ${width}x${height}@${dpr} (${now}) the drawn sign sits under the base, its 44-pixel tap area clear of sound and pause, inside the viewport`, async ({ browser }) => {
      const viewport = { width, height };
      const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
      const page = await context.newPage();
      await pretend(page);
      await boot(page, viewport, now);
      expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
      await expect(shakeButton(page)).toBeVisible();
      const b = (await page.locator('button#shake').boundingBox())!;
      const sign = (await page.locator('button#shake canvas').boundingBox())!;
      // The base's bottom edge, worked out from the engine's layout: the first art row under the base, from the canvas top.
      const p = pagePixels(viewport, dpr);
      const canvas = (await page.locator('canvas#scene').boundingBox())!;
      const baseEdge = canvas.y + ((sceneLayout(p.width, p.height, 1).groundTop + 23) * p.scale) / dpr;
      // The drawn sign stays under the base; the tap area may reach up over it, clear, to be 44 tall.
      expect(sign.y, `sign ${JSON.stringify(sign)}`).toBeGreaterThanOrEqual(baseEdge);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      expect(b.y + b.height).toBeLessThanOrEqual(height);
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      for (const id of ['sound', 'pause']) {
        const o = (await page.locator(`button#${id}`).boundingBox())!;
        expect(b.x >= o.x + o.width || o.x >= b.x + b.width || b.y >= o.y + o.height || o.y >= b.y + b.height, `${id} ${JSON.stringify(o)}`).toBe(true);
      }
      await context.close();
    });
  }
}

for (const viewport of [VIEWPORT, { width: 1920, height: 1130 }]) {
  test(`the button stays inside the viewport and off the globe's glass at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await pretend(page);
    await boot(page, viewport);
    await expect(shakeButton(page)).toBeVisible();
    const b = (await page.locator('button#shake').boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
    const { scale, width, height } = pagePixels(viewport, 1);
    const { cx, cy, radius } = sceneLayout(width, height, 1).globe;
    const canvas = (await page.locator('canvas#scene').boundingBox())!;
    const gx = canvas.x + (cx + 0.5) * scale;
    const gy = canvas.y + (cy + 0.5) * scale;
    // Distance from the globe's centre to the nearest point of the button's box.
    const nx = Math.min(Math.max(gx, b.x), b.x + b.width);
    const ny = Math.min(Math.max(gy, b.y), b.y + b.height);
    expect(Math.hypot(nx - gx, ny - gy), `button ${JSON.stringify(b)}, globe centre ${gx},${gy} radius ${radius * scale}`).toBeGreaterThanOrEqual(radius * scale);
  });
}
