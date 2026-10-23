// XMAS-45b "Pause button on the page", in the built page: a real button in the
// bottom-left corner, one tap slot in, with two bars while the scene moves and a
// triangle while it is paused. A press toggles the scene's pause (XMAS-45a): the
// scene holds still, a drag does nothing, the countdown keeps ticking, and pausing
// across zero shows the greeting with the scene frozen. Reduce motion changes nothing.
//
// Determinism: as in drag.spec.ts, each run is on Playwright's fake clock, so the
// page's requestAnimationFrame and timers move only when a test runs the clock, and
// the same steps draw the same pictures. A picture is a hash of a canvas's pixels.
import { expect, test, type Page } from '@playwright/test';
import { masterColours } from '../../art/colours.ts';
import { GREETING } from '../../src/countdown/announce.ts';
import { drawings } from '../../src/shared/art.generated.ts';
import { pagePixels } from '../../src/page/pixel.ts';
import { sceneLayout } from '../../src/scene/frame.ts';

const NOW = '2026-12-01T22:00:00';
const START = new Date(2026, 11, 1, 22, 0, 0);
const VIEWPORT = { width: 800, height: 600 };
const STEP_MS = 16; // Playwright's fake requestAnimationFrame interval

/** The fake clock is paused this long after the page starts, then the scene's first frames are drawn. */
const SETTLE_MS = 30_000;

/** Opens the page at the pretend clock's time, lets the scene draw its first frame, and leaves the fake clock paused. */
async function boot(page: Page, { now = NOW, start = START, viewport = VIEWPORT }: { now?: string; start?: Date; viewport?: { width: number; height: number } } = {}): Promise<void> {
  await page.setViewportSize(viewport);
  await page.clock.install({ time: start });
  // The fake clock runs by itself until it is paused, so the scene file is held back until the clock is paused.
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
  for (let k = 0; k < 400 && !(await sceneDrawn(page)); k++) {
    await page.clock.runFor(STEP_MS); // one frame at a time, so the first frame is always the same fake moment
    await page.waitForTimeout(20); // the scene file arrives over the real network
  }
  expect(await sceneDrawn(page), 'the scene drew its first frame').toBe(true);
}

async function sceneDrawn(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.querySelector<HTMLCanvasElement>('canvas#scene')?.style.width));
}

/** A hash of a canvas's pixels: equal pictures give equal strings. */
async function picture(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i]!, 16777619);
    return `${c.width}x${c.height}:${hash >>> 0}`;
  });
}

/** The button's drawing as its canvas shows it: one entry per art pixel, the colour, or '' where transparent. */
async function buttonArt(page: Page): Promise<string[]> {
  return page.locator('button#pause canvas').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out: string[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const hex = [data[i], data[i + 1], data[i + 2]].map((v) => v!.toString(16).padStart(2, '0')).join('');
      out.push(data[i + 3] === 0 ? '' : `#${hex}`);
    }
    return out;
  });
}

/** A sheet drawing as buttonArt reads it. */
function expectedArt(name: 'pause-bars' | 'pause-triangle'): string[] {
  return Array.from(drawings[name]!.pixels, (n) => (n === 0 ? '' : masterColours[n - 1]!.toLowerCase()));
}

const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause the movement', exact: true });
const resumeButton = (page: Page) => page.getByRole('button', { name: 'Resume the movement', exact: true });

/** A mouse press in the middle of the button's tap area, as a visitor's tap is. */
async function tapButton(page: Page): Promise<void> {
  const box = await page.locator('button#pause').boundingBox();
  expect(box, 'the pause button has a box').not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

/** A mouse drag across the globe, 60 art pixels to the right, in ten moves. */
async function dragOnGlobe(page: Page): Promise<void> {
  const { scale, width, height } = pagePixels(VIEWPORT, 1);
  const { cx, cy } = sceneLayout(width, height, 1).globe;
  const box = (await page.locator('canvas#scene').boundingBox())!;
  const from = { x: box.x + (cx + 0.5) * scale, y: box.y + (cy + 0.5) * scale };
  const dx = 60 * scale;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(from.x + (dx * k) / 10, from.y);
    await page.clock.runFor(STEP_MS);
  }
  await page.mouse.up();
}

test('the button is named, sits in the bottom-left corner one slot in, and shows two bars while moving', async ({ page }) => {
  await boot(page, { viewport: { width: 360, height: 700 } });
  const button = pauseButton(page);
  await expect(button).toBeVisible();
  const box = (await page.locator('button#pause').boundingBox())!;
  // The sound button's corner slot is to the left, so this one starts one tap area in, and both keep 8 pixels from the page edge (XMAS-91).
  expect(box.x).toBeCloseTo(8 + box.width, 0);
  expect(box.y + box.height).toBeCloseTo(700 - 8, 0);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The drawing is centred in the tap area, to within a CSS pixel.
  const art = (await page.locator('button#pause canvas').boundingBox())!;
  expect(Math.abs(art.x + art.width / 2 - (box.x + box.width / 2))).toBeLessThan(1);
  expect(Math.abs(art.y + art.height / 2 - (box.y + box.height / 2))).toBeLessThan(1);
  expect(await buttonArt(page)).toEqual(expectedArt('pause-bars'));
});

test('pause and resume: the name and drawing change, and the scene holds still while paused', async ({ page }) => {
  await boot(page);
  await tapButton(page);
  await expect(resumeButton(page)).toBeVisible();
  expect(await buttonArt(page)).toEqual(expectedArt('pause-triangle'));
  const frozen = await picture(page, 'canvas#scene');
  await page.clock.runFor(1000);
  expect(await picture(page, 'canvas#scene')).toBe(frozen);
  await tapButton(page);
  await expect(pauseButton(page)).toBeVisible();
  expect(await buttonArt(page)).toEqual(expectedArt('pause-bars'));
  await page.clock.runFor(1000);
  expect(await picture(page, 'canvas#scene')).not.toBe(frozen);
});

test('input is ignored while paused: a drag on the globe changes nothing, and works again after resume', async ({ page }) => {
  await boot(page);
  await tapButton(page);
  const frozen = await picture(page, 'canvas#scene');
  await dragOnGlobe(page);
  await page.clock.runFor(1000);
  expect(await picture(page, 'canvas#scene')).toBe(frozen);
  await tapButton(page);
  const moving = await picture(page, 'canvas#scene');
  await dragOnGlobe(page);
  expect(await picture(page, 'canvas#scene')).not.toBe(moving);
});

test('the countdown keeps ticking while the scene is paused', async ({ page }) => {
  // Starts 30 seconds before the tap, so the run is short: a long run of fake frames is slow under load.
  await boot(page, { now: '2026-12-01T22:00:20', start: new Date(2026, 11, 1, 22, 0, 20) });
  await tapButton(page); // at 22:00:50
  const scene = await picture(page, 'canvas#scene');
  const digits = await picture(page, 'canvas#countdown');
  const text = await page.locator('#countdown-text').textContent();
  await page.clock.runFor(1000);
  expect(await picture(page, 'canvas#countdown')).not.toBe(digits); // the colons blink on the second
  await page.clock.runFor(12_000); // past 22:01:01, where the minutes count drops
  expect(await page.locator('#countdown-text').textContent()).not.toBe(text);
  expect(await picture(page, 'canvas#scene')).toBe(scene);
});

test('pausing across zero: the digits switch to the greeting and the scene stays frozen until resume', async ({ page }) => {
  // Starts 30 seconds before the tap, so the run is short: a long run of fake frames is slow under load.
  await boot(page, { now: '2026-12-24T23:59:20', start: new Date(2026, 11, 24, 23, 59, 20) });
  await tapButton(page); // at 23:59:50
  const frozen = await picture(page, 'canvas#scene');
  await page.clock.runFor(20_000); // through midnight, to 00:00:10
  await expect(page.locator('#countdown-text')).toHaveText(GREETING);
  expect(await picture(page, 'canvas#scene')).toBe(frozen);
  await tapButton(page);
  await page.clock.runFor(1000);
  expect(await picture(page, 'canvas#scene')).not.toBe(frozen);
});

test('reduce motion changes nothing: the button and the pictures match a run without it', async ({ page, browser }) => {
  /** The same steps on either page: the name, drawing and scene after each. */
  async function sequence(p: Page): Promise<unknown[]> {
    const seen: unknown[] = [];
    await tapButton(p);
    seen.push(await p.locator('button#pause').getAttribute('aria-label'), await buttonArt(p), await picture(p, 'canvas#scene'));
    await p.clock.runFor(1000);
    seen.push(await picture(p, 'canvas#scene'));
    await tapButton(p);
    seen.push(await p.locator('button#pause').getAttribute('aria-label'), await buttonArt(p), await picture(p, 'canvas#scene'));
    await p.clock.runFor(1000);
    seen.push(await picture(p, 'canvas#scene'));
    return seen;
  }

  await boot(page);
  const normal = await sequence(page);

  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  try {
    const reduced = await context.newPage();
    await boot(reduced);
    expect(await reduced.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await sequence(reduced)).toEqual(normal);
  } finally {
    await context.close();
  }
});

test('keyboard: Tab reaches the button, Space toggles it, and the focus ring shows only for keyboard focus', async ({ page }) => {
  await boot(page);
  const focusVisible = () => page.locator('button#pause').evaluate((el) => el.matches(':focus-visible'));
  await page.keyboard.press('Tab'); // the globe is the first stop
  await page.keyboard.press('Tab'); // then the sound button
  await page.keyboard.press('Tab');
  await expect(pauseButton(page)).toBeFocused();
  expect(await focusVisible()).toBe(true);
  await page.keyboard.press('Space');
  await expect(resumeButton(page)).toBeVisible();
  expect(await buttonArt(page)).toEqual(expectedArt('pause-triangle'));
  // A press moves focus with the pointer: the ring must not show for it.
  await page.locator('button#pause').evaluate((el) => (el as HTMLElement).blur());
  await tapButton(page);
  await expect(pauseButton(page)).toBeVisible();
  expect(await focusVisible()).toBe(false);
});
