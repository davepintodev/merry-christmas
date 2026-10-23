// XMAS-41b2 "Drag input", page side: attachPointer turns pointer events into
// calls on the pure drag model. The target is a hand-written fake that holds
// its listeners, the drag is a recording fake (or the real one where the test
// is about what the drag then does), and the clock is whatever the test sets.
import { describe, expect, it } from 'vitest';
import { createDrag, type Drag, type DragOutput } from './drag.ts';
import { attachPointer, type PointerEventLike, type PointerTarget } from './pointer.ts';

type Kind = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture';
type Listener = (event: PointerEventLike) => void;
type Fired = PointerEventLike & { prevented: boolean };

class FakeTarget implements PointerTarget {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captured: number[] = [];
  readonly released: number[] = [];
  readonly removed: [string, Listener][] = [];
  throwOnCapture: Error | null = null;
  throwOnRelease: Error | null = null;

  addEventListener(type: Kind, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: Kind, listener: Listener): void {
    this.removed.push([type, listener]);
    this.listeners.get(type)?.delete(listener);
  }
  setPointerCapture(id: number): void {
    if (this.throwOnCapture) throw this.throwOnCapture;
    this.captured.push(id);
  }
  releasePointerCapture(id: number): void {
    if (this.throwOnRelease) throw this.throwOnRelease;
    this.released.push(id);
  }

  count(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  fire(type: Kind, init: { id?: number; x?: number; y?: number; button?: number; buttons?: number; pointerType?: string } = {}): Fired {
    const event: Fired = {
      pointerId: init.id ?? 1,
      clientX: init.x ?? 0,
      clientY: init.y ?? 0,
      button: init.button ?? 0,
      pointerType: init.pointerType ?? 'mouse',
      ...(init.buttons === undefined ? {} : { buttons: init.buttons }),
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
}

class RecordingDrag implements Drag {
  readonly calls: unknown[][] = [];
  pointerDown(id: number, x: number, y: number, t: number): void {
    this.calls.push(['down', id, x, y, t]);
  }
  pointerMove(id: number, x: number, y: number, t: number): void {
    this.calls.push(['move', id, x, y, t]);
  }
  pointerUp(id: number, t: number): void {
    this.calls.push(['up', id, t]);
  }
  pointerCancel(id: number): void {
    this.calls.push(['cancel', id]);
  }
  turnBy(delta: number): void {
    this.calls.push(['turn', delta]);
  }
  step(): DragOutput {
    return { turn: 0, lean: 0, raise: 0, push: { x: 0, y: 0, z: 0 } };
  }
}

/** Client pixels are three times art pixels, offset by (10, 20). */
const toArt = (cx: number, cy: number): { x: number; y: number } => ({ x: (cx - 10) / 3, y: (cy - 20) / 3 });

function setup(): { target: FakeTarget; drag: RecordingDrag; now: { t: number }; detach: () => void } {
  const target = new FakeTarget();
  const drag = new RecordingDrag();
  const now = { t: 5 };
  const detach = attachPointer(target, drag, toArt, () => now.t);
  return { target, drag, now, detach };
}

describe('attaching', () => {
  it('listens for pointerdown, pointermove, pointerup, pointercancel and lostpointercapture, and nothing else', () => {
    const { target } = setup();
    expect([...target.listeners.keys()].sort()).toEqual(['lostpointercapture', 'pointercancel', 'pointerdown', 'pointermove', 'pointerup']);
    for (const set of target.listeners.values()) expect(set.size).toBe(1);
  });

  it('does nothing to the drag until an event arrives', () => {
    const { drag } = setup();
    expect(drag.calls).toEqual([]);
  });
});

describe('pointer down', () => {
  it('prevents the default, captures the pointer and starts the drag in art pixels at the clock\'s time', () => {
    const { target, drag, now } = setup();
    now.t = 12.5;
    const event = target.fire('pointerdown', { id: 7, x: 40, y: 80 });
    expect(event.prevented).toBe(true);
    expect(target.captured).toEqual([7]);
    expect(drag.calls).toEqual([['down', 7, 10, 20, 12.5]]);
  });

  it('ignores the secondary and middle mouse buttons: no drag, no capture, the page keeps its default', () => {
    const { target, drag } = setup();
    for (const button of [1, 2, 3, 4]) {
      const event = target.fire('pointerdown', { id: 1, x: 40, y: 80, button, pointerType: 'mouse' });
      expect(event.prevented, `button ${button}`).toBe(false);
    }
    expect(drag.calls).toEqual([]);
    expect(target.captured).toEqual([]);
  });

  it('a right click while the left button drags does not start a second drag or end the first', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    target.fire('pointerdown', { id: 2, x: 70, y: 80, button: 2 });
    expect(drag.calls.filter((c) => c[0] === 'down')).toEqual([['down', 1, 10, 20, 5]]);
    target.fire('pointermove', { id: 1, x: 100, y: 80 });
    expect(drag.calls.at(-1)).toEqual(['move', 1, 30, 20, 5]);
  });

  it('starts a touch drag (button 0) and a pen drag the same way', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 3, x: 13, y: 23, pointerType: 'touch' });
    target.fire('pointerup', { id: 3, pointerType: 'touch' });
    target.fire('pointerdown', { id: 4, x: 13, y: 23, pointerType: 'pen' });
    expect(drag.calls.filter((c) => c[0] === 'down').map((c) => c[1])).toEqual([3, 4]);
  });

  it('ignores a down with a non-finite position, then still takes a good one', () => {
    const { target, drag } = setup();
    for (const [x, y] of [
      [Number.NaN, 5],
      [5, Number.NaN],
      [Number.POSITIVE_INFINITY, 5],
      [5, Number.NEGATIVE_INFINITY],
    ] as const) {
      expect(() => target.fire('pointerdown', { id: 1, x, y })).not.toThrow();
    }
    expect(drag.calls).toEqual([]);
    expect(target.captured).toEqual([]);
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    expect(drag.calls).toEqual([['down', 1, 10, 20, 5]]);
  });

  it('ignores a down whose conversion to art pixels is not finite', () => {
    const target = new FakeTarget();
    const drag = new RecordingDrag();
    attachPointer(target, drag, () => ({ x: Number.NaN, y: 0 }), () => 0);
    expect(() => target.fire('pointerdown', { id: 1, x: 1, y: 1 })).not.toThrow();
    expect(drag.calls).toEqual([]);
  });
});

describe('move, up and cancel', () => {
  it('forwards each move in art pixels with the clock\'s time at that event', () => {
    const { target, drag, now } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    now.t = 5.25;
    target.fire('pointermove', { id: 1, x: 70, y: 110 });
    now.t = 5.5;
    target.fire('pointermove', { id: 1, x: 100, y: 110 });
    expect(drag.calls.slice(1)).toEqual([
      ['move', 1, 20, 30, 5.25],
      ['move', 1, 30, 30, 5.5],
    ]);
  });

  it('forwards the up with its time and releases the capture', () => {
    const { target, drag, now } = setup();
    target.fire('pointerdown', { id: 4, x: 40, y: 80 });
    now.t = 6;
    target.fire('pointerup', { id: 4 });
    expect(drag.calls.at(-1)).toEqual(['up', 4, 6]);
    expect(target.released).toEqual([4]);
  });

  it('forwards the cancel and releases the capture', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 4, x: 40, y: 80 });
    target.fire('pointercancel', { id: 4 });
    expect(drag.calls.at(-1)).toEqual(['cancel', 4]);
    expect(target.released).toEqual([4]);
  });

  it('ignores a move with a non-finite position, and the next good move is still taken', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    expect(() => target.fire('pointermove', { id: 1, x: Number.NaN, y: 5 })).not.toThrow();
    expect(() => target.fire('pointermove', { id: 1, x: 5, y: Number.POSITIVE_INFINITY })).not.toThrow();
    expect(drag.calls).toHaveLength(1);
    target.fire('pointermove', { id: 1, x: 70, y: 80 });
    expect(drag.calls.at(-1)).toEqual(['move', 1, 20, 20, 5]);
  });

  it('a lost pointer (cancel) ends the drag: later moves of that pointer turn nothing', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, (x, y) => ({ x, y }), () => 0);
    target.fire('pointerdown', { id: 1, x: 0, y: 0 });
    target.fire('pointercancel', { id: 1 });
    target.fire('pointermove', { id: 1, x: 50, y: 0 });
    expect(drag.step(1 / 60).turn).toBe(0);
  });

  it('a hover with no button down (a mouse move before any down) turns nothing', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, (x, y) => ({ x, y }), () => 0);
    target.fire('pointermove', { id: 1, x: 10, y: 0 });
    target.fire('pointermove', { id: 1, x: 90, y: 40 });
    const out = drag.step(1 / 60);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
  });

  it('an up or cancel for a pointer that never went down does not throw', () => {
    const { target } = setup();
    expect(() => target.fire('pointerup', { id: 99 })).not.toThrow();
    expect(() => target.fire('pointercancel', { id: 99 })).not.toThrow();
  });

  it('a drag that overflows (a jump the drag model refuses) does not throw out of the listener', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, (x, y) => ({ x, y }), () => 0);
    target.fire('pointerdown', { id: 1, x: -1e308, y: 0 });
    expect(() => target.fire('pointermove', { id: 1, x: 1e308, y: 0 })).not.toThrow();
  });
});

describe('a second finger', () => {
  it('does not throw and does not break the first finger\'s drag', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, (x, y) => ({ x, y }), () => 0);
    target.fire('pointerdown', { id: 1, x: 0, y: 0, pointerType: 'touch' });
    expect(() => target.fire('pointerdown', { id: 2, x: 200, y: 0, pointerType: 'touch' })).not.toThrow();
    target.fire('pointermove', { id: 2, x: 250, y: 90, pointerType: 'touch' });
    target.fire('pointermove', { id: 1, x: 10, y: 0, pointerType: 'touch' });
    target.fire('pointerup', { id: 2, pointerType: 'touch' });
    target.fire('pointermove', { id: 1, x: 30, y: 0, pointerType: 'touch' });
    const out = drag.step(1 / 60);
    expect(out.turn).toBeCloseTo(-30 * 0.018, 9); // only the first finger's 30 px
  });

  it('lifting the second finger first does not end the first finger\'s drag, and lifting the first does', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, (x, y) => ({ x, y }), () => 0);
    target.fire('pointerdown', { id: 1, x: 0, y: 0 });
    target.fire('pointerdown', { id: 2, x: 100, y: 0 });
    target.fire('pointercancel', { id: 2 });
    target.fire('pointermove', { id: 1, x: 10, y: 0 });
    expect(drag.step(1 / 60).turn).toBeCloseTo(-10 * 0.018, 9);
    target.fire('pointerup', { id: 1 });
    target.fire('pointermove', { id: 1, x: 90, y: 0 });
    expect(drag.step(1 / 60).turn).toBeCloseTo(-10 * 0.018, 9);
  });
});

describe('detaching', () => {
  it('removes every listener it added, with the same functions', () => {
    const { target, detach } = setup();
    const added = new Map([...target.listeners].map(([type, set]) => [type, [...set][0]]));
    detach();
    expect(target.count()).toBe(0);
    expect(target.removed).toHaveLength(5);
    for (const [type, listener] of target.removed) expect(added.get(type)).toBe(listener);
  });

  it('after detaching, events reach the drag no more', () => {
    const { target, drag, detach } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    detach();
    target.fire('pointermove', { id: 1, x: 70, y: 80 });
    target.fire('pointerup', { id: 1 });
    target.fire('pointerdown', { id: 2, x: 40, y: 80 });
    expect(drag.calls).toHaveLength(1);
  });

  it('detaching twice is harmless', () => {
    const { target, detach } = setup();
    detach();
    expect(() => detach()).not.toThrow();
    expect(target.count()).toBe(0);
  });

  it('two attachments to two targets are independent', () => {
    const a = setup();
    const b = setup();
    a.detach();
    b.target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    expect(b.drag.calls).toHaveLength(1);
    expect(a.target.count()).toBe(0);
    expect(b.target.count()).toBe(5);
  });
});

const id3 = (x: number, y: number): { x: number; y: number } => ({ x, y });

/** Fires, tolerating whatever the listener does with a browser error. */
function tryFire(target: FakeTarget, type: Kind, init: Parameters<FakeTarget['fire']>[1] = {}): void {
  try {
    target.fire(type, init);
  } catch {
    // the test is about what the drag was told
  }
}

describe('a capture call that throws', () => {
  it.each(['pointerup', 'pointercancel'] as const)('%s still reaches the drag when releasePointerCapture throws', (type) => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    target.throwOnRelease = new DOMException('no capture', 'NotFoundError');
    tryFire(target, type, { id: 1 });
    expect(drag.calls.at(-1)?.[0]).toBe(type === 'pointerup' ? 'up' : 'cancel');
  });

  it.each(['pointerup', 'pointercancel'] as const)('%s with a throwing release leaves no stuck drag: a later pointer works', (type) => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, id3, () => 0);
    target.fire('pointerdown', { id: 1, x: 0, y: 0, pointerType: 'touch' });
    target.throwOnRelease = new DOMException('no capture', 'NotFoundError');
    tryFire(target, type, { id: 1, pointerType: 'touch' });
    target.throwOnRelease = null;
    drag.step(1 / 60);
    target.fire('pointerdown', { id: 2, x: 0, y: 0, pointerType: 'touch' });
    target.fire('pointermove', { id: 2, x: 30, y: 0, pointerType: 'touch' });
    expect(drag.step(1 / 60).turn).toBeCloseTo(-30 * 0.018, 9);
  });

  it('a throwing setPointerCapture on down leaves no stuck drag: a later pointer works', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, id3, () => 0);
    target.throwOnCapture = new DOMException('gone', 'InvalidStateError');
    tryFire(target, 'pointerdown', { id: 1, x: 0, y: 0, pointerType: 'touch' });
    target.throwOnCapture = null;
    target.fire('pointerdown', { id: 2, x: 0, y: 0, pointerType: 'touch' });
    target.fire('pointermove', { id: 2, x: 30, y: 0, pointerType: 'touch' });
    expect(drag.step(1 / 60).turn).toBeCloseTo(-30 * 0.018, 9);
  });

  it('a throwing setPointerCapture does not leave pointer 1 in the drag: its later moves turn nothing', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, id3, () => 0);
    target.throwOnCapture = new DOMException('gone', 'InvalidStateError');
    tryFire(target, 'pointerdown', { id: 1, x: 0, y: 0, pointerType: 'touch' });
    target.throwOnCapture = null;
    target.fire('pointermove', { id: 1, x: 30, y: 0, pointerType: 'touch' });
    expect(drag.step(1 / 60).turn).toBe(0);
  });
});

describe('lostpointercapture', () => {
  it('ends the drag as a cancel, not an up', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 4, x: 40, y: 80 });
    target.fire('lostpointercapture', { id: 4 });
    expect(drag.calls.at(-1)).toEqual(['cancel', 4]);
    expect(drag.calls.some((c) => c[0] === 'up')).toBe(false);
  });

  it('leaves later moves turning nothing and gives no flick burst', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    let t = 0;
    attachPointer(target, drag, id3, () => t);
    target.fire('pointerdown', { id: 1, x: 0, y: 0 });
    for (let i = 1; i <= 5; i++) {
      t = i / 60;
      target.fire('pointermove', { id: 1, x: i * 20, y: 0 });
    }
    const before = drag.step(1 / 60);
    expect(before.turn).toBeCloseTo(-100 * 0.018, 9);
    target.fire('lostpointercapture', { id: 1 });
    target.fire('pointermove', { id: 1, x: 300, y: 0 });
    const out = drag.step(1 / 60);
    expect(out.turn).toBeCloseTo(-100 * 0.018, 9);
    expect(out.push).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('after an up, the lostpointercapture that follows is harmless and the next drag works', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, id3, () => 0);
    target.fire('pointerdown', { id: 1, x: 0, y: 0 });
    target.fire('pointerup', { id: 1 });
    expect(() => target.fire('lostpointercapture', { id: 1 })).not.toThrow();
    drag.step(1 / 60);
    target.fire('pointerdown', { id: 2, x: 0, y: 0 });
    target.fire('pointermove', { id: 2, x: 30, y: 0 });
    expect(drag.step(1 / 60).turn).toBeCloseTo(-30 * 0.018, 9);
  });
});

describe('a mouse move with no button held', () => {
  it('ends an active mouse drag as a cancel and is not forwarded as a move', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    target.fire('pointermove', { id: 1, x: 70, y: 80, buttons: 0 });
    expect(drag.calls.filter((c) => c[0] === 'move')).toEqual([]);
    expect(drag.calls.at(-1)).toEqual(['cancel', 1]);
  });

  it('turns and stirs nothing further, even when the buttons come back', () => {
    const drag = createDrag(0);
    const target = new FakeTarget();
    attachPointer(target, drag, id3, () => 0);
    target.fire('pointerdown', { id: 1, x: 0, y: 0 });
    target.fire('pointermove', { id: 1, x: 40, y: 10, buttons: 0 });
    target.fire('pointermove', { id: 1, x: 80, y: 20, buttons: 1 });
    const out = drag.step(1 / 60);
    expect(out.turn).toBe(0);
    expect(out.raise).toBe(0);
  });

  it('a mouse move with the primary button held (buttons 1) or unreported is still a move', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80 });
    target.fire('pointermove', { id: 1, x: 70, y: 80, buttons: 1 });
    target.fire('pointermove', { id: 1, x: 100, y: 80 });
    expect(drag.calls.filter((c) => c[0] === 'move')).toHaveLength(2);
  });

  it('a touch or pen move with buttons 0 is not affected', () => {
    const { target, drag } = setup();
    target.fire('pointerdown', { id: 1, x: 40, y: 80, pointerType: 'touch' });
    target.fire('pointermove', { id: 1, x: 70, y: 80, buttons: 0, pointerType: 'touch' });
    target.fire('pointerdown', { id: 2, x: 40, y: 80, pointerType: 'pen' });
    target.fire('pointermove', { id: 2, x: 70, y: 80, buttons: 0, pointerType: 'pen' });
    expect(drag.calls.filter((c) => c[0] === 'move')).toHaveLength(2);
    expect(drag.calls.some((c) => c[0] === 'cancel')).toBe(false);
  });
});

describe('which errors are swallowed', () => {
  class ThrowingDrag extends RecordingDrag {
    constructor(private readonly error: Error) {
      super();
    }
    override pointerDown(): void {
      throw this.error;
    }
    override pointerMove(): void {
      throw this.error;
    }
    override pointerUp(): void {
      throw this.error;
    }
    override pointerCancel(): void {
      throw this.error;
    }
  }
  const attachThrowing = (error: Error): FakeTarget => {
    const target = new FakeTarget();
    attachPointer(target, new ThrowingDrag(error), id3, () => 0);
    return target;
  };

  it.each(['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const)('a TypeError from the drag on %s propagates', (type) => {
    const target = attachThrowing(new TypeError('bug'));
    expect(() => target.fire(type, { id: 1, x: 1, y: 1 })).toThrow(TypeError);
  });

  it.each(['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const)('a RangeError from the drag on %s is swallowed', (type) => {
    const target = attachThrowing(new RangeError('overflow'));
    expect(() => target.fire(type, { id: 1, x: 1, y: 1 })).not.toThrow();
  });
});
