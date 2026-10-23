// XMAS-46c "Sound button and page wiring", in the built page: the sound button sits in the bottom-left corner and
// every visit starts muted. Before the first press the page asks for no sound and makes no AudioContext; the first
// press makes one and the name says on; a second press mutes; a reload starts muted again. With no AudioContext at
// all, a press leaves the button off and throws nothing.
// The clock is the real one here: nothing in these checks waits on a frame, and a reload needs the page to run on.
// AudioContext is wrapped by an init script that counts its constructions; every page load starts the count at zero.
import { expect, test, type Page, type Request } from '@playwright/test';

const NOW = '2026-12-01T22:00:00';
const VIEWPORT = { width: 360, height: 700 };
const ON = 'Sound is on. Turn sound off';
const OFF = 'Sound is off. Turn sound on';

/** Files that are sound by their name: the page ships none, so any such request is a fault. */
const AUDIO_FILE = /\/audio\/|\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)(\?|$)/i;

/** Counts the AudioContexts the page makes, through the real constructor, so the sound still works. */
async function countAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    const counts = window as unknown as { audioContexts: number };
    counts.audioContexts = 0;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        counts.audioContexts++;
      }
    };
  });
}

/** Hides AudioContext from the page, as a browser without Web Audio would. */
async function hideAudioContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'AudioContext');
  });
}

/** The AudioContexts the page has made since it loaded. */
async function audioContexts(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { audioContexts: number }).audioContexts);
}

/** Opens the page and waits until the scene has drawn, which is when the sound button shows. */
async function open(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/?now=${NOW}`);
  await expect(page.locator('button#sound')).toBeVisible();
}

const soundButton = (page: Page) => page.locator('button#sound');
const soundNamed = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** A hash of the sound button's drawing: equal pictures give equal strings. */
async function picture(page: Page): Promise<string> {
  return page.locator('button#sound canvas').evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i]!, 16777619);
    return `${c.width}x${c.height}:${hash >>> 0}`;
  });
}

/** A mouse press in the middle of the sound button's tap area, as a visitor's tap is. */
async function pressSound(page: Page): Promise<void> {
  const box = await soundButton(page).boundingBox();
  expect(box, 'the sound button has a box').not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test('before the first press the page asks for no sound, and makes no AudioContext', async ({ page }) => {
  await countAudioContexts(page);
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  await open(page);
  const origin = new URL(page.url()).origin;
  // Anything off the page's own origin, or any audio file, counts as sound.
  const sound = requests.filter((request) => !request.url().startsWith(`${origin}/`) || AUDIO_FILE.test(request.url()));
  expect(sound.map((request) => request.url())).toEqual([]);
  const bytes = await Promise.all(sound.map(async (request) => (await request.sizes()).responseBodySize));
  expect(bytes.reduce((sum, n) => sum + n, 0)).toBe(0);
  expect(await audioContexts(page)).toBe(0);
  await expect(soundNamed(page, OFF)).toBeVisible();
});

test('a press makes one AudioContext and says on; a second press mutes', async ({ page }) => {
  await countAudioContexts(page);
  await open(page);
  const muted = await picture(page);
  await pressSound(page);
  await expect(soundNamed(page, ON)).toBeVisible();
  expect(await audioContexts(page)).toBe(1);
  expect(await picture(page)).not.toBe(muted);
  await pressSound(page);
  await expect(soundNamed(page, OFF)).toBeVisible();
  expect(await picture(page)).toBe(muted);
  expect(await audioContexts(page)).toBe(1);
});

test('a reload starts muted, and nothing is remembered', async ({ page }) => {
  await countAudioContexts(page);
  await open(page);
  await pressSound(page);
  await expect(soundNamed(page, ON)).toBeVisible();
  await page.reload();
  await expect(soundNamed(page, OFF)).toBeVisible();
  expect(await audioContexts(page)).toBe(0);
});

test('with no AudioContext a press leaves the button off, and throws nothing', async ({ page }) => {
  await hideAudioContext(page);
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await open(page);
  await pressSound(page);
  await expect(soundNamed(page, OFF)).toBeVisible();
  expect(errors).toEqual([]);
});
