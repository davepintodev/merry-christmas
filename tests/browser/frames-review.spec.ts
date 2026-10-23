// XMAS-31c "Frames review page": `pnpm frames` as a review tool for the
// owner, who views it remotely. Each test starts tools/frames-serve.ts on
// loopback with its own temp folder of tiny PNGs (not the vite preview the
// other specs use).
//
// The page this spec assumes:
//   img#frame          the one picture shown, hard-edged, whole-number scale, centred
//   #frame-name        the frame's display name (tools/frames-review.ts displayName)
//   #frame-count       "n of N"
//   buttons "Previous" and "Next" (also the left and right arrow keys); they wrap at the ends
//   radios "Approved" and "Denied", a textbox "Comment"      one set per frame, kept while the page is open
//   a read-only textbox "Result" and a button "Copy result"   the live result string
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { frameScale } from '../../tools/frames-review.ts';
import { decodePng, encodePng } from '../../tools/png.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A tiny two-colour checkerboard: each frame has its own size and colours. */
interface Tiny { file: string; width: number; height: number; colours: [number[], number[]] }
const DAWN: Tiny = { file: 'dawn.png', width: 13, height: 26, colours: [[200, 40, 40], [250, 220, 90]] };
const FROSTY: Tiny = { file: 'frosty-morning.png', width: 20, height: 10, colours: [[20, 60, 200], [230, 240, 255]] };
const SUNSET: Tiny = { file: 'sunset.png', width: 7, height: 9, colours: [[240, 120, 20], [90, 20, 120]] };
// Not one of tools/frames.ts's referenceFrames: a picture no code knows about.
const SNOWY: Tiny = { file: 'snowy-forest.png', width: 11, height: 11, colours: [[60, 10, 90], [255, 255, 255]] };

function png(t: Tiny): Uint8Array {
  const rgba = new Uint8Array(t.width * t.height * 4);
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const [r, g, b] = t.colours[(x + y) % 2] as number[];
      rgba.set([r ?? 0, g ?? 0, b ?? 0, 255], (y * t.width + x) * 4);
    }
  }
  return encodePng(t.width, t.height, rgba);
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) out[f] = readFileSync(path.join(dir, f)).toString('base64');
  return out;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      s.close(() => resolve(port));
    });
  });
}

let dir = '';
let base = '';
let server: ChildProcess | null = null;

test.beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'xmas-review-'));
  for (const t of [SUNSET, DAWN, FROSTY]) writeFileSync(path.join(dir, t.file), png(t));
  writeFileSync(path.join(dir, 'notes.txt'), 'not a picture');
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(ROOT, 'tools', 'frames-serve.ts'), dir], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  });
  const until = Date.now() + 20_000;
  for (;;) {
    try {
      await fetch(`${base}/`);
      break;
    } catch (error) {
      if (Date.now() > until || server.exitCode !== null) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

test.afterEach(() => {
  server?.kill();
  server = null;
  rmSync(dir, { recursive: true, force: true });
});

const frame = (page: Page) => page.locator('img#frame');
const name = (page: Page) => page.locator('#frame-name');
const count = (page: Page) => page.locator('#frame-count');
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const previous = (page: Page) => page.getByRole('button', { name: 'Previous', exact: true });
const approved = (page: Page) => page.getByRole('radio', { name: 'Approved' });
const denied = (page: Page) => page.getByRole('radio', { name: 'Denied' });
const comment = (page: Page) => page.getByRole('textbox', { name: 'Comment' });
const result = (page: Page) => page.getByRole('textbox', { name: 'Result' });
const copy = (page: Page) => page.getByRole('button', { name: 'Copy result' });

async function open(page: Page): Promise<void> {
  await page.goto(`${base}/`);
  await expect(count(page)).toHaveText(/\d+ of \d+/);
  await expect.poll(() => frame(page).evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

/** Expects the shown frame to be t, by name, counter and the picture's own size. */
async function showing(page: Page, t: Tiny, label: string, n: string): Promise<void> {
  await expect(name(page)).toHaveText(label);
  await expect(count(page)).toHaveText(n);
  await expect(frame(page)).toHaveAttribute('src', new RegExp(`${t.file.replace('.', '\\.')}$`));
  await expect
    .poll(() => frame(page).evaluate((img) => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight]))
    .toEqual([t.width, t.height]);
}

/** The shown picture's physical pixels per art pixel across and down, and its box. */
async function measure(page: Page) {
  return frame(page).evaluate((img) => {
    const i = img as HTMLImageElement;
    const r = i.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const stage = document.querySelector('#stage') as HTMLElement;
    const s = stage.getBoundingClientRect();
    return {
      natural: { width: i.naturalWidth, height: i.naturalHeight },
      stage: { x: s.x, y: s.y, width: s.width, height: s.height, clientWidth: stage.clientWidth, clientHeight: stage.clientHeight },
      across: (r.width * dpr) / i.naturalWidth,
      down: (r.height * dpr) / i.naturalHeight,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      window: { width: window.innerWidth, height: window.innerHeight },
      dpr,
      rendering: getComputedStyle(i).imageRendering,
    };
  });
}

/** Which of the previous picture's (Dawn's) own colours the screen shows inside a box; [] when none. */
async function coloursIn(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<string[]> {
  const clip = { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 };
  const shot = decodePng(new Uint8Array(await page.screenshot({ clip, scale: 'device' })));
  const wanted = new Set(DAWN.colours.map((c) => c.join()));
  const seen = new Set<string>();
  for (let i = 0; i < shot.width * shot.height; i++) {
    const c = Array.from(shot.rgba.subarray(i * 4, i * 4 + 3)).join();
    if (wanted.has(c)) seen.add(c);
  }
  return [...seen].sort();
}

test.describe('frames review page: discovery', () => {
  test('lists the folder\'s PNGs sorted by file name, one at a time, skipping other files', async ({ page }) => {
    await open(page);
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await expect(page.locator('img')).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText('notes');
  });

  test('serves a PNG added later byte for byte, and nothing outside the folder\'s PNGs', async ({ request }) => {
    writeFileSync(path.join(dir, SNOWY.file), png(SNOWY));
    const added = await request.get(`${base}/${SNOWY.file}`);
    expect(added.status()).toBe(200);
    expect(added.headers()['content-type'] ?? '').toMatch(/image\/png/);
    expect(Buffer.from(await added.body()).equals(Buffer.from(png(SNOWY)))).toBe(true);
    expect((await request.get(`${base}/notes.txt`)).status()).toBe(404);
    expect((await request.get(`${base}/..%2Fpackage.json`)).status()).toBe(404);
    expect((await request.get(`${base}/%2E%2E/package.json`)).status()).toBe(404);
    expect((await request.get(`${base}/gone.png`)).status()).toBe(404);
  });
});

test.describe('frames review page: navigation', () => {
  test('Next and Previous step through the frames and wrap at both ends', async ({ page }) => {
    await open(page);
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await next(page).click();
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
    await next(page).click();
    await showing(page, SUNSET, 'Sunset', '3 of 3');
    await next(page).click();
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await previous(page).click();
    await showing(page, SUNSET, 'Sunset', '3 of 3');
    await previous(page).click();
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
  });

  test('the right and left arrow keys do the same', async ({ page }) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await showing(page, SUNSET, 'Sunset', '3 of 3');
  });

  test('arrow keys move the caret, not the frame, while typing a comment', async ({ page }) => {
    await open(page);
    await denied(page).check();
    await comment(page).click();
    await page.keyboard.type('too dark');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await expect(comment(page)).toHaveValue('too dark');
  });
});

test.describe('frames review page: scaling', () => {
  for (const [label, t, n] of [['Dawn', DAWN, 0], ['Frosty morning', FROSTY, 1], ['Sunset', SUNSET, 2]] as const) {
    test(`shows ${label} hard-edged at one whole-number scale that fits, centred`, async ({ page }) => {
      await open(page);
      for (let i = 0; i < n; i++) await next(page).click();
      await showing(page, t, label, `${n + 1} of 3`);
      const m = await measure(page);
      expect(m.rendering).toBe('pixelated');
      expect(Number.isInteger(m.across), `across ${m.across}`).toBe(true);
      expect(m.across).toBeGreaterThanOrEqual(1);
      expect(m.down).toBe(m.across);
      expect(m.rect.x).toBeGreaterThanOrEqual(0);
      expect(m.rect.y).toBeGreaterThanOrEqual(0);
      expect(m.rect.x + m.rect.width).toBeLessThanOrEqual(m.window.width + 0.5);
      expect(m.rect.y + m.rect.height).toBeLessThanOrEqual(m.window.height + 0.5);
      expect(Math.abs(m.rect.x + m.rect.width / 2 - m.window.width / 2)).toBeLessThanOrEqual(1);
      // Not the old fixed 2x: a tiny frame in a 1280 x 720 window is enlarged far more.
      expect(m.across).toBeGreaterThan(2);
      expect(m.across).toBeLessThanOrEqual(frameScale(t, m.window, m.dpr).scale);
    });
  }

});

test.describe('frames review page: judging', () => {

  test('approve, deny and comment build the exact result string live, and never write to the folder', async ({ page }) => {
    const before = snapshot(dir);
    await open(page);
    await approved(page).check();
    await expect(result(page)).toHaveValue('Dawn:Yes, Frosty morning:Undecided, Sunset:Undecided');
    await next(page).click();
    await denied(page).check();
    await expect(result(page)).toHaveValue('Dawn:Yes, Frosty morning:Denied, Sunset:Undecided');
    await comment(page).fill('  sky too dark\nand cold ');
    await expect(result(page)).toHaveValue('Dawn:Yes, Frosty morning:Denied with comments: sky too dark and cold, Sunset:Undecided');
    await next(page).click();
    await expect(comment(page)).toHaveValue('');
    await denied(page).check();
    await expect(result(page)).toHaveValue('Dawn:Yes, Frosty morning:Denied with comments: sky too dark and cold, Sunset:Denied');
    await copy(page).click();
    expect(snapshot(dir)).toEqual(before);
  });

  test('keeps each frame\'s verdict and comment while moving between frames', async ({ page }) => {
    await open(page);
    await approved(page).check();
    await comment(page).fill('lovely');
    await next(page).click();
    await denied(page).check();
    await comment(page).fill('too blue');
    await next(page).click();
    await expect(approved(page)).not.toBeChecked();
    await expect(denied(page)).not.toBeChecked();
    await expect(comment(page)).toHaveValue('');
    await next(page).click();
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await expect(approved(page)).toBeChecked();
    await expect(comment(page)).toHaveValue('lovely');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
    await expect(denied(page)).toBeChecked();
    await expect(comment(page)).toHaveValue('too blue');
  });

});

test.describe('frames review page: copy', () => {
  test('Copy result puts the exact result string on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await open(page);
    await denied(page).check();
    await comment(page).fill('sky too dark');
    await copy(page).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Dawn:Denied with comments: sky too dark, Frosty morning:Undecided, Sunset:Undecided');
  });

  async function expectSelected(page: Page): Promise<void> {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
          if (el === null || !('value' in el)) return 'nothing focused';
          return `${el.selectionStart}-${el.selectionEnd}/${el.value.length}:${el.value}`;
        }),
      )
      .toBe(`0-${'Dawn:Yes, Frosty morning:Undecided, Sunset:Undecided'.length}/${'Dawn:Yes, Frosty morning:Undecided, Sunset:Undecided'.length}:Dawn:Yes, Frosty morning:Undecided, Sunset:Undecided`);
  }

  test('without navigator.clipboard, Copy result selects the whole result text instead', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => undefined });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await approved(page).check();
    await copy(page).click();
    await expectSelected(page);
    expect(errors).toEqual([]);
  });

});

// XMAS-31c review round 1: the page is checked against #stage, the area the
// picture is fitted into, not the whole window.
test.describe('frames review page: review round 1', () => {

  test('never shows the next picture in the previous picture\'s box while it loads', async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(`**/${FROSTY.file}`, async (route) => {
      await held;
      await route.continue();
    });
    await open(page);
    await showing(page, DAWN, 'Dawn', '1 of 3');
    const old = (await measure(page)).rect;
    expect(await coloursIn(page, old), 'sanity: Dawn is on screen before Next').toEqual(DAWN.colours.map((c) => c.join()).sort());
    await next(page).click();
    await expect(count(page)).toHaveText('2 of 3');
    await expect(frame(page)).toHaveAttribute('src', /frosty-morning\.png$/);
    await page.waitForTimeout(200);
    expect(await coloursIn(page, old), 'the previous picture is still painted while the next one loads').toEqual([]);
    release();
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
    await expect.poll(async () => (await measure(page)).down).toBe((await measure(page)).across);
    const m = await measure(page);
    expect(Number.isInteger(m.across)).toBe(true);
    expect(m.across).toBe(frameScale(FROSTY, { width: m.stage.clientWidth, height: m.stage.clientHeight }, m.dpr).scale);
  });

  test('a picture deleted after the page loaded does not keep the previous picture\'s box, and the next one still fits', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await showing(page, DAWN, 'Dawn', '1 of 3');
    const old = (await measure(page)).rect;
    expect(await coloursIn(page, old), 'sanity: Dawn is on screen before Next').toEqual(DAWN.colours.map((c) => c.join()).sort());
    rmSync(path.join(dir, FROSTY.file));
    const failed = page.waitForResponse((r) => r.url().endsWith(FROSTY.file));
    await next(page).click();
    expect((await failed).status()).toBe(404);
    await expect(count(page)).toHaveText('2 of 3');
    await page.waitForTimeout(200);
    expect(await coloursIn(page, old), 'the previous picture is still painted for a missing picture').toEqual([]);
    await next(page).click();
    await showing(page, SUNSET, 'Sunset', '3 of 3');
    const m = await measure(page);
    expect(m.across).toBe(frameScale(SUNSET, { width: m.stage.clientWidth, height: m.stage.clientHeight }, m.dpr).scale);
    expect(errors).toEqual([]);
  });

  test('shows and serves pictures whose names hold #, % and ?', async ({ page, request }) => {
    const odd: Tiny[] = [
      { file: 'a#b.png', width: 5, height: 3, colours: [[1, 2, 3], [4, 5, 6]] },
      { file: 'a%b.png', width: 3, height: 5, colours: [[7, 8, 9], [10, 11, 12]] },
      { file: 'a?b.png', width: 4, height: 4, colours: [[13, 14, 15], [16, 17, 18]] },
    ];
    for (const t of odd) writeFileSync(path.join(dir, t.file), png(t));
    for (const t of odd) {
      const got = await request.get(`${base}/${encodeURIComponent(t.file)}`);
      expect(got.status(), t.file).toBe(200);
      expect(Buffer.from(await got.body()).equals(Buffer.from(png(t))), t.file).toBe(true);
    }
    await page.goto(`${base}/`);
    await expect(count(page)).toHaveText('1 of 6');
    await expect(result(page)).toHaveValue(
      'A#b:Undecided, A%b:Undecided, A?b:Undecided, Dawn:Undecided, Frosty morning:Undecided, Sunset:Undecided',
    );
    for (const [i, t] of odd.entries()) {
      await expect(name(page)).toHaveText(t.file.replace('.png', '').replace(/^a/, 'A'));
      await expect(count(page)).toHaveText(`${i + 1} of 6`);
      await expect
        .poll(() => frame(page).evaluate((img) => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight]), t.file)
        .toEqual([t.width, t.height]);
      await next(page).click();
    }
  });

  test('arrow keys do not change the frame while focus is in the Result box', async ({ page }) => {
    await open(page);
    await result(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await showing(page, DAWN, 'Dawn', '1 of 3');
  });

  test('leaves Alt+Arrow to the browser: no frame change, default not prevented', async ({ page }) => {
    await open(page);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Alt+ArrowRight');
    await showing(page, DAWN, 'Dawn', '1 of 3');
    for (const key of ['ArrowRight', 'ArrowLeft']) {
      const notPrevented = await page.evaluate(
        (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true })),
        key,
      );
      expect(notPrevented, `Alt+${key}`).toBe(true);
      await showing(page, DAWN, 'Dawn', '1 of 3');
    }
  });
});

// XMAS-31c review round 2.
test.describe('frames review page: review round 2', () => {

  test('with a radio focused the arrow keys switch Approved and Denied, not the frame; elsewhere they still move', async ({ page }) => {
    await open(page);
    await approved(page).check();
    await expect(approved(page)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(denied(page)).toBeChecked();
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await expect(result(page)).toHaveValue('Dawn:Denied, Frosty morning:Undecided, Sunset:Undecided');
    await page.keyboard.press('ArrowLeft');
    await expect(approved(page)).toBeChecked();
    await showing(page, DAWN, 'Dawn', '1 of 3');
    await expect(result(page)).toHaveValue('Dawn:Yes, Frosty morning:Undecided, Sunset:Undecided');
    await next(page).click();
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
    await page.locator('#frame-name').click();
    await page.keyboard.press('ArrowRight');
    await showing(page, SUNSET, 'Sunset', '3 of 3');
    await page.keyboard.press('ArrowLeft');
    await showing(page, FROSTY, 'Frosty morning', '2 of 3');
    await expect(result(page)).toHaveValue('Dawn:Yes, Frosty morning:Undecided, Sunset:Undecided');
  });
});
