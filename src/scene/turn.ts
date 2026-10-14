// XMAS-32d "The globe", slice 4: the globe's slow automatic turn.

/** The globe turns once in this many seconds. */
const TURN_SECONDS = 60;
/** Where the turn starts, in radians, so the house is not square on at time 0. */
const START_TURN = 0.5;

/** The globe's turn angle in radians at `timeMs` of scene time; it grows without wrapping. */
export function autoTurn(timeMs: number): number {
  return START_TURN + (timeMs / 1000) * ((2 * Math.PI) / TURN_SECONDS);
}
