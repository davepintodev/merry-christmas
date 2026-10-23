// XMAS-42b: the preview image is for link unfurlers. The site itself never
// requests it and receives no image/png, though its meta tags name the file.
// (no-png.spec.ts checks src/href/srcset only, so meta content is fine there.)
import { expect, test } from '@playwright/test';

test('the page names a preview file in its meta tags but never requests it', async ({ page }) => {
  const requests: string[] = [];
  const pngResponses: string[] = [];
  page.on('request', (req) => requests.push(new URL(req.url()).pathname));
  page.on('response', async (res) => {
    if (/image\/png/i.test((await res.headerValue('content-type')) ?? '')) pngResponses.push(res.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const named = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(named).toMatch(/^(https:\/\/[^/]+)?\/preview-[0-9a-f]{8}\.png$/);
  expect(requests.filter((p) => p.startsWith('/preview') || /\.png$/i.test(p))).toEqual([]);
  expect(pngResponses).toEqual([]);
});
