// XMAS-43b "Shake wiring and the shake button", in the built page: where the browser needs a tap first, a real button
// at the bottom right reads "TAP TO TURN ON SHAKE", inside the viewport and off the globe's glass. What a tap does
// (granted, refused, silent, no tap needed) is covered by the unit tests. Motion is pretended: a fake
// DeviceMotionEvent is defined before the page runs.
// Determinism: as in pause.spec.ts, the page runs on Playwright's fake clock.
import { expect, test, type Page } from '@playwright/test';
import { pagePixels } from '../../src/page/pixel.ts';
import { sceneLayout } from '../../src/scene/frame.ts';

const START = new Date(2026, 11, 1, 22, 0, 0);
const NOW = '2026-12-01T22:00:00';
const VIEWPORT = { width: 360, height: 700 };
const SETTLE_MS = 30_000;
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

async function boot(page: Page, viewport = VIEWPORT): Promise<void> {
  await page.setViewportSize(viewport);
  await page.clock.install({ time: START });
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
  await page.clock.pauseAt(new Date(START.getTime() + SETTLE_MS));
  release();
  await page.waitForTimeout(300);
  for (let k = 0; k < 400 && !(await page.evaluate(() => Boolean(document.querySelector<HTMLCanvasElement>('canvas#scene')?.style.width))); k++) {
    await page.clock.runFor(STEP_MS);
    await page.waitForTimeout(20);
  }
}

const state = (page: Page) => page.evaluate(() => ({ listening: (window as never as Record<string, number>).__listening!, asked: (window as never as Record<string, number>).__asked! }));
const shakeButton = (page: Page) => page.getByRole('button', { name: 'TAP TO TURN ON SHAKE', exact: true });

test('where a tap is needed the button is shown from the start at the bottom right, named, with a tap area of 44 pixels or more, and nothing listens yet', async ({ page }) => {
  await pretend(page);
  await boot(page);
  await expect(shakeButton(page)).toBeVisible();
  const box = (await page.locator('button#shake').boundingBox())!;
  // XMAS-91: 8 pixels in from the right edge; on a phone width the button sits one row up, clear of the pause button.
  expect(box.x + box.width).toBeCloseTo(VIEWPORT.width - 8, 0);
  const pause = (await page.locator('button#pause').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(pause.y - 8 + 1);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await state(page)).toEqual({ listening: 0, asked: 0 });
});

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
