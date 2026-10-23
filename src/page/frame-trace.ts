// XMAS-102 phase 1: the ?perf reporter's per-second split of a frame's cost.
// Each drawn frame adds what the fine layer reported (per-layer ms, draws, canvas
// sizes) and its work; the sim steps run since the last frame belong to it, and
// the gap to the frame before. take() hands over one second and starts the next,
// keeping the last frame's time so the gap spans the boundary.

/** The draw's canvas calls in one frame, over the whole draw: milliseconds and calls for each kind (XMAS-113). */
export interface CanvasCalls {
  /** save() and restore() together. */
  saveMs: number;
  /** Building the clip and shadow paths (beginPath, moveTo, lineTo, closePath). */
  pathMs: number;
  /** clip(), each one a ring of a face's clip or the floor disc. */
  clipMs: number;
  drawImageMs: number;
  setTransformMs: number;
  /** fillRect, each one a snow square (XMAS-113). */
  fillRectMs: number;
  saves: number;
  restores: number;
  clips: number;
  drawImages: number;
  setTransforms: number;
  fillRects: number;
  /** Clip and shadow paths built: one for each beginPath (XMAS-113). */
  paths: number;
}

/** What a frame's draw made no canvas calls for: all zero. */
export function blankCanvasCalls(): CanvasCalls {
  return {
    saveMs: 0, pathMs: 0, clipMs: 0, drawImageMs: 0, setTransformMs: 0, fillRectMs: 0,
    saves: 0, restores: 0, clips: 0, drawImages: 0, setTransforms: 0, fillRects: 0, paths: 0,
  };
}

/** What the fine layer did in one frame; its draw fills it when given one (fine-layer.ts). */
export interface FineTrace {
  /** Milliseconds spent on each part of the draw: the glass, the flakes behind, the shapes, the flakes in front and the base. */
  glassMs: number;
  behindMs: number;
  shapesMs: number;
  frontMs: number;
  baseMs: number;
  /** The whole draw in ms, from its first line to its last (XMAS-113 phase 2). */
  totalMs: number;
  /** The draw's start up to the glass: the bodies and face list, the layers, Santa's sprite and the box (XMAS-113 phase 2). */
  inputsMs: number;
  /** The shapes' shadows, in the whole redraw and in the halves; inside shapesMs (XMAS-113 phase 2). */
  shadowsMs: number;
  /** The shapes' faces, Santa included where he is drawn among them; inside shapesMs (XMAS-113 phase 2). */
  facesMs: number;
  /** The rest of the shapes: clears, the halves and Santa drawn between them; shapesMs less shadowsMs and facesMs (XMAS-113 phase 2). */
  shapesRestMs: number;
  /** drawImage calls made on the shapes canvas this frame (faces, their edges and Santa); 0 when that canvas was not redrawn. */
  shapesCalls: number;
  /** Snow steps, after the lean, drawn into the flakes-behind layer and the flakes-in-front layer this frame. */
  behindFlakes: number;
  frontFlakes: number;
  shapesRedrawn: boolean;
  /** The glass bitmap was rewritten this frame. */
  glassPainted: boolean;
  baseBuilt: boolean;
  /** Milliseconds spent painting Santa this frame (XMAS-107). */
  santaMs: number;
  /** Santa's paints this frame: 1 when his box held pixels and was painted, else 0. */
  santaPaints: number;
  /** 1 when his paint repeated the last one exactly (same box, same pixel words), else 0. */
  santaSame: number;
  /** Milliseconds spent clipping the faces this frame, in the shapes redraw (XMAS-108). */
  shapesClipMs: number;
  /** Milliseconds spent drawing the faces and their stretched edges this frame, in the shapes redraw (XMAS-108). */
  shapesDrawMs: number;
  /** 1 when the shapes were redrawn with the turn, scale, lean, offset and size of the last redraw, so only Santa or the wipe after him asked for it (XMAS-108), else 0. */
  shapesSameInputs: number;
  /** The draw's canvas calls: their time and count, over the whole draw (XMAS-113). Only a traced draw makes them. */
  canvas?: CanvasCalls;
  /** The box canvas's size in device pixels. */
  width: number;
  height: number;
  /** The base canvas's size in device pixels. */
  baseWidth: number;
  baseHeight: number;
}

/** What a frame with nothing drawn by the fine layer reports: all zero, all false. */
export function blankFineTrace(): FineTrace {
  return {
    glassMs: 0, behindMs: 0, shapesMs: 0, frontMs: 0, baseMs: 0, shapesCalls: 0, behindFlakes: 0, frontFlakes: 0,
    shapesRedrawn: false, glassPainted: false, baseBuilt: false, santaMs: 0, santaPaints: 0, santaSame: 0,
    shapesClipMs: 0, shapesDrawMs: 0, shapesSameInputs: 0, totalMs: 0, inputsMs: 0, shadowsMs: 0, facesMs: 0, shapesRestMs: 0,
    canvas: blankCanvasCalls(), width: 0, height: 0, baseWidth: 0, baseHeight: 0,
  };
}

/** Frames a second needs before peek shows it rather than the last one taken, so its figures do not jump (XMAS-113). */
const READABLE_FRAMES = 10;

/** The sum and the largest value of a per-frame number over one second. */
export interface Spread {
  sum: number;
  max: number;
}

/** A count of events over one second and the longest of them, in ms. */
export interface LongWork {
  count: number;
  max: number;
}

/** One second of frames, as take() hands it over. */
export interface TraceSecond {
  frames: number;
  steps: number;
  maxStepsPerFrame: number;
  /** The largest gap between two frames, in ms; a hidden tab shows as one large gap. */
  maxGapMs: number;
  /** The whole animation callback per call, in ms: its steps and its draw (XMAS-110). */
  callbackMs: Spread;
  /** The time from one callback's end to the next one's start, in ms; none for the first callback of the run (XMAS-110). */
  outsideMs: Spread;
  /** Long tasks and long animation frames the browser reported, with the longest of each (XMAS-110). */
  longTasks: LongWork;
  longFrames: LongWork;
  /** Heap readings lower than the one before, summed over the second: a garbage collection shows as one (XMAS-110). */
  heapDrops: number;
  workMs: Spread;
  glassMs: Spread;
  behindMs: Spread;
  shapesMs: Spread;
  frontMs: Spread;
  baseMs: Spread;
  /** The fine layer's phases per frame, in ms (XMAS-113 phase 2). otherMs is the whole draw less the sections above: the remainder, so nothing hides. */
  totalMs: Spread;
  inputsMs: Spread;
  shadowsMs: Spread;
  facesMs: Spread;
  shapesRestMs: Spread;
  otherMs: Spread;
  /** Santa's paint time per frame (XMAS-107). */
  santaMs: Spread;
  /** The face clipping and the face drawing time per frame, in the shapes redraw (XMAS-108). */
  shapesClipMs: Spread;
  shapesDrawMs: Spread;
  shapesRedraws: number;
  /** drawImage calls on the shapes canvas, summed over the second. */
  shapesCalls: number;
  /** Shapes redraws that repeated the last one's inputs, summed over the second (XMAS-108). */
  shapesSameInputs: number;
  /** The draw's canvas calls per frame in ms (XMAS-113), each kind's spread over the frames; the counts are summed over the second. */
  saveMs: Spread;
  pathMs: Spread;
  clipMs: Spread;
  drawImageMs: Spread;
  setTransformMs: Spread;
  fillRectMs: Spread;
  saves: number;
  restores: number;
  clips: number;
  drawImages: number;
  setTransforms: number;
  fillRects: number;
  paths: number;
  behindFlakes: number;
  frontFlakes: number;
  glassPaints: number;
  baseBuilds: number;
  /** Santa's paints and the repeats among them, summed over the second. */
  santaPaints: number;
  santaSame: number;
  /** The box canvas and base canvas sizes in device pixels, as the last frame had them; 0 when it drew no fine layer. */
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
}

export interface FrameTrace {
  /** A sim step ran; it belongs to the next frame drawn. */
  step(): void;
  /** A frame was drawn: its fine layer (null when it drew none), its own work in ms, and its time in ms. */
  frame(fine: FineTrace | null, workMs: number, time: number): void;
  /** The second so far, or null when no frame was drawn since the last take; the next second starts clean. */
  take(): TraceSecond | null;
  /**
   * The second so far as take() would hand it over, or null when no frame was drawn; nothing is reset (XMAS-113, for the readout).
   * With fewer than READABLE_FRAMES frames it is the last second take() handed over, when there was one.
   */
  peek(): TraceSecond | null;
  /** An animation callback ran from startMs to endMs on the host clock, steps and draw both (XMAS-110). */
  callback(startMs: number, endMs: number): void;
  /** The browser reported a long task ('task') or a long animation frame ('frame') of this many ms (XMAS-110). */
  longTask(kind: 'task' | 'frame', durationMs: number): void;
  /** The JS heap in use, in bytes, at this reading (XMAS-110). */
  heap(usedBytes: number): void;
}

function emptySecond(): TraceSecond {
  return {
    frames: 0, steps: 0, maxStepsPerFrame: 0, maxGapMs: 0,
    callbackMs: spread(), outsideMs: spread(), longTasks: { count: 0, max: 0 }, longFrames: { count: 0, max: 0 }, heapDrops: 0,
    workMs: spread(), glassMs: spread(), behindMs: spread(), shapesMs: spread(), frontMs: spread(), baseMs: spread(),
    totalMs: spread(), inputsMs: spread(), shadowsMs: spread(), facesMs: spread(), shapesRestMs: spread(), otherMs: spread(),
    santaMs: spread(), shapesClipMs: spread(), shapesDrawMs: spread(), shapesRedraws: 0, shapesCalls: 0, shapesSameInputs: 0,
    saveMs: spread(), pathMs: spread(), clipMs: spread(), drawImageMs: spread(), setTransformMs: spread(), fillRectMs: spread(),
    saves: 0, restores: 0, clips: 0, drawImages: 0, setTransforms: 0, fillRects: 0, paths: 0,
    behindFlakes: 0, frontFlakes: 0, glassPaints: 0, baseBuilds: 0, santaPaints: 0, santaSame: 0, width: 0, height: 0, baseWidth: 0, baseHeight: 0,
  };
}

function spread(): Spread {
  return { sum: 0, max: 0 };
}

/** Adds one frame's value to a spread: its sum grows and its max keeps the largest. */
function add(into: Spread, value: number): void {
  into.sum += value;
  into.max = Math.max(into.max, value);
}

export function createFrameTrace(now: () => number): FrameTrace {
  let second = emptySecond();
  /** The last second take() handed over; peek shows it while the second so far is too young to read (XMAS-113). */
  let previous: TraceSecond | null = null;
  /** Sim steps run since the last frame; the next frame drawn takes them. */
  let pending = 0;
  /** The last frame's time, kept across takes so the gap spans the boundary. */
  let last: number | null = null;
  /** The last callback's end and the last heap reading, kept across takes like `last` (XMAS-110). */
  let lastCallbackEnd: number | null = null;
  let lastHeap: number | null = null;

  return {
    step() {
      pending += 1;
    },
    callback(startMs, endMs) {
      const s = second;
      add(s.callbackMs, endMs - startMs);
      if (lastCallbackEnd !== null) add(s.outsideMs, startMs - lastCallbackEnd);
      lastCallbackEnd = endMs;
    },
    longTask(kind, durationMs) {
      const tally = kind === 'task' ? second.longTasks : second.longFrames;
      tally.count += 1;
      tally.max = Math.max(tally.max, durationMs);
    },
    heap(usedBytes) {
      if (lastHeap !== null && usedBytes < lastHeap) second.heapDrops += 1;
      lastHeap = usedBytes;
    },
    frame(fine, workMs, time) {
      const s = second;
      const f = fine ?? blankFineTrace();
      s.frames += 1;
      s.steps += pending;
      s.maxStepsPerFrame = Math.max(s.maxStepsPerFrame, pending);
      pending = 0;
      if (last !== null) s.maxGapMs = Math.max(s.maxGapMs, time - last);
      last = time;
      add(s.workMs, workMs);
      add(s.glassMs, f.glassMs);
      add(s.behindMs, f.behindMs);
      add(s.shapesMs, f.shapesMs);
      add(s.frontMs, f.frontMs);
      add(s.baseMs, f.baseMs);
      add(s.totalMs, f.totalMs);
      add(s.inputsMs, f.inputsMs);
      add(s.shadowsMs, f.shadowsMs);
      add(s.facesMs, f.facesMs);
      add(s.shapesRestMs, f.shapesRestMs);
      add(s.otherMs, f.totalMs - (f.inputsMs + f.glassMs + f.behindMs + f.shapesMs + f.frontMs + f.baseMs));
      add(s.santaMs, f.santaMs);
      add(s.shapesClipMs, f.shapesClipMs);
      add(s.shapesDrawMs, f.shapesDrawMs);
      if (f.shapesRedrawn) s.shapesRedraws += 1;
      s.shapesCalls += f.shapesCalls;
      s.shapesSameInputs += f.shapesSameInputs;
      const c = f.canvas ?? blankCanvasCalls();
      add(s.saveMs, c.saveMs);
      add(s.pathMs, c.pathMs);
      add(s.clipMs, c.clipMs);
      add(s.drawImageMs, c.drawImageMs);
      add(s.setTransformMs, c.setTransformMs);
      add(s.fillRectMs, c.fillRectMs);
      s.saves += c.saves;
      s.restores += c.restores;
      s.clips += c.clips;
      s.drawImages += c.drawImages;
      s.setTransforms += c.setTransforms;
      s.fillRects += c.fillRects;
      s.paths += c.paths;
      s.behindFlakes += f.behindFlakes;
      s.frontFlakes += f.frontFlakes;
      if (f.glassPainted) s.glassPaints += 1;
      if (f.baseBuilt) s.baseBuilds += 1;
      s.santaPaints += f.santaPaints;
      s.santaSame += f.santaSame;
      s.width = f.width;
      s.height = f.height;
      s.baseWidth = f.baseWidth;
      s.baseHeight = f.baseHeight;
    },
    take() {
      if (second.frames === 0) return null;
      const out = second;
      second = emptySecond();
      previous = out;
      return out;
    },
    peek() {
      if (second.frames === 0) return null;
      return second.frames < READABLE_FRAMES && previous !== null ? previous : second;
    },
  };
}
