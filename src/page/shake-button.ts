// XMAS-43b "Shake wiring and the shake button", XMAS-125 "Shake button covers the base lettering": the page's shake
// button, a real focusable button whose picture is the shake sign (scene/shake-sign.ts), a small wooden sign reading
// "TAP TO SHAKE" standing in the snow: on the phone under the base, right of the sound and pause buttons, with the
// scene's bunny at its end; on a wide window right of the base. It is shown only while the browser still needs a tap
// for motion access (ShakeAccess.buttonShown); a press asks for it (ShakeAccess.tap). The picture is drawn in art
// pixels, one canvas pixel each, and the CSS size scales it to `scale` device pixels an art pixel, as the pause button.
import { sceneLayout } from '../scene/frame.ts';
import type { BunnySpot } from '../scene/scenery.ts';
import { SHAKE_TEXT, signInks, signPicture, signPlace, type SignPlace } from '../scene/shake-sign.ts';
import type { PhaseReading } from '../shared/clock.ts';
import { buttonBox, EDGE, pauseDrawing, TAP_MIN } from './pause-button.ts';
import type { ShakeAccess } from './shake-access.ts';

export { SHAKE_TEXT };

/** What the button is placed on: the scene picture's size and place, and the phase its colours follow. */
export interface ShakeView {
  /** Device pixels per art pixel, and the screen's device pixel ratio. */
  scale: number;
  ratio: number;
  /** The picture's size in art pixels, its seed, and its left edge in CSS pixels (its top is the window's). */
  width: number;
  height: number;
  seed: number;
  left: number;
  /** The window's height in CSS pixels. */
  windowHeight: number;
  phase: PhaseReading;
}

/** A box in CSS pixels. */
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The tap area in CSS pixels, and where the sign's picture sits inside it. */
export interface TapArea extends CssBox {
  /** The picture's top inside the tap area: above it the area is clear. */
  artTop: number;
}

/**
 * The button's tap area for a sign at `box` (art pixels) on the view's picture: it starts at the sign picture's top
 * and left (on the phone, the base's bottom edge), at least TAP_MIN each way. Where the window's bottom leaves under
 * TAP_MIN below that top, the area reaches up over it instead (clear there), ending at the window's bottom; the
 * picture stays where it is.
 */
export function tapArea(box: SignPlace['box'], view: Pick<ShakeView, 'scale' | 'ratio' | 'left' | 'windowHeight'>): TapArea {
  const css = view.scale / view.ratio;
  // Layout keeps CSS pixels in 64ths, rounding down: rounded up to the next one, the picture's top stays under the sign's edge.
  const artTop = Math.ceil(box.y * css * 64) / 64;
  const height = Math.ceil(Math.max(TAP_MIN, box.height * css) * view.ratio) / view.ratio;
  const top = Math.min(artTop, Math.floor((view.windowHeight - Math.min(height, view.windowHeight)) * 64) / 64);
  return {
    left: view.left + box.x * css,
    top,
    width: Math.ceil(Math.max(TAP_MIN, box.width * css) * view.ratio) / view.ratio,
    height: Math.max(TAP_MIN, Math.min(height, Math.floor((view.windowHeight - top) * 64) / 64)),
    artTop: artTop - top,
  };
}

/** What the page does with the button after it is wired: the page places it on every frame it draws. */
export interface ShakeButton {
  /** Shows the button while the access asks for a tap, and places and paints it for the view. Cheap when nothing changed. */
  place(view: ShakeView): void;
  /** Where the scene's bunny sits while the sign shows on the phone (at its end); undefined while hidden: it stays home. */
  readonly bunny: BunnySpot | undefined;
}

/** Paints the sign's picture on `canvas`, one canvas pixel an art pixel. */
function paintSign(canvas: HTMLCanvasElement, picture: ReturnType<typeof signPicture>): void {
  canvas.width = picture.width;
  canvas.height = picture.height;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.clearRect(0, 0, picture.width, picture.height);
  picture.colours.forEach((colour, i) => {
    if (colour === '') return;
    context.fillStyle = colour;
    context.fillRect(i % picture.width, Math.floor(i / picture.width), 1, 1);
  });
}

/**
 * Wires `button`, whose picture is drawn on `art`, to the shake access: a press asks for motion access, and the
 * button shows while a tap is still needed.
 */
export function attachShakeButton(button: HTMLButtonElement, art: HTMLCanvasElement, access: ShakeAccess): ShakeButton {
  let placed = '';
  let painted = '';
  let at: SignPlace | null = null;

  button.setAttribute('aria-label', SHAKE_TEXT);
  // The button goes as soon as the answer is in, not on the next drawn frame: a paused scene draws none.
  button.addEventListener('click', () => {
    void access.tap().then(() => {
      button.hidden = !access.buttonShown;
    });
  });

  return {
    get bunny() {
      return button.hidden ? undefined : (at?.bunny ?? undefined);
    },
    place(view) {
      button.hidden = !access.buttonShown;
      if (button.hidden) return;
      const { scale, ratio, width, height, seed, left, windowHeight } = view;
      const key = `${scale} ${ratio} ${width} ${height} ${seed} ${left} ${windowHeight}`;
      if (key !== placed || at === null) {
        placed = key;
        painted = '';
        // The sound and pause buttons take two tap slots from the left edge; the sign keeps right of them.
        const slot = buttonBox(pauseDrawing(false), scale, ratio).tap.width;
        const buttonsRight = Math.ceil(((EDGE + 2 * slot - left) * ratio) / scale);
        at = signPlace(sceneLayout(width, height, seed), buttonsRight);
        const tap = tapArea(at.box, view);
        button.style.left = `${tap.left}px`;
        button.style.top = `${tap.top}px`;
        button.style.width = `${tap.width}px`;
        button.style.height = `${tap.height}px`;
        // One art pixel in CSS pixels, for the focus ring's two lines.
        button.style.setProperty('--art', `${scale / ratio}px`);
        art.style.width = `${(at.box.width * scale) / ratio}px`;
        art.style.height = `${(at.box.height * scale) / ratio}px`;
        art.style.left = '0px';
        // Over the picture's top the tap area is clear (XMAS-125: a full 44 pixels where the strip is shorter).
        art.style.top = `${tap.artTop}px`;
      }
      const inks = signInks(view.phase);
      const inkKey = Object.values(inks).join();
      if (inkKey === painted) return;
      painted = inkKey;
      paintSign(art, signPicture(at, inks));
    },
  };
}
