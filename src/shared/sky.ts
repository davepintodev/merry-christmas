// The countdown's top margin, shared by the page (countdown/main.ts places the
// canvas) and the scene (scene/frame.ts reserves the strip), so they cannot drift.

/** The blank sky above the countdown's first inked row, in art pixels: enough to show a gap below the window's top edge. */
export const SKY_ABOVE = 2;

/** More blank sky above the countdown where its digits are smaller than the strip the scene reserves for the largest (the phone), in art pixels. */
export const PHONE_EXTRA_SKY = 5;
