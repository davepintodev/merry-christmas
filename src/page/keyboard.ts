// XMAS-44b "Keyboard wiring": the page's keyboard on the globe. An arrow turns it, Space or Enter
// shakes the snow (XMAS-44a's model in keys.ts). Keys with ctrl, alt or meta held are the browser's;
// a keydown while paused is swallowed; the page's blur releases every held key.
import type { Key, Keys } from './keys.ts';

export interface KeyEventLike {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
}
export interface KeyTarget {
  addEventListener(type: 'keydown' | 'keyup' | 'blur', handler: (event: KeyEventLike) => void): void;
  removeEventListener(type: 'keydown' | 'keyup' | 'blur', handler: (event: KeyEventLike) => void): void;
}

/** The keys the globe takes: the arrows turn it, Space and Enter give the burst. */
const KEYS = new Map<string, Key>([
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  [' ', 'burst'],
  ['Enter', 'burst'],
]);

/**
 * Wires the keys of `target` (the globe's element) to `keys`, and returns the function that takes the
 * listeners off. A key is taken only when no ctrl, alt or meta is held; a keydown while `isPaused()`
 * is swallowed, but its keyup still reaches `keys`, so nothing is left held. Blur releases every key.
 */
export function attachKeyboard(target: KeyTarget, keys: Keys, isPaused: () => boolean): () => void {
  function onKeyDown(event: KeyEventLike): void {
    const key = KEYS.get(event.key);
    if (key === undefined || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    if (isPaused()) return;
    keys.keyDown(key);
  }

  // A keyup always reaches keys, even with a modifier held, so a key pressed before the modifier is not left held.
  function onKeyUp(event: KeyEventLike): void {
    const key = KEYS.get(event.key);
    if (key === undefined) return;
    event.preventDefault();
    keys.keyUp(key);
  }

  function onBlur(): void {
    keys.reset();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
  };
}
