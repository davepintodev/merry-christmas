// XMAS-27 "Countdown on a plain sky", part B: the page script. Draws the
// countdown frame on <canvas id="countdown"> in the phase's sky and ink, at a
// whole number of physical pixels per art pixel, on the second and again as
// soon as the tab comes back; at zero it switches live to the greeting.
import { makeClock, phaseAt, timeLeft } from '../shared/clock.ts';
import { skyAndInk } from './colours.ts';
import { countdownFrame } from './render.ts';
import { fitScale } from './scale.ts';

const clock = makeClock(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('canvas#countdown');
const context = canvas === null ? null : canvas.getContext('2d');
let marked = false;

/** Draws the frame the clock asks for, filling sky first and ink over it. */
function draw(): void {
  if (canvas === null || context === null) return;
  const now = new Date(Math.floor(clock().getTime() / 1000) * 1000); // the whole second it lands in
  const frame = countdownFrame(timeLeft(now), now.getSeconds() % 2 === 0);
  const dpr = window.devicePixelRatio || 1;
  const scale = fitScale(frame, { width: window.innerWidth, height: window.innerHeight }, dpr);
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
  }
}

/** Draws, then waits to the clock's next whole second, reading it fresh. */
function tick(): void {
  draw();
  window.setTimeout(tick, 1000 - clock().getMilliseconds());
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) draw();
});
window.addEventListener('pageshow', draw);
window.addEventListener('resize', draw);

/** Redraws at once when the pixel ratio changes (e.g. a move to another display). */
function watchDpr(): void {
  if (typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  media.addEventListener(
    'change',
    () => {
      draw(); // the whole-pixel scale depends on the ratio
      watchDpr(); // the old query no longer matches: listen for the next ratio
    },
    { once: true },
  );
}

watchDpr();
tick();
