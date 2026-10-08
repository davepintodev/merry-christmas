// XMAS-29 "Screen reader text and the announcement at zero" (spec 6.5).
//
// The page holds the countdown as real, visually hidden text in
// <… id="countdown-text"> (no seconds, updated once a minute, never a live
// region), and a separate polite live region <… id="countdown-announce"> that
// is empty until the page sees zero pass, then holds "Merry Christmas!" once.
// Loading on 25 December shows the greeting in the hidden text but announces
// nothing. All tests run in UTC so ?now and page.clock name the same instant
// and no DST change sits between the pretend time and Christmas.
import { expect, test, type Page } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

const TEXT = '#countdown-text';
const LIVE = '#countdown-announce';

async function open(page: Page, now: string): Promise<void> {
  await page.goto(`/?now=${now}`);
  await expect(page.locator('canvas#countdown')).toBeVisible();
}

/** Installs a paused page clock at a UTC wall time, then opens the page at the same ?now. */
async function openFrozen(page: Page, now: string): Promise<void> {
  const at = new Date(`${now}Z`);
  await page.clock.install({ time: at });
  await page.clock.pauseAt(at);
  await open(page, now);
}

async function text(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).textContent()) ?? '').trim();
}

/** Starts counting writes (added nodes or changed text) inside an element. */
async function watchWrites(page: Page, selector: string, key: string): Promise<void> {
  await page.evaluate(
    ({ selector, key }) => {
      const el = document.querySelector(selector);
      if (el === null) throw new Error(`no ${selector}`);
      const w = window as unknown as Record<string, number>;
      w[key] = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'characterData' || r.addedNodes.length > 0) w[key]!++;
        }
      }).observe(el, { childList: true, characterData: true, subtree: true });
    },
    { selector, key },
  );
}

async function writes(page: Page, key: string): Promise<number> {
  // A microtask turn so pending mutation records are delivered first.
  return page.evaluate(async (key) => {
    await Promise.resolve();
    return (window as unknown as Record<string, number>)[key] ?? -1;
  }, key);
}

test('an ordinary moment: the hidden text reads days, hours and minutes until Christmas', async ({ page }) => {
  await open(page, '2026-10-07T19:47:30'); // 78 d 4 h 12 min 30 s left
  await expect(page.locator(TEXT)).toHaveText('78 days, 4 hours and 12 minutes until Christmas');
});

test('singular forms: 1 day, 1 hour and 1 minute', async ({ page }) => {
  await open(page, '2026-12-23T22:58:30'); // 1 d 1 h 1 min 30 s left
  await expect(page.locator(TEXT)).toHaveText('1 day, 1 hour and 1 minute until Christmas');
});

test('the text is visually hidden but real: rendered, in the accessibility tree, not display:none', async ({ page }) => {
  await openFrozen(page, '2026-10-07T19:47:30'); // frozen, so the colons hold still between screenshots
  const line ='78 days, 4 hours and 12 minutes until Christmas';
  await expect(page.locator(TEXT)).toHaveText(line);
  const look = await page.locator(TEXT).evaluate((el) => {
    const hiddenUp: string[] = [];
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none') hiddenUp.push(`${n.tagName} display:none`);
      if (n.getAttribute('aria-hidden') === 'true') hiddenUp.push(`${n.tagName} aria-hidden`);
      if ((n as HTMLElement).hidden) hiddenUp.push(`${n.tagName} hidden`);
    }
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { hiddenUp, visibility: s.visibility, area: r.width * r.height, tabIndex: (el as HTMLElement).tabIndex };
  });
  expect(look.hiddenUp).toEqual([]);
  expect(look.visibility).toBe('visible');
  expect(look.area, 'takes no visible space').toBeLessThanOrEqual(1);
  expect(look.tabIndex, 'takes no keyboard focus').toBeLessThan(0);
  expect(await page.locator('body').ariaSnapshot()).toContain(line);
  // It does not show: a screenshot of the page matches one with the text removed.
  const withText = await page.screenshot();
  await page.locator(TEXT).evaluate((el) => {
    el.textContent = '';
  });
  expect((await page.screenshot()).equals(withText)).toBe(true);
});

test('the hidden text is no live region and sits in none, so updates are not announced', async ({ page }) => {
  await open(page, '2026-12-01T22:00:00');
  await expect(page.locator(TEXT)).not.toHaveText('');
  const live = await page.locator(TEXT).evaluate((el) => {
    const found: string[] = [];
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const role = n.getAttribute('role') ?? '';
      if (n.hasAttribute('aria-live')) found.push(`${n.tagName} aria-live=${n.getAttribute('aria-live')}`);
      if (/\b(status|alert|log|marquee|timer)\b/.test(role)) found.push(`${n.tagName} role=${role}`);
      if (n.tagName === 'OUTPUT') found.push('OUTPUT');
      if (n.hasAttribute('aria-atomic') || n.hasAttribute('aria-relevant')) found.push(`${n.tagName} live attrs`);
    }
    return found;
  });
  expect(live).toEqual([]);
});

test('the live region exists from load, is polite and empty, and is a different element', async ({ page }) => {
  await open(page, '2026-12-01T22:00:00');
  const region = page.locator(LIVE);
  await expect(region).toHaveCount(1);
  expect(await region.getAttribute('aria-live')).toBe('polite');
  expect(await region.getAttribute('role')).not.toBe('alert');
  expect(await text(page, LIVE)).toBe('');
  const same = await page.evaluate(
    ({ a, b }) => {
      const x = document.querySelector(a);
      const y = document.querySelector(b);
      return x !== null && y !== null && (x === y || x.contains(y) || y.contains(x));
    },
    { a: TEXT, b: LIVE },
  );
  expect(same, 'the live region neither is nor holds the countdown text').toBe(false);
});

test('the live region is in the page before any script runs (so a later write is announced)', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/?now=2026-12-01T22:00:00');
  const region = page.locator(LIVE);
  await expect(region).toHaveCount(1);
  expect(await region.getAttribute('aria-live')).toBe('polite');
  expect(await text(page, LIVE)).toBe('');
  await context.close();
});

test('updated once a minute: unchanged within the minute, new text when the minute turns', async ({ page }) => {
  await openFrozen(page, '2026-12-01T12:00:30'); // 23 d 11 h 59 min 30 s left
  await expect(page.locator(TEXT)).toHaveText('23 days, 11 hours and 59 minutes until Christmas');
  await watchWrites(page, TEXT, '__textWrites');
  await page.clock.runFor(29_000); // 12:00:59, the same minute, 29 ticks
  expect(await writes(page, '__textWrites'), 'no rewrite while the minute stays the same').toBe(0);
  await expect(page.locator(TEXT)).toHaveText('23 days, 11 hours and 59 minutes until Christmas');
  await page.clock.runFor(1_000); // 12:01:00: exactly 23 d 11 h 59 min left, still 59
  await expect(page.locator(TEXT)).toHaveText('23 days, 11 hours and 59 minutes until Christmas');
  expect(await writes(page, '__textWrites'), 'no rewrite on an exact whole minute').toBe(0);
  await page.clock.runFor(1_000); // 12:01:01: 23 d 11 h 58 min 59 s left
  await expect(page.locator(TEXT)).toHaveText('23 days, 11 hours and 58 minutes until Christmas');
});

test('the text catches up at once when the tab comes back after a long sleep', async ({ page }) => {
  await openFrozen(page, '2026-12-01T12:00:30');
  await expect(page.locator(TEXT)).toHaveText('23 days, 11 hours and 59 minutes until Christmas');
  await page.clock.setSystemTime(new Date('2026-12-01T15:10:30Z')); // no timer fires
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator(TEXT)).toHaveText('23 days, 8 hours and 49 minutes until Christmas');
});

test('at zero: the text turns to the greeting and the live region announces it exactly once', async ({ page }) => {
  await openFrozen(page, '2026-12-24T23:59:58');
  await expect(page.locator(TEXT)).toHaveText('Less than a minute until Christmas');
  expect(await text(page, LIVE)).toBe('');
  await watchWrites(page, LIVE, '__liveWrites');
  await watchWrites(page, TEXT, '__textWrites');

  await page.clock.runFor(2_500); // past 00:00:00 on 25 December
  await expect(page.locator(TEXT)).toHaveText('Merry Christmas!');
  await expect(page.locator(LIVE)).toHaveText('Merry Christmas!');
  expect(await writes(page, '__liveWrites')).toBe(1);

  // Redraw triggers and more ticks must not write the region again.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('resize'));
  });
  await page.clock.runFor(65_000);
  expect(await writes(page, '__liveWrites'), 'one write in all').toBe(1);
  expect(await text(page, LIVE)).toBe('Merry Christmas!');
});

test('a second crossing of zero (device clock set back, then on) is not announced again', async ({ page }) => {
  await openFrozen(page, '2026-12-24T23:59:58');
  await watchWrites(page, LIVE, '__liveWrites');
  await page.clock.runFor(2_500);
  await expect(page.locator(LIVE)).toHaveText('Merry Christmas!');
  await page.clock.setSystemTime(new Date('2026-12-24T23:59:57Z')); // the device clock goes back
  await page.clock.runFor(1_000);
  await expect(page.locator(TEXT)).toHaveText('Less than a minute until Christmas');
  await page.clock.runFor(3_000); // and crosses zero a second time
  await expect(page.locator(TEXT)).toHaveText('Merry Christmas!');
  expect(await writes(page, '__liveWrites'), 'Merry Christmas! is announced once per page').toBe(1);
});

test('on 25 December the text reads "Merry Christmas!" and nothing is announced on load', async ({ page }) => {
  await openFrozen(page, '2026-12-25T12:00:00');
  await expect(page.locator(TEXT)).toHaveText('Merry Christmas!');
  await watchWrites(page, LIVE, '__liveWrites');
  await page.clock.runFor(120_000);
  expect(await writes(page, '__liveWrites')).toBe(0);
  expect(await text(page, LIVE)).toBe('');
  await expect(page.locator(TEXT)).toHaveText('Merry Christmas!');
});

test('from midnight starting 26 December the text is the countdown again, with nothing announced', async ({ page }) => {
  await openFrozen(page, '2026-12-25T23:59:58');
  await expect(page.locator(TEXT)).toHaveText('Merry Christmas!');
  await watchWrites(page, LIVE, '__liveWrites');
  await page.clock.runFor(32_000); // 00:00:30 on 26 December
  await expect(page.locator(TEXT)).toHaveText('363 days, 23 hours and 59 minutes until Christmas');
  expect(await writes(page, '__liveWrites')).toBe(0);
  expect(await text(page, LIVE)).toBe('');
});

test('the text comes from the countdown script alone: it is there with every other request blocked', async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.pathname === '/' ? route.continue() : route.abort();
  });
  await open(page, '2026-10-07T19:47:30');
  await expect(page.locator(TEXT)).toHaveText('78 days, 4 hours and 12 minutes until Christmas');
});

test('keyboard focus skips the canvas and both hidden texts', async ({ page }) => {
  await open(page, '2026-12-01T22:00:00');
  expect(await page.locator('canvas#countdown').getAttribute('aria-hidden')).toBe('true');
  for (const selector of ['canvas#countdown', TEXT, LIVE]) {
    await expect(page.locator(selector), selector).toHaveCount(1);
    expect(await page.locator(selector).getAttribute('tabindex'), selector).toBeNull();
  }
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});
