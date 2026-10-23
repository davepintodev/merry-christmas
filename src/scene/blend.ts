// XMAS-32a "The globe", slice 1: in-between shades for sub-art-pixel motion.
// blendShade mixes two 0xRRGGBB colours by a coverage share; edgeCoverage
// gives how much of one art-pixel column lies left of an edge at a fractional
// x, so a sliding edge is drawn as an in-between shade on the grid instead of
// jumping whole pixels.

/** The 0xRRGGBB shade `coverage` (0..1, clamped) of the way from `under` to `over`. */
export function blendShade(under: number, over: number, coverage: number): number {
  // A NaN coverage counts as none of the over shade, like a NaN phase share.
  const share = Number.isNaN(coverage) ? 0 : Math.min(1, Math.max(0, coverage));
  if (share <= 0) return under;
  if (share >= 1) return over;
  const channel = (shift: number): number => {
    const a = (under >> shift) & 0xff;
    const b = (over >> shift) & 0xff;
    return Math.round(a + (b - a) * share);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** The share (0..1) of art-pixel column `column` (spanning column..column + 1) that lies left of an edge at fractional x `edge`. */
export function edgeCoverage(edge: number, column: number): number {
  const share = edge - column;
  if (Number.isNaN(share)) return 0;
  return Math.min(1, Math.max(0, share));
}
