// XMAS-44b: the keyboard wiring. A fake target and fake Keys record what the page's key events do.
import { describe, expect, it } from 'vitest';
import { attachKeyboard, type KeyTarget } from './keyboard.ts';
import type { Key, Keys } from './keys.ts';

type Ev = { key: string; repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; preventDefault(): void };
type Handler = (event: Ev) => void;

class FakeTarget implements KeyTarget {
  readonly handlers = new Map<string, Handler[]>();
  addEventListener(type: "keydown" | "keyup" | "blur", handler: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  removeEventListener(type: "keydown" | "keyup" | "blur", handler: Handler): void {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== handler));
  }
  /** Fires an event and returns whether the page called preventDefault. */
  fire(type: 'keydown' | 'keyup' | 'blur', key = '', mods: Partial<Ev> = {}): boolean {
    let prevented = false;
    const event = { key, repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => (prevented = true), ...mods };
    for (const h of this.handlers.get(type) ?? []) h(event);
    return prevented;
  }
}

class FakeKeys implements Keys {
  readonly calls: string[] = [];
  keyDown(key: Key): void {
    this.calls.push(`down:${key}`);
  }
  keyUp(key: Key): void {
    this.calls.push(`up:${key}`);
  }
  step(): never {
    throw new Error('not used');
  }
  reset(): void {
    this.calls.push('reset');
  }
}

function setup(paused = false) {
  const target = new FakeTarget();
  const keys = new FakeKeys();
  const state = { paused };
  const detach = attachKeyboard(target, keys, () => state.paused);
  return { target, keys, state, detach };
}

describe('attachKeyboard', () => {
  it.each([
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    [' ', 'burst'],
    ['Enter', 'burst'],
  ])('maps %s to %s on down and up, and keeps the page from scrolling', (key, mapped) => {
    const { target, keys } = setup();
    expect(target.fire('keydown', key)).toBe(true);
    expect(target.fire('keyup', key)).toBe(true);
    expect(keys.calls).toEqual([`down:${mapped}`, `up:${mapped}`]);
  });

  it('leaves other keys alone, including Tab and letters', () => {
    const { target, keys } = setup();
    for (const key of ['Tab', 'a', 'ArrowUp', 'Escape']) expect(target.fire('keydown', key)).toBe(false);
    expect(keys.calls).toEqual([]);
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)('ignores an arrow with %s held, without preventDefault', (mod) => {
    const { target, keys } = setup();
    expect(target.fire('keydown', 'ArrowRight', { [mod]: true })).toBe(false);
    expect(keys.calls).toEqual([]);
  });

  it('swallows a keydown while paused but still forwards the keyup', () => {
    const { target, keys, state } = setup();
    target.fire('keydown', 'ArrowRight');
    state.paused = true;
    expect(target.fire('keydown', ' ')).toBe(true);
    expect(target.fire('keyup', 'ArrowRight')).toBe(true);
    expect(keys.calls).toEqual(['down:right', 'up:right']);
  });

  it('resets the keys on blur', () => {
    const { target, keys } = setup();
    target.fire('blur');
    expect(keys.calls).toEqual(['reset']);
  });

  it('stops listening once detached', () => {
    const { target, keys, detach } = setup();
    detach();
    expect(target.fire('keydown', 'ArrowLeft')).toBe(false);
    target.fire('blur');
    expect(keys.calls).toEqual([]);
  });
});
