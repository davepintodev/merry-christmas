// XMAS-70: what a leaning glass shows where it has left the upright glass. The
// backdrop is never drawn inside the upright glass, so for a lean the picture
// is copied and the backdrop painted there too; keepBackdrop (lean.ts) keeps
// that copy for the glass to uncover.
import type { PhaseName } from '../shared/clock.ts';
import { makeBackdrop, paintBackdrop, type Backdrop } from './backdrop.ts';
import type { SceneLayout } from './frame.ts';

let open: { layout: SceneLayout; backdrop: Backdrop } | undefined;

/** The backdrop for a layout with no clip at the glass; the last one is kept. */
function openBackdropFor(layout: SceneLayout): Backdrop {
  if (open?.layout !== layout) open = { layout, backdrop: makeBackdrop(layout, false) };
  return open.backdrop;
}

/** A copy of `picture` with the whole backdrop painted over it, in the colours of the phase reading. */
export function pictureWithOpenBackdrop(picture: Uint32Array, layout: SceneLayout, from: PhaseName, to: PhaseName, share: number): Uint32Array {
  const copy = picture.slice();
  paintBackdrop(copy, openBackdropFor(layout), from, to, share);
  return copy;
}
