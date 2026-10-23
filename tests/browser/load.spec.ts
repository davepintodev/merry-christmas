// XMAS-22: the built page loads in a real browser with no error of any kind.
// playwright.config.ts serves dist/ with `vite preview` (webServer) and sets baseURL.
import { expect, test, type Page } from '@playwright/test';

type Problems = { console: string[]; page: string[]; requests: string[] };

function watch(page: Page): Problems {
  const problems: Problems = { console: [], page: [], requests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.console.push(msg.text());
  });
  page.on('pageerror', (err) => problems.page.push(err.message));
  page.on('requestfailed', (req) => problems.requests.push(`${req.url()} ${req.failure()?.errorText ?? ''}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.requests.push(`${res.url()} HTTP ${res.status()}`);
  });
  return problems;
}

test('the built page loads with no console error, page error or failed request', async ({ page }) => {
  const problems = watch(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual({ console: [], page: [], requests: [] });
});

test('the page is the production build, not the dev server', async ({ page }) => {
  await page.goto('/');
  const scripts = await page.locator('script[src]').evaluateAll((els) => els.map((e) => e.getAttribute('src') ?? ''));
  expect(scripts.filter((s) => s.includes('@vite/client') || s.includes('/src/'))).toEqual([]);
  await expect(page.locator('body')).toBeAttached();
});

test('the page has a title and a language', async ({ page }) => {
  await page.goto('/');
  expect((await page.title()).trim()).not.toBe('');
  expect(await page.locator('html').getAttribute('lang')).toBeTruthy();
});

test('the page loads no web font', async ({ page }) => {
  const fonts: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'font' || /fonts\.(googleapis|gstatic)\.com/.test(req.url())) fonts.push(req.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(fonts).toEqual([]);
  expect(await page.evaluate(() => document.fonts.size)).toBe(0);
});
