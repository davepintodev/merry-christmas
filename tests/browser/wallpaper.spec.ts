// XMAS-131 "Wallpaper Engine build": the wallpaper/ folder opened from file://,
// as Wallpaper Engine does. Needs `pnpm run build:wallpaper` first; a missing
// folder fails the tests instead of skipping them.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'wallpaper', 'index.html');

type Problems = { console: string[]; page: string[]; requests: string[] };

async function open(page: Page): Promise<Problems> {
  if (!existsSync(FILE)) throw new Error(`${FILE} is missing: run \`pnpm run build:wallpaper\` first`);
  const problems: Problems = { console: [], page: [], requests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.console.push(msg.text());
  });
  page.on('pageerror', (err) => problems.page.push(err.message));
  page.on('requestfailed', (req) => problems.requests.push(`${req.url()} ${req.failure()?.errorText ?? ''}`));
  // Pretend a browser that needs a tap, so the shake sign has a click to answer.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w['__asked'] = 0;
    class Fake extends Event {}
    (Fake as unknown as Record<string, unknown>)['requestPermission'] = () => {
      (w['__asked'] as number)++;
      return Promise.resolve('granted');
    };
    w['DeviceMotionEvent'] = Fake;
    w['__downs'] = [] as boolean[];
    window.addEventListener('pointerdown', (e) => (w['__downs'] as boolean[]).push(e.defaultPrevented));
  });
  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(() => performance.getEntriesByName('globe-ready', 'mark').length > 0, null, { timeout: 15_000 });
  return problems;
}

test('the scene loads and draws from file:// with a clean console', async ({ page }) => {
  const problems = await open(page);
  await page.waitForTimeout(500);
  expect(problems).toEqual({ console: [], page: [], requests: [] });
});

test('offers the Wallpaper Engine listener and has no sound or pause button', async ({ page }) => {
  await open(page);
  const kinds = await page.evaluate(() => {
    const l = (window as unknown as { wallpaperPropertyListener: Record<string, unknown> }).wallpaperPropertyListener;
    return ['applyUserProperties', 'applyGeneralProperties', 'setPaused'].map((k) => typeof l[k]);
  });
  expect(kinds).toEqual(['function', 'function', 'function']);
  await expect(page.locator('button#sound')).toHaveCount(0);
  await expect(page.locator('button#pause')).toHaveCount(0);
});

test('the shake sign shows and answers a mouse click', async ({ page }) => {
  await open(page);
  const shake = page.locator('button#shake');
  await expect(shake).toBeVisible();
  await shake.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(1);
});

test('a mouse drag on the scene canvas is taken as a drag', async ({ page }) => {
  await open(page);
  const box = (await page.locator('canvas#scene').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 20, y, { steps: 2 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { __downs: boolean[] }).__downs)).toEqual([true]);
});

for (const [width, height] of [[1920, 1080], [2560, 1440], [3440, 1440], [5120, 1440]] as const) {
  test(`at ${width}x${height} the countdown and the shake sign sit inside the viewport, off its edges`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    for (const selector of ['canvas#countdown', 'button#shake']) {
      await expect(page.locator(selector)).toBeVisible();
      const b = (await page.locator(selector).boundingBox())!;
      const label = `${selector} ${JSON.stringify(b)}`;
      expect(b.x, label).toBeGreaterThanOrEqual(1);
      expect(b.y, label).toBeGreaterThanOrEqual(1);
      expect(b.x + b.width, label).toBeLessThanOrEqual(width - 1);
      expect(b.y + b.height, label).toBeLessThanOrEqual(height - 1);
    }
  });
}
