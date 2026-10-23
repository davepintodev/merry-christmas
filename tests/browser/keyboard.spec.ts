// XMAS-44b "Keyboard wiring, focus and the focus ring", in the built page: the globe takes
// focus first and is announced, arrows turn it, Space or Enter bursts, nothing scrolls,
// a pause ignores keys, and the shared square focus ring shows for keyboard focus only.
// Same fake clock and picture hashes as pause.spec.ts; a "control" run is a fresh page given
// the same clock steps without the key, so a different picture means the key did something.
import { expect, test, type Browser, type Page } from '@playwright/test';
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


const ANNOUNCED = 'Snow globe. Arrow keys turn it, Space shakes the snow.';
const globe = (page: Page) => page.locator('#globe');

/** Tab from the page start onto the globe, failing if it is not the globe that took focus. */
async function tabToGlobe(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
  await expect(globe(page)).toBeFocused();
}

/** Boots a fresh page, runs the steps, and returns the scene and glass pictures after one more second. */
async function scenario(browser: Browser, steps: (page: Page) => Promise<void>): Promise<string> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await boot(page);
    await steps(page);
    await page.clock.runFor(1000);
    // The turn-dependent glass reflections live on the glass layer canvas that follows #scene.
    return `${await picture(page, 'canvas#scene')}|${await picture(page, 'canvas#scene + canvas')}`;
  } finally {
    await context.close();
  }
}

/** The ring as the page styles the focused element: the dark outline and the light inset line. */
async function ring(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow, art: s.getPropertyValue('--art').trim() };
  });
}

test('Tab from the page start focuses the globe first, announced with its name', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Tab');
  await expect(globe(page)).toBeFocused();
  expect(await globe(page).getAttribute('aria-label')).toBe(ANNOUNCED);
});

test('the globe sits over the globe frame, square', async ({ page }) => {
  await boot(page);
  const { scale, width, height } = pagePixels(VIEWPORT, 1);
  const { cx, cy, radius } = sceneLayout(width, height, 1).globe;
  const scene = (await page.locator('canvas#scene').boundingBox())!;
  const box = (await globe(page).boundingBox())!;
  expect(Math.abs(box.width - 2 * radius * scale)).toBeLessThanOrEqual(2 * scale);
  expect(Math.abs(box.height - box.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.x + box.width / 2 - (scene.x + (cx + 0.5) * scale))).toBeLessThanOrEqual(2 * scale);
  expect(Math.abs(box.y + box.height / 2 - (scene.y + (cy + 0.5) * scale))).toBeLessThanOrEqual(2 * scale);
  expect(Number.parseFloat(await globe(page).evaluate((el) => getComputedStyle(el).getPropertyValue('--art')))).toBeCloseTo(scale, 3);
});

test('an arrow press turns the globe, and Space, Enter and the arrows do not scroll the page', async ({ page, browser }) => {
  await boot(page);
  await tabToGlobe(page);
  await page.evaluate(() => {
    (window as unknown as { prevented: string[] }).prevented = [];
    window.addEventListener('keydown', (e) => (window as unknown as { prevented: string[] }).prevented.push(`${e.key}:${e.defaultPrevented}`));
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as unknown as { prevented: string[] }).prevented)).toEqual(['ArrowRight:true', 'ArrowLeft:true', ' :true', 'Enter:true']);

  const control = await scenario(browser, async () => {});
  const turned = await scenario(browser, async (p) => {
    await tabToGlobe(p);
    await p.keyboard.press('ArrowRight');
  });
  expect(turned).not.toBe(control);
});

test('a held arrow turns the globe steadily, and neither its repeats nor holding it add a burst', async ({ browser }) => {
  const hold = (repeats: number) => (p: Page) =>
    (async () => {
      await tabToGlobe(p);
      await p.keyboard.down('ArrowRight');
      for (let k = 0; k < repeats; k++) await p.keyboard.down('ArrowRight'); // auto-repeat keydowns
      await p.clock.runFor(1000);
      await p.keyboard.up('ArrowRight');
    })();
  const control = await scenario(browser, async (p) => {
    await p.clock.runFor(1000);
  });
  const held = await scenario(browser, hold(0));
  expect(held).not.toBe(control);
  // Repeats of a held key are not new presses: no extra turn, stir or burst.
  expect(await scenario(browser, hold(5))).toBe(held);
});

test('Space and Enter each give the burst: the picture differs from a run without it', async ({ browser }) => {
  const control = await scenario(browser, async () => {});
  for (const key of ['Space', 'Enter']) {
    const burst = await scenario(browser, async (p) => {
      await tabToGlobe(p);
      await p.keyboard.press(key);
      await p.clock.runFor(150); // a few frames, so the burst has reached the picture
    });
    expect(burst, key).not.toBe(control);
  }
});

test('the ring: 2 art pixels, light inside and dark outside, for keyboard focus only', async ({ page }) => {
  await boot(page);
  await page.mouse.click(5, 300); // a pointer press on empty page first
  await page.keyboard.press('Tab');
  await expect(globe(page)).toBeFocused();
  const r = await ring(page, '#globe');
  const art = Number.parseFloat(r.art);
  expect(art).toBeGreaterThan(0);
  expect(r.outlineStyle).toBe('solid');
  expect(Number.parseFloat(r.outlineWidth)).toBeCloseTo(art, 2);
  expect(r.boxShadow).toMatch(/inset/);
  expect(r.boxShadow).toContain(` ${art}px inset`);
  // The buttons share the one ring: the sound button is the next stop, then the pause button.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const b = await ring(page, 'button#pause');
  expect(b.outlineStyle).toBe('solid');
  expect(b.outlineWidth).toBe(r.outlineWidth);
  expect(b.boxShadow).toBe(r.boxShadow);
});

test('a mouse click on the pause button shows no ring, while Tab to it does', async ({ page }) => {
  await boot(page);
  const pause = page.locator('button#pause');
  await pause.click();
  await expect(pause).toBeFocused();
  expect(await pause.evaluate((el) => el.matches(':focus-visible'))).toBe(false);
  const clicked = await ring(page, 'button#pause');
  expect(clicked.outlineStyle).toBe('none');
  expect(clicked.boxShadow).toBe('none');
  await globe(page).focus();
  await page.keyboard.press('Tab'); // the sound button
  await page.keyboard.press('Tab');
  await expect(pause).toBeFocused();
  expect((await ring(page, 'button#pause')).outlineStyle).toBe('solid');
});

test('while paused an arrow press or Space changes nothing, and keys work again after resume', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Pause the movement', exact: true }).click();
  await globe(page).focus();
  const frozen = await picture(page, 'canvas#scene');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await page.clock.runFor(1000);
  expect(await picture(page, 'canvas#scene')).toBe(frozen);
  await page.getByRole('button', { name: 'Resume the movement', exact: true }).click();
  await globe(page).focus();
  const moving = await picture(page, 'canvas#scene');
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(100);
  expect(await picture(page, 'canvas#scene')).not.toBe(moving);
});
