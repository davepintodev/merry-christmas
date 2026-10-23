// XMAS-43b "Shake wiring and the shake button": the page's shake button, a real focusable button in the bottom-right
// corner. It reads "TAP TO TURN ON SHAKE" on the shake frame from the buttons sheet, stretched wide enough for the text.
// It is shown only while the browser still needs a tap for motion access (ShakeAccess.buttonShown); a press asks for
// it (ShakeAccess.tap). The picture is drawn in art pixels, the same way as the pause button (pause-button.ts).
import { drawings, type Drawing } from '../shared/art.generated.ts';
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';
import { buttonBox, EDGE, paint, pauseDrawing } from './pause-button.ts';
import type { ShakeAccess } from './shake-access.ts';

/** The button's words: its screen reader name, and the text on its picture. */
export const SHAKE_TEXT = 'TAP TO TURN ON SHAKE';

/** The font's one-column gap after each glyph. */
const GLYPH_GAP = 1;
/** The text's width in art pixels: its last glyph's last column plus one. */
const TEXT_WIDTH = [...SHAKE_TEXT].reduce((sum, char) => sum + glyphWidth(char) + GLYPH_GAP, -GLYPH_GAP);
/** Clear art pixels kept on each side of the text, inside the frame's ends: the picture is 87 wide. */
const PADDING = 4;
/** The frame's ends keep their columns; the middle one is the column repeated to stretch it. */
const FRAME_HALF = 30;

/** The shake frame stretched to `width` art pixels: its ends kept, its middle column repeated between them. */
function stretchedFrame(frame: Drawing, width: number): Pick<Drawing, 'width' | 'height' | 'pixels'> {
  const pixels = new Uint8Array(width * frame.height);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < width; x++) {
      const fromLeft = x < FRAME_HALF;
      const fromRight = width - x <= FRAME_HALF;
      const column = fromLeft ? x : fromRight ? frame.width - (width - x) : FRAME_HALF;
      pixels[y * width + x] = frame.pixels[y * frame.width + column] ?? 0;
    }
  }
  return { width, height: frame.height, pixels };
}

/**
 * The shake button's picture: the shake frame stretched to fit SHAKE_TEXT with PADDING clear on each side, and the
 * text centred inside it in the font's own palette indices.
 */
export function shakeButtonPicture(): Pick<Drawing, 'width' | 'height' | 'pixels'> {
  const frame = drawings['shake-frame'];
  if (frame === undefined) throw new Error('the buttons sheet has no shake drawing');
  const width = TEXT_WIDTH + 2 * PADDING;
  const picture = stretchedFrame(frame, width);
  const left = Math.floor((width - TEXT_WIDTH) / 2);
  const top = Math.floor((frame.height - GLYPH_HEIGHT) / 2);
  let x = left;
  for (const char of SHAKE_TEXT) {
    const stroke = glyph(char);
    if (stroke !== undefined) {
      stroke.pixels.forEach((n, i) => {
        if (n === 0) return;
        picture.pixels[(top + Math.floor(i / stroke.width)) * width + x + (i % stroke.width)] = n;
      });
    }
    x += glyphWidth(char) + GLYPH_GAP;
  }
  return picture;
}

/** What the page does with the button after it is wired: the page places it on every frame it draws. */
export interface ShakeButton {
  /**
   * Places the button for art pixels `scale` device pixels across, on a screen of device pixel ratio `ratio`, and
   * shows it while the access asks for a tap. Cheap when the size has not changed.
   */
  place(scale: number, ratio: number): void;
}

/**
 * Wires `button`, whose picture is drawn on `art`, to the shake access: a press asks for motion access, and the
 * button shows while a tap is still needed.
 */
export function attachShakeButton(button: HTMLButtonElement, art: HTMLCanvasElement, access: ShakeAccess): ShakeButton {
  const picture = shakeButtonPicture();
  let placed = '';

  paint(art, picture);
  button.setAttribute('aria-label', SHAKE_TEXT);
  // The button goes as soon as the answer is in, not on the next drawn frame: a paused scene draws none.
  button.addEventListener('click', () => {
    void access.tap().then(() => {
      button.hidden = !access.buttonShown;
    });
  });

  return {
    place(scale, ratio) {
      button.hidden = !access.buttonShown;
      const key = `${scale} ${ratio} ${window.innerWidth}`;
      if (key === placed) return;
      placed = key;
      const box = buttonBox(picture, scale, ratio);
      button.style.right = `${EDGE}px`;
      button.style.width = `${box.tap.width}px`;
      button.style.height = `${box.tap.height}px`;
      // The sound and pause buttons take two slots from the left; when this one would touch them, it moves up a row.
      const slot = buttonBox(pauseDrawing(false), scale, ratio).tap.width;
      const sideBySide = window.innerWidth - EDGE - box.tap.width >= 2 * EDGE + 2 * slot;
      button.style.bottom = `${sideBySide ? EDGE : 2 * EDGE + box.tap.height}px`;
      // One art pixel in CSS pixels, for the focus ring's two lines.
      button.style.setProperty('--art', `${scale / ratio}px`);
      art.style.width = `${box.drawing.width}px`;
      art.style.height = `${box.drawing.height}px`;
      art.style.left = `${box.drawing.left}px`;
      art.style.top = `${box.drawing.top}px`;
    },
  };
}
