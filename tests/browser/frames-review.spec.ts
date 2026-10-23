// XMAS-31c "Frames review page": the one smoke test of `pnpm frames`, the
// owner-only review tool the owner views remotely (XMAS-122 cut it to one, as
// dev-only tools get one smoke test). The test starts tools/frames-serve.ts on
// loopback with its own temp folder of tiny PNGs (not the vite preview the
// other specs use).
//
// The page parts this spec uses:
//   img#frame          the one picture shown
//   #frame-count       "n of N"
//   button "Next"
//   radios "Approved" and "Denied", a textbox "Comment"      one set per frame, kept while the page is open
//   a read-only textbox "Result" and a button "Copy result"   the live result string
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { encodePng } from '../../tools/png.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A tiny two-colour checkerboard: each frame has its own size and colours. */
interface Tiny { file: string; width: number; height: number; colours: [number[], number[]] }
const DAWN: Tiny = { file: 'dawn.png', width: 13, height: 26, colours: [[200, 40, 40], [250, 220, 90]] };
const FROSTY: Tiny = { file: 'frosty-morning.png', width: 20, height: 10, colours: [[20, 60, 200], [230, 240, 255]] };
const SUNSET: Tiny = { file: 'sunset.png', width: 7, height: 9, colours: [[240, 120, 20], [90, 20, 120]] };

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
const count = (page: Page) => page.locator('#frame-count');
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
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
});
