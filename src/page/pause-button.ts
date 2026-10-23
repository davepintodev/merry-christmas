// XMAS-45b "Pause button on the page": the scene's pause button, a real focusable
// button in the bottom-left corner, one tap slot in from the left (the sound
// button takes the corner slot later). It shows the two bars while the scene
// moves and the triangle while it is paused, both drawn in art pixels from the
// buttons sheet, and its screen reader name follows the state. The scene does
// the freezing (XMAS-45a); this file only toggles the pause and draws the button.
import { drawings, type Drawing } from '../shared/art.generated.ts';
import { masterColours } from '../../art/colours.ts';
import type { PausableScene } from './loop.ts';

/** The smallest tap area a button takes, in CSS pixels on each side. */
export const TAP_MIN = 44;
/** CSS pixels kept between the buttons and the page edge (XMAS-91). */
export const EDGE = 8;

/** The screen reader names: each says what a press does now. */
export const PAUSE_NAME = 'Pause the movement';
export const RESUME_NAME = 'Resume the movement';

/** The drawing a state shows: the two bars while the scene moves, the triangle while it is paused. */
export function pauseDrawing(paused: boolean): Drawing {
  const drawing = drawings[paused ? 'pause-triangle' : 'pause-bars'];
  if (drawing === undefined) throw new Error('the buttons sheet has no pause drawing');
  return drawing;
}

/** Sizes in CSS pixels for a button: the tap area and where its drawing sits in it. */
export interface ButtonBox {
  /** The tap area: at least TAP_MIN each way, or the drawing's size when that is larger; whole device pixels. */
  tap: { width: number; height: number };
  /** The drawing's size, and its top left corner inside the tap area, on a whole device pixel. */
  drawing: { width: number; height: number; left: number; top: number };
}

/** A device-pixel size rounded up, so it is never smaller than the size asked for. */
function deviceUp(size: number, ratio: number): number {
  return Math.ceil(size * ratio) / ratio;
}

/** A position rounded to the nearest whole device pixel. */
function deviceNearest(size: number, ratio: number): number {
  return Math.round(size * ratio) / ratio;
}

/**
 * The button's box for a drawing of `art` size, drawn at `scale` device pixels
 * an art pixel on a screen of device pixel ratio `ratio`: the drawing is centred
 * in the tap area, and the tap area is never under TAP_MIN.
 */
export function buttonBox(art: { width: number; height: number }, scale: number, ratio: number): ButtonBox {
  const width = (art.width * scale) / ratio;
  const height = (art.height * scale) / ratio;
  const tapWidth = deviceUp(Math.max(TAP_MIN, width), ratio);
  const tapHeight = deviceUp(Math.max(TAP_MIN, height), ratio);
  return {
    tap: { width: tapWidth, height: tapHeight },
    drawing: {
      width,
      height,
      left: deviceNearest((tapWidth - width) / 2, ratio),
      top: deviceNearest((tapHeight - height) / 2, ratio),
    },
  };
}

/** Paints a drawing on the button's canvas, one canvas pixel to an art pixel; the CSS size does the scaling. */
export function paint(canvas: HTMLCanvasElement, drawing: Pick<Drawing, 'width' | 'height' | 'pixels'>): void {
  canvas.width = drawing.width;
  canvas.height = drawing.height;
  const context = canvas.getContext('2d');
  if (context === null) return;
  drawing.pixels.forEach((n, i) => {
    if (n === 0) return;
    context.fillStyle = masterColours[n - 1] ?? '#000000';
    context.fillRect(i % drawing.width, Math.floor(i / drawing.width), 1, 1);
  });
}

/** What the page does with the button after it is wired: the page places it on every frame it draws. */
export interface PauseButton {
  /**
   * Places the button for art pixels `scale` device pixels across, on a screen of
   * device pixel ratio `ratio`, and shows it. Cheap when the size has not changed.
   */
  place(scale: number, ratio: number): void;
}

/**
 * Wires `button`, whose drawing is on `art`, to the scene: a press toggles the
 * scene's pause, and the drawing and the name follow the state.
 */
export function attachPauseButton(button: HTMLButtonElement, art: HTMLCanvasElement, scene: PausableScene): PauseButton {
  let shown: boolean | null = null;
  let placed = '';

  /** Redraws and renames the button when the scene's state differs from the one shown. */
  function refresh(): void {
    const paused = scene.paused;
    if (paused === shown) return;
    shown = paused;
    paint(art, pauseDrawing(paused));
    button.setAttribute('aria-label', paused ? RESUME_NAME : PAUSE_NAME);
  }

  button.addEventListener('click', () => {
    scene.setPaused(!scene.paused);
    refresh();
  });
  refresh();

  return {
    place(scale, ratio) {
      const key = `${scale} ${ratio}`;
      if (key === placed) return;
      placed = key;
      const box = buttonBox(pauseDrawing(scene.paused), scale, ratio);
      button.style.width = `${box.tap.width}px`;
      button.style.height = `${box.tap.height}px`;
      // The corner slot is the sound button's; this one sits in the next slot along.
      button.style.left = `${EDGE + box.tap.width}px`;
      button.style.bottom = `${EDGE}px`;
      // One art pixel in CSS pixels, for the focus ring's two lines.
      button.style.setProperty('--art', `${scale / ratio}px`);
      art.style.width = `${box.drawing.width}px`;
      art.style.height = `${box.drawing.height}px`;
      art.style.left = `${box.drawing.left}px`;
      art.style.top = `${box.drawing.top}px`;
      button.hidden = false;
    },
  };
}
