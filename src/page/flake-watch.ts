// XMAS-104: the ?perf flake watch, a rolling take of a few tracked flakes frame by frame.
// Each drawn frame adds a row: its time, fraction, turn and pointer, the sim steps run since
// the last frame, and the position of ten globe flakes and twelve outside flakes. take() hands
// over the rows and starts clean, keeping the newest 120. No clock and no randomness: the same
// frames give the same rows.

/** The snow flakes a frame draws: the globe's (snow.ts) and the outside snow's (outside-snow.ts). */
export interface WatchInput {
  /** The frame's start in ms, as the trace reads it. */
  time: number;
  /** The shown fraction of the sim step the frame is blended at. */
  fraction: number;
  /** The scene's time in ms that the frame draws at (Santa's clock). */
  sceneTimeMs: number;
  turn: number;
  turnStep: number;
  /** A pointer is down on the globe. */
  down: boolean;
  globe: readonly { x: number; y: number; z: number; resting: boolean }[];
  /** Absent outside snow is an empty array. */
  outside: readonly { x: number; y: number; d: number }[];
  /** The draw steps of the flakes in front of the glass centre, and behind it, for this frame. */
  front?: readonly { x: number; y: number; depth: number }[];
  behind?: readonly { x: number; y: number; depth: number }[];
}

/** One drawn frame. g and o hold the tracked flakes in the order of meta's indices. */
export interface WatchRow {
  t: number;
  /** Sim steps run since the previous frame. */
  steps: number;
  f: number;
  st: number;
  turn: number;
  ts: number;
  down: boolean;
  /** x, y, z and resting (1 or 0) of each tracked globe flake. */
  g: number[];
  /** x and y of each tracked outside flake. */
  o: number[];
  /** x, y and depth of each front draw step, the first 120 only. Written only when the input has front. */
  fr?: number[];
  /** x, y and depth of each behind draw step, the first 120 only. Written only when the input has behind. */
  bh?: number[];
}

export interface WatchTake {
  meta: {
    /** Indices of the tracked globe flakes. */
    globeIdx: number[];
    /** Indices of the tracked outside flakes: sparkle, then tumble, then plain. */
    outsideIdx: number[];
    /** Depth of each tracked outside flake. */
    outsideD: number[];
  };
  rows: WatchRow[];
}

export interface FlakeWatch {
  /** A sim step ran; it belongs to the next frame drawn. */
  step(): void;
  /** A frame was drawn: its row. */
  frame(input: WatchInput): void;
  /** The meta and the rows so far; the rows start clean after it. */
  take(): WatchTake;
}

const GLOBE_TRACKED = 10;
const OUTSIDE_PER_BAND = 4;
const ROWS_KEPT = 120;
const STEPS_KEPT = 120;
const SPARKLE_FROM = 0.93;
const TUMBLE_FROM = 2 / 3;

function round(v: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(v * scale) / scale;
}

/** Ten globe flakes spread evenly by index, or all of them when there are fewer. */
function globePicks(n: number): number[] {
  const count = Math.min(GLOBE_TRACKED, n);
  return Array.from({ length: count }, (_, i) => Math.floor((i * n) / count));
}

/** x, y and depth of the first steps, flattened, rounded to 1 decimal. */
function stepRows(steps: NonNullable<WatchInput['front']>): number[] {
  const out: number[] = [];
  for (const s of steps.slice(0, STEPS_KEPT)) out.push(round(s.x, 1), round(s.y, 1), round(s.depth, 1));
  return out;
}

/** The band a flake's depth puts it in: 0 sparkle, 1 tumble, 2 plain. */
function bandOf(d: number): number {
  if (d > SPARKLE_FROM) return 0;
  return d > TUMBLE_FROM ? 1 : 2;
}

/** The first few flakes of each band by index, sparkle first, then tumble, then plain. */
function outsidePicks(outside: WatchInput['outside']): number[] {
  const picks: number[] = [];
  for (let band = 0; band < 3; band++) {
    let taken = 0;
    for (let i = 0; i < outside.length && taken < OUTSIDE_PER_BAND; i++) {
      if (bandOf(outside[i]!.d) !== band) continue;
      picks.push(i);
      taken += 1;
    }
  }
  return picks;
}

export function createFlakeWatch(): FlakeWatch {
  let rows: WatchRow[] = [];
  /** Sim steps run since the last frame; the next frame's row takes them. */
  let pending = 0;
  let globeIdx: number[] = [];
  let outsideIdx: number[] = [];
  let outsideD: number[] = [];
  /** The outside array the picks were made from, and its length then: the snow resizes its one array in place. */
  let pickedFrom: WatchInput['outside'] | null = null;
  let pickedLength = -1;

  return {
    step() {
      pending += 1;
    },
    frame(input) {
      globeIdx = globePicks(input.globe.length);
      if (input.outside !== pickedFrom || input.outside.length !== pickedLength) {
        pickedFrom = input.outside;
        pickedLength = input.outside.length;
        outsideIdx = outsidePicks(input.outside);
        outsideD = outsideIdx.map((i) => input.outside[i]!.d);
      }
      const g: number[] = [];
      for (const i of globeIdx) {
        const f = input.globe[i]!;
        g.push(round(f.x, 2), round(f.y, 2), round(f.z, 2), f.resting ? 1 : 0);
      }
      const o: number[] = [];
      for (const i of outsideIdx) {
        const f = input.outside[i]!;
        o.push(round(f.x, 2), round(f.y, 2));
      }
      rows.push({
        t: input.time,
        steps: pending,
        f: round(input.fraction, 3),
        st: input.sceneTimeMs,
        turn: round(input.turn, 3),
        ts: round(input.turnStep, 3),
        down: input.down,
        g,
        o,
        ...(input.front && { fr: stepRows(input.front) }),
        ...(input.behind && { bh: stepRows(input.behind) }),
      });
      pending = 0;
      if (rows.length > ROWS_KEPT) rows.shift();
    },
    take() {
      const out = { meta: { globeIdx, outsideIdx, outsideD }, rows };
      rows = [];
      return out;
    },
  };
}
