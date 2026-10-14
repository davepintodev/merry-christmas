// XMAS-33 "The ?perf readout", in the built page (vite preview of dist/).
//
// Opening the site with the hidden `?perf` option (spec 3.9) shows a small
// readout over the scene: the countdown-visible and globe-ready times, the
// frame rate over the last second and over a 30 s window the owner can
// restart, the worst frame since globe-ready, the scene's work per frame and
// which version runs. Its code is a third file, /assets/perf-<hash>.js,
// fetched only with the option and only after the countdown shows; without
// it nothing about the readout is requested. It never covers the countdown
// or the button corners, reads on a phone, and costs the scene nothing.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { GREETING, spokenTime } from '../../src/countdown/announce.ts';
import { timeLeft } from '../../src/shared/clock.ts';

const NOW = '2026-12-01T22:00:00';
const PERF_FILE = /\/assets\/perf-[^/?]+\.js(\?.*)?$/;
const KEYS = ['countdown-visible', 'globe-ready', 'fps-now', 'fps-window', 'worst-frame', 'work', 'version'] as const;
const DASH = '–';
/** The tap areas the sound/pause (bottom-left) and shake (bottom-right) buttons will take. */
const CORNER = { width: 160, height: 60 };

type Rect = { x: number; y: number; width: number; height: number };
type Probe = { draws: number; errors: number; rejections: number };

/** Counts scene canvas draws and stray errors from the very start. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = { draws: 0, errors: 0, rejections: 0 };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    const proto = CanvasRenderingContext2D.prototype;
    for (const name of ['putImageData', 'drawImage'] as const) {
      const real = proto[name] as (...args: unknown[]) => void;
      (proto as unknown as Record<string, unknown>)[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        if (this.canvas.id !== 'countdown') probe.draws++;
        return real.apply(this, args);
      };
    }
    window.addEventListener('unhandledrejection', () => probe.rejections++);
    window.addEventListener('error', () => probe.errors++);
  });
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __probe: Probe }).__probe)) as Probe);
}

async function mark(page: Page, name: string): Promise<number> {
  const found = await page.evaluate((n) => performance.getEntriesByName(n, 'mark').map((m) => m.startTime), name);
  expect(found, `${name} marks`).toHaveLength(1);
  return found[0]!;
}

async function open(page: Page, search: string): Promise<void> {
  await page.goto(`/${search}`);
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

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function hide(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

function field(page: Page, key: string) {
  return page.locator(`#perf-readout [data-perf="${key}"]`);
}

/** The first number in a field's text, or NaN while it shows the dash. */
async function number(page: Page, key: string): Promise<number> {
  const text = (await field(page, key).textContent()) ?? '';
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  return match === null ? Number.NaN : Number(match[0]);
}

/** Every request the page makes other than the page itself. */
function requests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() !== 'document') urls.push(req.url());
  });
  return urls;
}

async function sized(browser: Browser, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 3 : 1 });
  const page = await context.newPage();
  await instrument(page);
  return { context, page };
}

async function readoutShown(page: Page): Promise<void> {
  await expect(page.locator('#perf-readout')).toBeVisible({ timeout: 10_000 });
}

test.describe('without ?perf nothing of the readout loads', () => {
  for (const search of ['', `?now=${NOW}`, `?now=${NOW}&perfect`, `?xperf=1&now=${NOW}`]) {
    test(`${search || 'no query'}: no readout request and no readout`, async ({ page }) => {
      const urls = requests(page);
      await open(page, search);
      await globeReady(page);
      await page.waitForLoadState('networkidle');
      expect(urls.filter((u) => /perf/i.test(new URL(u).pathname))).toEqual([]);
      expect(urls.filter((u) => PERF_FILE.test(u))).toEqual([]);
      await expect(page.locator('#perf-readout')).toHaveCount(0);
      expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /perf/i.test(new URL(e.name).pathname)).length)).toBe(0);
    });
  }
});

test.describe('with ?perf', () => {
  test('the readout file is asked for once, only after the countdown shows', async ({ page }) => {
    const urls = requests(page);
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await readoutShown(page);
    expect(urls.filter((u) => PERF_FILE.test(u))).toHaveLength(1);
    const timing = await page.evaluate(() => ({
      visible: performance.getEntriesByName('countdown-visible', 'mark')[0]?.startTime ?? Number.NaN,
      files: performance
        .getEntriesByType('resource')
        .filter((e) => /\/assets\/perf-[^/?]+\.js/.test(e.name))
        .map((e) => e.startTime),
    }));
    expect(timing.files).toHaveLength(1);
    expect(timing.files[0]!).toBeGreaterThanOrEqual(timing.visible);
  });

  test('the readout is a labelled group holding every field and a real restart button', async ({ page }) => {
    await instrument(page);
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await readoutShown(page);
    const readout = page.locator('#perf-readout');
    await expect(readout).toHaveAttribute('role', 'group');
    await expect(readout).toHaveAttribute('aria-label', 'Performance readout');
    expect(await readout.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    for (const key of [...KEYS, 'window']) await expect(field(page, key), key).toHaveCount(1);
    const button = page.getByRole('button', { name: 'Restart 30 s window' });
    await expect(button).toHaveCount(1);
    expect(await button.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect(await button.getAttribute('id')).toBe('perf-restart');
  });

  test('shows the launch marks, the frame rates, the worst frame, the work and the version', async ({ page }) => {
    await instrument(page);
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await readoutShown(page);
    await expect.poll(() => field(page, 'fps-window').textContent(), { timeout: 10_000 }).not.toBe(DASH);
    await expect.poll(() => number(page, 'worst-frame'), { timeout: 10_000 }).toBeGreaterThan(0);
    const visible = await mark(page, 'countdown-visible');
    const ready = await mark(page, 'globe-ready');
    expect(Math.abs((await number(page, 'countdown-visible')) - visible)).toBeLessThanOrEqual(1);
    expect(Math.abs((await number(page, 'globe-ready')) - ready)).toBeLessThanOrEqual(1);
    await expect(field(page, 'countdown-visible')).toHaveText(/^\d+ ms$/);
    await expect(field(page, 'globe-ready')).toHaveText(/^\d+ ms$/);
    await expect(field(page, 'fps-now')).toHaveText(/^\d+(\.\d)? fps$/);
    await expect(field(page, 'fps-window')).toHaveText(/^\d+(\.\d)? fps$/);
    await expect(field(page, 'worst-frame')).toHaveText(/^\d+(\.\d)? ms$/);
    await expect(field(page, 'work')).toHaveText(/^\d+(\.\d+)? ms$/);
    await expect(field(page, 'version')).toHaveText('full scene');
    await expect(field(page, 'window')).toContainText('30 s');
    const fps = await number(page, 'fps-window');
    expect(fps).toBeGreaterThan(0);
    expect(fps).toBeLessThan(1000);
  });

  test('updates about twice a second, not every frame', async ({ page }) => {
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await readoutShown(page);
    const changes = await page.locator('#perf-readout').evaluate(async (el) => {
      let count = 0;
      const observer = new MutationObserver((records) => {
        count += records.length > 0 ? 1 : 0;
      });
      observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      observer.disconnect();
      return count;
    });
    // About 4 updates in 2 s; a per-frame update would be over 100.
    expect(changes).toBeGreaterThanOrEqual(2);
    expect(changes).toBeLessThanOrEqual(10);
  });

  test('restart empties the window but keeps the worst frame', async ({ page }) => {
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await readoutShown(page);
    await expect.poll(() => number(page, 'window'), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => number(page, 'worst-frame'), { timeout: 10_000 }).toBeGreaterThan(0);
    const before = await number(page, 'window');
    const worst = await number(page, 'worst-frame');
    await page.getByRole('button', { name: 'Restart 30 s window' }).click();
    await expect.poll(() => number(page, 'window'), { timeout: 3_000 }).toBeLessThan(Math.min(before, 1.5));
    expect(await number(page, 'worst-frame')).toBeGreaterThanOrEqual(worst);
  });

  test('a hidden tab does not show up as the worst frame', async ({ page }) => {
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await readoutShown(page);
    await expect.poll(() => number(page, 'worst-frame'), { timeout: 10_000 }).toBeGreaterThan(0);
    await hide(page, true);
    await page.waitForTimeout(1500);
    await hide(page, false);
    await page.waitForTimeout(1200); // a few readout updates after the tab is back
    expect(await number(page, 'worst-frame')).toBeLessThan(1000);
  });

  test('costs the scene nothing visible: frames keep coming and the scene canvas does not move', async ({ browser }) => {
    const plain = await sized(browser, { width: 1280, height: 720 });
    const perf = await sized(browser, { width: 1280, height: 720 });
    await open(plain.page, `?now=${NOW}`);
    await open(perf.page, `?now=${NOW}&perf`);
    await globeReady(plain.page);
    await globeReady(perf.page);
    await readoutShown(perf.page);
    const first = (await probe(perf.page)).draws;
    await perf.page.waitForTimeout(1000);
    expect((await probe(perf.page)).draws - first).toBeGreaterThan(10);
    expect(await rect(perf.page, 'canvas#scene')).toEqual(await rect(plain.page, 'canvas#scene'));
    expect(await rect(perf.page, 'canvas#countdown')).toEqual(await rect(plain.page, 'canvas#countdown'));
    expect(await probe(perf.page)).toMatchObject({ errors: 0, rejections: 0 });
    await plain.context.close();
    await perf.context.close();
  });
});

test.describe('the readout on screen', () => {
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 640, height: 360 },
    { width: 1280, height: 720 },
  ]) {
    test(`at ${viewport.width}x${viewport.height}: inside the window, clear of the countdown and the button corners, readable`, async ({
      browser,
    }) => {
      const { context, page } = await sized(browser, viewport);
      await open(page, `?now=${NOW}&perf`);
      await globeReady(page);
      await readoutShown(page);
      const box = await rect(page, '#perf-readout');
      const countdown = await rect(page, 'canvas#countdown');
      expect(box.width).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(overlaps(box, countdown), `readout ${JSON.stringify(box)} over countdown ${JSON.stringify(countdown)}`).toBe(false);
      expect(box.y).toBeGreaterThanOrEqual(countdown.y + countdown.height - 0.5); // just below it
      const left = { x: 0, y: viewport.height - CORNER.height, ...CORNER };
      const right = { x: viewport.width - CORNER.width, y: viewport.height - CORNER.height, ...CORNER };
      expect(overlaps(box, left), 'over the bottom-left buttons').toBe(false);
      expect(overlaps(box, right), 'over the bottom-right button').toBe(false);
      // The countdown is still what sits at its own centre.
      const onTop = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.id,
        { x: countdown.x + countdown.width / 2, y: countdown.y + countdown.height / 2 },
      );
      expect(onTop).toBe('countdown');
      const style = await page.locator('#perf-readout').evaluate((el) => {
        const s = getComputedStyle(el);
        const button = getComputedStyle(el.querySelector('#perf-restart')!);
        const fields = [...el.querySelectorAll('[data-perf]')].map((f) => parseFloat(getComputedStyle(f).fontSize));
        return {
          fontFamily: s.fontFamily,
          fontSize: parseFloat(s.fontSize),
          fields,
          background: s.backgroundColor,
          color: s.color,
          pointer: s.pointerEvents,
          buttonPointer: button.pointerEvents,
        };
      });
      expect(style.fontFamily).toMatch(/monospace/);
      expect(style.fontSize).toBeGreaterThanOrEqual(12);
      for (const size of style.fields) expect(size).toBeGreaterThanOrEqual(12);
      expect(style.pointer).toBe('none');
      expect(style.buttonPointer).not.toBe('none');
      const bg = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(style.background);
      const fg = /rgba?\((\d+), (\d+), (\d+)/.exec(style.color);
      expect(bg, style.background).not.toBeNull();
      expect(fg, style.color).not.toBeNull();
      const alpha = bg![4] === undefined ? 1 : Number(bg![4]);
      expect(alpha).toBeGreaterThan(0.3); // semi-opaque
      expect(alpha).toBeLessThan(1);
      const lum = (m: RegExpExecArray): number => (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
      expect(lum(bg!)).toBeLessThan(80); // dark
      expect(lum(fg!)).toBeGreaterThan(180); // light
      await context.close();
    });
  }
});

test.describe('?perf with ?now', () => {
  test('on Christmas Day the greeting shows, with the readout', async ({ page }) => {
    await open(page, '?now=2026-12-25T10:00:00&perf');
    await globeReady(page);
    await readoutShown(page);
    await expect(page.locator('#countdown-text')).toHaveText(GREETING);
  });

  test('ten seconds before, the countdown reads as it does without the option', async ({ page }) => {
    await open(page, '?now=2026-12-24T23:59:50&perf');
    await globeReady(page);
    await readoutShown(page);
    await expect(page.locator('#countdown-text')).toHaveText(spokenTime(timeLeft(new Date(2026, 11, 24, 23, 59, 50))));
  });

  test('the option may come first', async ({ page }) => {
    await open(page, '?perf&now=2026-12-25T10:00:00');
    await globeReady(page);
    await readoutShown(page);
    await expect(page.locator('#countdown-text')).toHaveText(GREETING);
  });
});

test.describe('if the readout file fails to load', () => {
  test('nothing breaks: no page error, the countdown and the scene carry on', async ({ page }) => {
    await instrument(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    let hits = 0;
    await page.route(PERF_FILE, (route) => {
      hits++;
      return route.abort('failed');
    });
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await expect.poll(() => hits, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    const first = (await probe(page)).draws;
    await page.waitForTimeout(1000);
    expect((await probe(page)).draws - first).toBeGreaterThan(10);
    await expect(page.locator('#perf-readout')).toHaveCount(0);
    await expect(page.locator('canvas#countdown')).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(await probe(page)).toMatchObject({ errors: 0, rejections: 0 });
  });

  test('a readout file that throws as it runs is silent too', async ({ page }) => {
    await instrument(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    let hits = 0;
    await page.route(PERF_FILE, (route) => {
      hits++;
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: "throw new Error('perf boom');" });
    });
    await open(page, `?now=${NOW}&perf`);
    await globeReady(page);
    await expect.poll(() => hits, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    const first = (await probe(page)).draws;
    await page.waitForTimeout(1000);
    expect((await probe(page)).draws - first).toBeGreaterThan(10);
    expect(pageErrors).toEqual([]);
    expect(await probe(page)).toMatchObject({ errors: 0, rejections: 0 });
  });
});
