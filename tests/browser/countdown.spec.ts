// XMAS-27 "Countdown on a plain sky", part B: the built page draws the
// countdown frame on <canvas id="countdown"> at a whole pixel scale, in the
// phase's sky and ink, ticks on the second, blinks the colons, redraws at once
// when the tab comes back, switches live to the Christmas Day greeting and
// back, makes no request beyond the document and stores nothing.
//
// The canvas is read back with getImageData and sampled at the centre of each
// art pixel, then compared with countdownFrame() from part A, so the page must
// show exactly the frame the pretend clock (?now=) asks for.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { phaseColours } from '../../art/colours.ts';
import { countdownFrame, type Frame } from '../../src/countdown/render.ts';
import { skyAndInk } from '../../src/countdown/colours.ts';
import { fitScale } from '../../src/countdown/scale.ts';
import { phaseAt, timeLeft } from '../../src/shared/clock.ts';

const GOLD = phaseColours['purple-night'].ink; // '#ffe08a'
const NIGHT_SKY = phaseColours['purple-night'].sky;
const RED = phaseColours['frosty-morning'].ink; // '#c8102e'
const DAY_SKY = phaseColours['frosty-morning'].sky;

/** A local wall-clock time, as ?now= reads it. */
function local(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  return new Date(y, mo - 1, d, h, mi, s, 0);
}

function plus(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

interface Candidate { label: string; frame: Frame }

/** Countdown frames for `from` and the next `span` seconds, colons on and off. */
function candidates(from: Date, span: number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i <= span; i++) {
    const at = plus(from, i);
    const t = timeLeft(at);
    if (t.christmasDay) {
      out.push({ label: `+${i} greeting`, frame: countdownFrame(t, true) });
      continue;
    }
    out.push({ label: `+${i} on`, frame: countdownFrame(t, true) });
    out.push({ label: `+${i} off`, frame: countdownFrame(t, false) });
  }
  return out;
}

interface CanvasSize { width: number; height: number; cssWidth: number; cssHeight: number; dpr: number }

async function canvasSize(page: Page): Promise<CanvasSize> {
  return page.locator('canvas#countdown').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { width: c.width, height: c.height, cssWidth: r.width, cssHeight: r.height, dpr: window.devicePixelRatio };
  });
}

/**
 * Samples the canvas at the centre of each art pixel of a frame-sized grid:
 * '1' for the ink colour, '0' for anything else. Null when the canvas size is
 * not a whole multiple of the grid.
 */
async function readArt(page: Page, w: number, h: number, ink: string): Promise<string | null> {
  return page.locator('canvas#countdown').evaluate(
    (el, { w, h, ink }) => {
      const c = el as HTMLCanvasElement;
      if (c.width === 0 || c.width % w !== 0 || c.height % h !== 0 || c.width / w !== c.height / h) return null;
      const s = c.width / w;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const want = [1, 3, 5].map((at) => Number.parseInt(ink.slice(at, at + 2), 16));
      let bits = '';
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = ((y * s + (s >> 1)) * c.width + x * s + (s >> 1)) * 4;
          const hit = data[i] === want[0] && data[i + 1] === want[1] && data[i + 2] === want[2] && data[i + 3] === 255;
          bits += hit ? '1' : '0';
        }
      }
      return bits;
    },
    { w, h, ink },
  );
}

function bits(frame: Frame): string {
  return Array.from(frame.pixels, (p) => (p ? '1' : '0')).join('');
}

/** The label of the candidate the canvas shows exactly, or null. */
async function shown(page: Page, list: Candidate[], ink: string): Promise<string | null> {
  for (const { label, frame } of list) {
    const art = await readArt(page, frame.width, frame.height, ink);
    if (art !== null && art === bits(frame)) return label;
  }
  return null;
}

async function open(page: Page, now: string): Promise<void> {
  await page.goto(`/?now=${now}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
}

test('the canvas shows exactly the countdown frame for the pretend clock', async ({ page }) => {
  const at = local(2026, 12, 24, 23, 59, 50); // 00 days, 00 hrs, 00 min, 10 sec
  await open(page, '2026-12-24T23:59:50');
  expect(await shown(page, candidates(at, 2), GOLD)).toMatch(/^\+[0-2] (on|off)$/);
});

test('layout: a title row above the digit row and a label row under it', async ({ page }) => {
  await open(page, '2026-12-24T22:00:00');
  const frame = countdownFrame(timeLeft(local(2026, 12, 24, 22, 0, 0)), false);
  const size = await canvasSize(page);
  const scale = size.width / frame.width;
  const bands = await page.locator('canvas#countdown').evaluate(
    (el, { ink, scale }) => {
      const c = el as HTMLCanvasElement;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const want = [1, 3, 5].map((at) => Number.parseInt(ink.slice(at, at + 2), 16));
      const rows: boolean[] = [];
      for (let y = 0; y < c.height; y += scale) {
        let any = false;
        for (let x = 0; x < c.width && !any; x++) {
          const i = (y * c.width + x) * 4;
          any = data[i] === want[0] && data[i + 1] === want[1] && data[i + 2] === want[2];
        }
        rows.push(any);
      }
      const out: { top: number; height: number }[] = [];
      rows.forEach((on, y) => {
        const last = out[out.length - 1];
        if (on && last && last.top + last.height === y) last.height++;
        else if (on) out.push({ top: y, height: 1 });
      });
      return out;
    },
    { ink: GOLD, scale },
  );
  expect(bands).toHaveLength(3);
  const [title, digits, labels] = bands;
  expect(digits!.height).toBeGreaterThan(title!.height * 2);
  expect(digits!.height).toBeGreaterThan(labels!.height * 2);
  expect(title!.top).toBeLessThan(digits!.top);
  expect(labels!.top).toBeGreaterThan(digits!.top);
});

test('three-digit days widen the frame; the canvas follows at the same whole scale', async ({ page }) => {
  const at = local(2026, 9, 1, 12, 0, 0); // 115 days
  expect(timeLeft(at).days).toBeGreaterThanOrEqual(100);
  await open(page, '2026-09-01T12:00:00');
  expect(await shown(page, candidates(at, 2), RED)).not.toBeNull();
  const wide = countdownFrame(timeLeft(at), true);
  const narrow = countdownFrame(timeLeft(local(2026, 12, 1, 12, 0, 0)), true);
  expect(wide.width).toBeGreaterThan(narrow.width);
  const size = await canvasSize(page);
  expect(size.width % wide.width).toBe(0);
  expect(size.width / wide.width).toBe(size.height / wide.height);
});

test('the canvas keeps its size as the value ticks over (no jump)', async ({ page }) => {
  await open(page, '2026-12-01T11:59:58');
  const before = await canvasSize(page);
  await page.waitForTimeout(3200); // through 12:00:00
  const after = await canvasSize(page);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
});

test('the digits change on the second', async ({ page }) => {
  const at = local(2026, 12, 1, 22, 0, 0);
  await open(page, '2026-12-01T22:00:00');
  const list = candidates(at, 6);
  const first = await shown(page, list, GOLD);
  await page.waitForTimeout(1200);
  const second = await shown(page, list, GOLD);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  const tick = (label: string | null) => Number(/^\+(\d+)/.exec(label ?? '')?.[1]);
  expect(tick(second)).toBeGreaterThan(tick(first));
});

test('the colons blink: on and off on consecutive seconds', async ({ page }) => {
  const at = local(2026, 12, 1, 22, 0, 0);
  await open(page, '2026-12-01T22:00:00');
  const list = candidates(at, 8);
  const seen = new Map<number, string>();
  for (let i = 0; i < 4; i++) {
    const label = await shown(page, list, GOLD);
    expect(label).not.toBeNull();
    const [, n, state] = /^\+(\d+) (on|off)$/.exec(label!)!;
    seen.set(Number(n), state!);
    await page.waitForTimeout(1000);
  }
  const ticks = [...seen.keys()].sort((a, b) => a - b);
  expect(new Set(seen.values())).toEqual(new Set(['on', 'off']));
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i] === ticks[i - 1]! + 1) expect(seen.get(ticks[i]!)).not.toBe(seen.get(ticks[i - 1]!));
  }
});

test.describe('redraws at once (timers frozen)', () => {
  const start = local(2026, 12, 1, 22, 0, 0);

  async function frozen(page: Page): Promise<void> {
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
    await open(page, '2026-12-01T22:00:00');
    expect(await shown(page, candidates(start, 0), GOLD)).not.toBeNull();
    // Time moves on while no timer fires, as in a background tab.
    await page.clock.setSystemTime(plus(start, 125));
  }

  const later = candidates(plus(start, 125), 0);

  test('when the tab becomes visible again', async ({ page }) => {
    await frozen(page);
    expect(await shown(page, later, GOLD)).toBeNull(); // nothing redrew yet
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await shown(page, later, GOLD)).not.toBeNull();
  });

  test('on pageshow', async ({ page }) => {
    await frozen(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(await shown(page, later, GOLD)).not.toBeNull();
  });

  test('on resize, at the new whole scale', async ({ page }) => {
    await frozen(page);
    await page.setViewportSize({ width: 400, height: 300 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    expect(await shown(page, later, GOLD)).not.toBeNull();
    const frame = later[0]!.frame;
    const size = await canvasSize(page);
    expect(size.width / frame.width).toBe(fitScale(frame, { width: 400, height: 300 }, size.dpr));
  });
});

test('phase colours: gold ink on the night sky at 22:00, red ink on the day sky at 12:00', async ({ page }) => {
  for (const [now, sky, ink] of [
    ['2026-12-01T22:00:00', NIGHT_SKY, GOLD],
    ['2026-12-01T12:00:00', DAY_SKY, RED],
  ] as const) {
    await open(page, now);
    const result = await page.locator('canvas#countdown').evaluate(
      (el, { sky, ink }) => {
        const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
        const css = (hex: string) => `rgb(${rgb(hex).join(', ')})`;
        const c = el as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        const [s, k] = [rgb(sky), rgb(ink)];
        let inkCount = 0;
        let stray = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 0) continue;
          const px = [data[i], data[i + 1], data[i + 2]];
          const isInk = px.every((v, j) => v === k[j]) && data[i + 3] === 255;
          const isSky = px.every((v, j) => v === s[j]) && data[i + 3] === 255;
          if (isInk) inkCount++;
          else if (!isSky) stray++;
        }
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
        return { inkCount, stray, bodyOk: bodyBg === css(sky), pageOk: htmlBg === css(sky) || htmlBg === 'rgba(0, 0, 0, 0)' };
      },
      { sky, ink },
    );
    expect(result.inkCount, now).toBeGreaterThan(0);
    expect(result.stray, `${now}: pixels neither sky nor ink`).toBe(0);
    expect(result.bodyOk, `${now}: body background is the sky`).toBe(true);
    expect(result.pageOk, `${now}: page background is the sky`).toBe(true);
  }
});

for (const dpr of [2, 3]) {
  test(`whole physical pixels per art pixel at devicePixelRatio ${dpr}, hard edges`, async ({ browser }: { browser: Browser }) => {
    const viewport = { width: 800, height: 600 };
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport });
    const page = await context.newPage();
    const at = local(2026, 12, 1, 22, 0, 0);
    await open(page, '2026-12-01T22:00:00');
    const frame = countdownFrame(timeLeft(at), true);
    const size = await canvasSize(page);
    expect(size.dpr).toBe(dpr);
    expect(size.width).toBe(frame.width * fitScale(frame, viewport, dpr));
    expect(size.height).toBe(frame.height * fitScale(frame, viewport, dpr));
    // CSS size is canvas size / dpr. Chromium lays out on a 1/64 CSS px grid,
    // so allow that rounding (1/64 * 3 < 0.05 physical px), no more.
    expect(size.width % frame.width).toBe(0);
    expect(size.height % frame.height).toBe(0);
    expect(Math.abs(size.cssWidth * dpr - size.width)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(size.cssHeight * dpr - size.height)).toBeLessThanOrEqual(0.05);
    expect(await page.locator('canvas#countdown').evaluate((el) => getComputedStyle(el).imageRendering)).toBe('pixelated');
    expect(await shown(page, candidates(at, 2), GOLD)).not.toBeNull();
    await context.close();
  });
}

test('at zero it switches live to the greeting, with no reload', async ({ page }) => {
  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations++;
  });
  await open(page, '2026-12-24T23:59:58');
  const before = await canvasSize(page);
  await page.evaluate(() => {
    (window as unknown as { marker: string }).marker = 'kept';
  });
  await page.waitForTimeout(3000);
  const greeting = countdownFrame(timeLeft(local(2026, 12, 25, 0, 0, 1)), true);
  expect(await shown(page, [{ label: 'greeting', frame: greeting }], GOLD)).toBe('greeting');
  const after = await canvasSize(page);
  expect(after.width / greeting.width).toBe(after.height / greeting.height);
  expect([after.width, after.height]).not.toEqual([before.width, before.height]);
  expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe('kept');
  expect(navigations).toBe(1);
});

test('at midnight on 26 December the countdown comes back with a full year to go', async ({ page }) => {
  await open(page, '2026-12-25T23:59:58');
  await page.waitForTimeout(3000);
  const back = local(2026, 12, 26, 0, 0, 0);
  expect([364, 365]).toContain(timeLeft(back).days);
  const label = await shown(page, candidates(back, 3), GOLD);
  expect(label).toMatch(/^\+\d (on|off)$/);
});

test('marks countdown-visible once, at the first draw', async ({ page }) => {
  await open(page, '2026-12-01T22:00:00');
  await page.waitForTimeout(1500); // later redraws add no further mark
  expect(await page.evaluate(() => performance.getEntriesByName('countdown-visible', 'mark').length)).toBe(1);
});

test('the canvas takes no keyboard focus and nothing is stored', async ({ page }) => {
  await open(page, '2026-12-01T22:00:00');
  const canvas = page.locator('canvas#countdown');
  expect(await canvas.getAttribute('tabindex')).toBeNull();
  expect(await canvas.getAttribute('aria-hidden')).toBe('true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    dbs: (await indexedDB.databases()).length,
  }));
  expect(stored).toEqual({ local: 0, session: 0, cookie: '', dbs: 0 });
});

test('the page makes no request beyond the document, and shows no image or error text', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(new URL(req.url()).pathname));
  await open(page, '2026-12-01T22:00:00');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  expect(requests.filter((p) => p !== '/' && p !== '/favicon.ico')).toEqual([]);
  expect(await page.locator('script[src]').count()).toBe(0);
  expect(await page.locator('img').count()).toBe(0);
  const text = (await page.locator('body').innerText()).trim();
  expect(text).not.toMatch(/error|retry|failed|loading/i);
});

test('with scripts off: only the line "Christmas is on 25 December" shows', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/?now=2026-12-01T22:00:00');
  expect((await page.locator('body').innerText()).trim()).toBe('Christmas is on 25 December');
  await expect(page.getByText('Christmas is on 25 December', { exact: true })).toBeVisible();
  expect(await page.locator('img').count()).toBe(0);
  await context.close();
});

// Review finding: the sky and ink follow the 30-minute blends, mixed by the
// share, not the colour at either end of the blend.
for (const [now, at] of [
  ['2026-12-01T17:30:00', local(2026, 12, 1, 17, 30, 0)], // mid sunset blend
  ['2026-12-01T17:16:00', local(2026, 12, 1, 17, 16, 0)], // just into the sunset blend
  ['2026-12-01T06:30:00', local(2026, 12, 1, 6, 30, 0)], // mid dawn blend
] as const) {
  test(`inside a blend (${now}) the sky and ink are the mixed colours`, async ({ page }) => {
    const reading = phaseAt(at);
    expect(reading.share).toBeGreaterThan(0);
    const mixes = [0, 1, 2, 3].map((i) => skyAndInk(phaseAt(plus(at, i))));
    const ends = [phaseColours[reading.from], phaseColours[reading.to]];
    for (const end of ends) {
      expect(mixes[0]!.sky).not.toBe(end.sky);
      if (ends[0]!.ink !== ends[1]!.ink) expect(mixes[0]!.ink).not.toBe(end.ink);
    }
    await open(page, now);
    const result = await page.locator('canvas#countdown').evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const hex = (i: number) => '#' + [0, 1, 2].map((j) => data[i + j]!.toString(16).padStart(2, '0')).join('');
      const seen = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        const h = hex(i);
        seen.set(h, (seen.get(h) ?? 0) + 1);
      }
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(getComputedStyle(document.body).backgroundColor);
      const body = m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : '';
      return { colours: [...seen.keys()], body };
    });
    const pair = mixes.find((mix) => mix.sky === result.body);
    expect(pair, `body background ${result.body} is a mixed sky`).toBeDefined();
    expect(result.colours).toContain(pair!.ink);
    for (const colour of result.colours) expect([pair!.sky, pair!.ink]).toContain(colour);
    expect(await shown(page, candidates(at, 3), pair!.ink)).not.toBeNull();
  });
}

// Review finding: every tick reads the clock afresh, so a jump of the device
// clock (sleep, a manual change, a zone change) shows at the next second
// instead of the old value counting down by one.
for (const [name, skewMs] of [
  ['forward 3 hours', 3 * 60 * 60 * 1000],
  ['back 1 hour', -60 * 60 * 1000],
] as const) {
  test(`a device clock jump ${name} shows within a second or so`, async ({ page }) => {
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
    const start = local(2026, 12, 1, 22, 0, 0);
    await open(page, '2026-12-01T22:00:00');
    expect(await shown(page, candidates(start, 2), GOLD)).not.toBeNull();
    const loadedAt = Date.now();
    await page.evaluate((ms) => {
      (window as unknown as { __skew: number }).__skew = ms;
    }, skewMs);
    // Only frames for the jumped time, each with the colon state its second asks for.
    const jumped: Candidate[] = [];
    for (let i = 0; i <= 5; i++) {
      const at = plus(start, skewMs / 1000 + i);
      jumped.push({ label: `+${i}`, frame: countdownFrame(timeLeft(at), at.getSeconds() % 2 === 0) });
    }
    await expect
      .poll(() => shown(page, jumped, GOLD), { timeout: 1500, intervals: [100] })
      .not.toBeNull();
    expect(Date.now() - loadedAt).toBeLessThan(5000);
  });
}

// Review round 2. These run without ?now on a fixed UTC instant, with the
// expected values worked out by hand, so they do not depend on the zone of
// the machine running the tests.
const EVE_NOON_UTC = Date.UTC(2026, 11, 24, 12, 0, 0); // 12 h before Christmas in UTC

/** The countdown frame for a number of whole seconds left. */
function frameLeft(left: number, colonOn: boolean): Frame {
  return countdownFrame(
    {
      christmasDay: false,
      days: Math.floor(left / 86400),
      hours: Math.floor(left / 3600) % 24,
      minutes: Math.floor(left / 60) % 60,
      seconds: left % 60,
    },
    colonOn,
  );
}

test.describe('on the device clock (no ?now)', () => {
  test.use({ timezoneId: 'UTC' });

  test('the value changes when the device clock reaches the whole second', async ({ page }) => {
    await page.clock.install({ time: EVE_NOON_UTC });
    await page.clock.pauseAt(EVE_NOON_UTC + 300); // load 300 ms into a second
    await page.goto('/');
    await expect(page.locator('canvas#countdown')).toBeVisible();
    // 12:00:00.300 UTC: 12:00:00 left, colon on (second 0 is even).
    expect(await shown(page, [{ label: 'now', frame: frameLeft(12 * 3600, true) }], RED)).toBe('now');
    await page.clock.runFor(700); // the device clock is now exactly 12:00:01
    // A timer started at load (setInterval 1000) would still show 12:00:00 here.
    expect(await shown(page, [{ label: 'next', frame: frameLeft(12 * 3600 - 1, false) }], RED)).toBe('next');
  });
});

test('a time zone change on the device shows within a second or so', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await page.clock.install({ time: EVE_NOON_UTC });
  await page.goto('/');
  await expect(page.locator('canvas#countdown')).toBeVisible();
  // In UTC, 12:00:00 on 24 December: 12 h left (plus up to a few elapsed seconds).
  const utc: Candidate[] = [];
  for (let i = 0; i <= 5; i++) utc.push({ label: `utc+${i}`, frame: frameLeft(12 * 3600 - i, i % 2 === 0) });
  expect(await shown(page, utc, RED)).not.toBeNull(); // midday: red ink

  // Honolulu is UTC-10 all year: the same instant is 02:00 on 24 December,
  // 22 h left, at night, so the ink turns gold too.
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Pacific/Honolulu' });
  const honolulu: Candidate[] = [];
  for (let i = 0; i <= 10; i++) honolulu.push({ label: `hnl+${i}`, frame: frameLeft(22 * 3600 - i, i % 2 === 0) });
  await expect.poll(() => shown(page, honolulu, GOLD), { timeout: 1500, intervals: [100] }).not.toBeNull();
});
