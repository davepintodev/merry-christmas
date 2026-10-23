// XMAS-41b2 "Drag input", page side: the page's pointer input. attachPointer
// turns the scene canvas's pointer events into calls on the drag model, in art
// pixels and seconds. Only this file listens to the pointer; the scene gets
// plain inputs. A second finger is the drag model's to ignore.
import type { Drag } from './drag.ts';

/** What the pointer listeners read from an event. */
export interface PointerEventLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
  buttons?: number;
  pointerType?: string;
  preventDefault(): void;
}

type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture';

/** The small part of an element the pointer input needs; a canvas satisfies it. */
export interface PointerTarget {
  addEventListener(type: PointerType, listener: (event: PointerEventLike) => void): void;
  removeEventListener(type: PointerType, listener: (event: PointerEventLike) => void): void;
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
}

type Point = { x: number; y: number };

/**
 * Listens for the pointer on `target` and feeds `drag`. `toArt` turns client
 * pixels into art pixels and `nowSec` reads the clock in seconds. Returns the
 * function that takes the listeners back off.
 *
 * A drag ends on pointerup, pointercancel, a lost capture, or a mouse move with
 * no button held (the button came up off the page). Only a RangeError from the
 * drag model (a refused input) is dropped; any other error is a bug and
 * propagates. Each up or cancel reaches the drag before the capture is released,
 * so a failing release never leaves a drag stuck.
 */
export function attachPointer(
  target: PointerTarget,
  drag: Drag,
  toArt: (clientX: number, clientY: number) => Point,
  nowSec: () => number,
): () => void {
  /** The art pixel point of an event, or null when it is not a finite position. */
  function artPoint(event: PointerEventLike): Point | null {
    const point = toArt(event.clientX, event.clientY);
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  function guard(handle: (event: PointerEventLike) => void): (event: PointerEventLike) => void {
    return (event) => {
      try {
        handle(event);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    };
  }

  const onDown = guard((event) => {
    // Only the primary mouse button drags; touch and pen contacts count as primary.
    if (event.pointerType === 'mouse' && (event.button ?? 0) !== 0) return;
    const point = artPoint(event);
    if (point === null) return;
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    drag.pointerDown(event.pointerId, point.x, point.y, nowSec());
  });

  const onMove = guard((event) => {
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      drag.pointerCancel(event.pointerId);
      return;
    }
    const point = artPoint(event);
    if (point === null) return;
    drag.pointerMove(event.pointerId, point.x, point.y, nowSec());
  });

  const onUp = guard((event) => {
    try {
      drag.pointerUp(event.pointerId, nowSec());
    } finally {
      target.releasePointerCapture(event.pointerId);
    }
  });

  const onCancel = guard((event) => {
    try {
      drag.pointerCancel(event.pointerId);
    } finally {
      target.releasePointerCapture(event.pointerId);
    }
  });

  // The capture went without an up or cancel (the element was moved or taken): the drag ends as a cancel.
  const onLost = guard((event) => {
    drag.pointerCancel(event.pointerId);
  });

  const listeners: [PointerType, (event: PointerEventLike) => void][] = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onCancel],
    ['lostpointercapture', onLost],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener);

  return (): void => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener);
  };
}
