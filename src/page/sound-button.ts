// XMAS-46c "Sound button and page wiring": the page's sound button, a real focusable button in the bottom-left
// corner, the slot the pause button sits one slot in from. It shows the speaker with a red cross while the sound is
// muted and the speaker with sound waves once it is on, both drawn in art pixels from the buttons sheet, and its
// screen reader name says what a press does now. The engine makes the sound (sound-engine.ts); this file only
// toggles it and draws the button.
import { drawings, type Drawing } from '../shared/art.generated.ts';
import { buttonBox, EDGE, paint } from './pause-button.ts';
import type { SoundEngine } from './sound-engine.ts';

/** The screen reader names: each says the state and what a press does now. */
export const SOUND_ON_NAME = 'Sound is on. Turn sound off';
export const SOUND_OFF_NAME = 'Sound is off. Turn sound on';

/** The drawing a state shows: the speaker with sound waves when on, the speaker with a red cross when muted. */
export function soundDrawing(unmuted: boolean): Drawing {
  const drawing = drawings[unmuted ? 'speaker-on' : 'speaker-muted'];
  if (drawing === undefined) throw new Error('the buttons sheet has no speaker drawing');
  return drawing;
}

/** The screen reader name a state gives. */
export function soundName(unmuted: boolean): string {
  return unmuted ? SOUND_ON_NAME : SOUND_OFF_NAME;
}

/** What the page does with the button after it is wired: the page places it on every frame it draws. */
export interface SoundButton {
  /**
   * Places the button for art pixels `scale` device pixels across, on a screen of device pixel ratio `ratio`, and
   * shows it. Cheap when the size has not changed.
   */
  place(scale: number, ratio: number): void;
}

/**
 * Wires `button`, whose drawing is on `art`, to the sound engine: a press unmutes or mutes it, and the drawing and
 * the name follow the engine's state. A context that could not be made leaves the engine muted, so the button shows off.
 */
export function attachSoundButton(button: HTMLButtonElement, art: HTMLCanvasElement, engine: SoundEngine): SoundButton {
  let shown: boolean | null = null;
  let placed = '';

  /** Redraws and renames the button when the engine's state differs from the one shown. */
  function refresh(): void {
    const unmuted = engine.unmuted;
    if (unmuted === shown) return;
    shown = unmuted;
    paint(art, soundDrawing(unmuted));
    button.setAttribute('aria-label', soundName(unmuted));
  }

  button.addEventListener('click', () => {
    if (engine.unmuted) engine.mute();
    else engine.unmute();
    refresh();
  });
  refresh();

  return {
    place(scale, ratio) {
      const key = `${scale} ${ratio}`;
      if (key === placed) return;
      placed = key;
      const box = buttonBox(soundDrawing(engine.unmuted), scale, ratio);
      button.style.width = `${box.tap.width}px`;
      button.style.height = `${box.tap.height}px`;
      // The corner slot: the pause button sits one slot in from it.
      button.style.left = `${EDGE}px`;
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
