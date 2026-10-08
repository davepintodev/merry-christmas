// XMAS-26 "Art build step and the rough Font sheet": sheets are drawn source
// only. The built page requests no PNG and receives no PNG.
import { expect, test } from '@playwright/test';

test('the built page requests no PNG and receives no image/png response', async ({ page }) => {
  const pngRequests: string[] = [];
  const pngResponses: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/\.png$/i.test(url.pathname)) pngRequests.push(req.url());
  });
  page.on('response', async (res) => {
    const type = (await res.headerValue('content-type')) ?? '';
    if (/image\/png/i.test(type)) pngResponses.push(res.url());
  });
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
  expect(pngRequests).toEqual([]);
  expect(pngResponses).toEqual([]);
});

test('the page has no img, icon or CSS background pointing at a PNG', async ({ page }) => {
  await page.goto('/');
  const refs = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[src], [href], [srcset]'))) {
      for (const attr of ['src', 'href', 'srcset']) {
        const v = el.getAttribute(attr);
        if (v && /\.png\b/i.test(v)) out.push(`${el.tagName.toLowerCase()} ${attr}=${v}`);
      }
    }
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const bg = getComputedStyle(el).backgroundImage;
      if (/\.png\b/i.test(bg)) out.push(`${el.tagName.toLowerCase()} background ${bg}`);
    }
    return out;
  });
  expect(refs).toEqual([]);
});
