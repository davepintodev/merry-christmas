// XMAS-27 "Countdown on a plain sky", part A: each art pixel is a whole
// number of physical screen pixels, as large as fits the viewport.
export function fitScale(
  frame: { width: number; height: number },
  viewport: { width: number; height: number },
  dpr: number,
): number {
  const across = (viewport.width * dpr) / frame.width;
  const down = (viewport.height * dpr) / frame.height;
  return Math.max(1, Math.floor(Math.min(across, down)));
}
