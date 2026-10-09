// XMAS-27 "Countdown on a plain sky", part B: the page script. Draws the
// countdown frame on <canvas id="countdown"> in the phase's sky and ink, at a
// whole number of physical pixels per art pixel, on the second and again as
// soon as the tab comes back; at zero it switches live to the greeting.
// XMAS-29 "Screen reader text and the announcement at zero": the same reading
// fills the hidden countdown text, rewritten only when it changes (once a
// minute), and announces the greeting once in the live region the page sees
// zero pass.
// XMAS-31b "Scene core": the art pixel size is the page's one size, shared
// with the scene (src/page/pixel.ts), and once the countdown first shows the
// page asks for the scene's own file; a failure leaves this plain sky.
import { makeClock, phaseAt, timeLeft, type TimeLeft } from '../shared/clock.ts';
import { pagePixels } from '../page/pixel.ts';
import { announcement, spokenTime } from './announce.ts';
import { skyAndInk } from './colours.ts';
import { countdownFrame } from './render.ts';

// The scene file's URL. tools/countdown-plugin.ts fills this in: the build
// names the emitted /assets/scene-<hash>.js, the dev server the source file.
const SCENE_URL = '%SCENE_URL%';

const clock = makeClock(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('canvas#countdown');
const context = canvas === null ? null : canvas.getContext('2d');
const text = document.querySelector<HTMLElement>('#countdown-text');
const live = document.querySelector<HTMLElement>('#countdown-announce');
let marked = false;
let previous: TimeLeft | null = null; // the last reading, for the announcement
let announced = false; // the live region is written at most once per page
let sceneAsked = false; // the scene file is imported at most once per page

/** Imports the scene file once; any failure leaves the countdown on its plain sky, silently. */
function askForScene(): void {
  if (sceneAsked) return;
  sceneAsked = true;
  void import(/* @vite-ignore */ SCENE_URL).catch(() => {
    // The scene is decoration: a missing or broken file changes nothing on screen.
  });
}

/** Draws the frame for one reading, filling sky first and ink over it. */
function draw(now: Date, left: TimeLeft): void {
  if (canvas === null || context === null) return;
  const frame = countdownFrame(left, now.getSeconds() % 2 === 0);
  const dpr = window.devicePixelRatio || 1;
  const { scale } = pagePixels({ width: window.innerWidth, height: window.innerHeight }, dpr);
  // Assigning width/height reallocates the backing store, so only do it when
  // the whole-pixel size actually changes.
  const physicalWidth = frame.width * scale;
  const physicalHeight = frame.height * scale;
  if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
  if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
  canvas.style.width = `${physicalWidth / dpr}px`;
  canvas.style.height = `${physicalHeight / dpr}px`;
  context.imageSmoothingEnabled = false;
  const { sky, ink } = skyAndInk(phaseAt(now));
  document.body.style.backgroundColor = sky;
  context.fillStyle = sky;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = ink;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.pixels[y * frame.width + x] === 1) context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  if (!marked) {
    marked = true;
    canvas.hidden = false; // the canvas joins the layout only once it has drawn
    performance.mark('countdown-visible');
    askForScene();
  }
}

/** Keeps the hidden text and the live region in step; the text changes once a minute. */
function speak(left: TimeLeft): void {
  const line = spokenTime(left);
  if (text !== null && text.textContent !== line) text.textContent = line;
  if (live !== null && !announced) {
    const greeting = announcement(previous, left);
    if (greeting !== null) {
      live.textContent = greeting;
      announced = true;
    }
  }
  previous = left;
}

/** One clock reading drives the frame and the text, so a catch-up does both. */
function update(): void {
  const now = new Date(Math.floor(clock().getTime() / 1000) * 1000); // the whole second it lands in
  const left = timeLeft(now);
  draw(now, left);
  speak(left);
}

/** Draws, then waits to the clock's next whole second, reading it fresh. */
function tick(): void {
  update();
  window.setTimeout(tick, 1000 - clock().getMilliseconds());
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) update();
});
window.addEventListener('pageshow', update);
window.addEventListener('resize', update);

/** Redraws at once when the pixel ratio changes (e.g. a move to another display). */
function watchDpr(): void {
  if (typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  media.addEventListener(
    'change',
    () => {
      update(); // the whole-pixel scale depends on the ratio
      watchDpr(); // the old query no longer matches: listen for the next ratio
    },
    { once: true },
  );
}

watchDpr();
tick();
