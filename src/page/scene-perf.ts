// XMAS-33 "The ?perf readout", the scene's side: with the hidden ?perf option
// the scene loads the readout's file by its URL and gives the frame loop an
// observer up front. The loop cannot wait for the file, so the observer keeps
// what it hears and replays it to the readout once the file has arrived, then
// forwards live. The scene's version.ts is bundled here, never into the
// readout's file, so the readout is handed a getter that reads it.
import type { TraceSecond } from './frame-trace.ts';
import type { LoopObserver } from './loop-observer.ts';
import { currentVersion, type VersionName } from './version.ts';

/** What the readout's file exports. */
export interface ReadoutModule {
  startReadout(opts: { version: () => VersionName; draws?: () => TraceSecond | null }): LoopObserver;
}

export interface ReadoutLink {
  /** The observer for the frame loop; it keeps what it hears until the readout has loaded. */
  observer: LoopObserver;
  /**
   * Imports the readout's file once; any failure leaves the scene as it is, silently. `draws` is the frame trace's second so far
   * (XMAS-113), handed to the readout as it loads.
   */
  load(url: string, draws?: () => TraceSecond | null): void;
}

/** How many of the latest frames are kept while the file loads. */
const KEPT_FRAMES = 600;

type Heard = { kind: 'frame'; time: number; workMs: number; layerMs: number } | { kind: 'pause' } | { kind: 'resume' };
type Frame = Extract<Heard, { kind: 'frame' }>;

export function readoutLink(importFile: (url: string) => Promise<ReadoutModule> = (url) => import(/* @vite-ignore */ url)): ReadoutLink {
  let watch: LoopObserver | undefined;
  let kept: Heard[] | undefined = []; // undefined once the file has arrived or failed
  let frameCount = 0; // frames in kept
  let started = false;
  // The largest gap between two frames that fell out of kept, as that pair of frames.
  let worst: { from: Frame; to: Frame } | undefined;
  let lastDropped: Frame | undefined; // the newest dropped frame with no pause since

  /** Drops the oldest heard event, remembering the largest gap it ends. */
  function dropOldest(list: Heard[]): void {
    const old = list.shift();
    if (old === undefined) return;
    if (old.kind !== 'frame') {
      lastDropped = undefined;
      return;
    }
    frameCount--;
    if (lastDropped !== undefined && old.time - lastDropped.time > (worst ? worst.to.time - worst.from.time : 0)) {
      worst = { from: lastDropped, to: old };
    }
    lastDropped = old;
  }

  function keep(event: Heard): void {
    if (kept === undefined) return;
    kept.push(event);
    if (event.kind === 'frame') frameCount++;
    while (frameCount > KEPT_FRAMES) dropOldest(kept);
  }

  /** What to replay, in order: the largest dropped gap, set apart by a pause so no bigger gap appears. */
  function replay(list: Heard[]): Heard[] {
    const first = list.find((e): e is Frame => e.kind === 'frame');
    const beforeFirst = list[0]?.kind === 'frame' ? lastDropped : undefined; // a dropped frame right before the first kept one
    if (beforeFirst !== undefined && first !== undefined && first.time - beforeFirst.time > (worst ? worst.to.time - worst.from.time : 0)) {
      return [beforeFirst, ...list];
    }
    return worst === undefined ? list : [worst.from, worst.to, { kind: 'pause' }, ...list];
  }

  const link: ReadoutLink = {
    observer: {
      frame(time, workMs, layerMs = 0) {
        if (watch !== undefined) watch.frame(time, workMs, layerMs);
        else keep({ kind: 'frame', time, workMs, layerMs });
      },
      pause() {
        if (watch !== undefined) watch.pause();
        else keep({ kind: 'pause' });
      },
      resume() {
        if (watch !== undefined) watch.resume();
        else keep({ kind: 'resume' });
      },
    },
    load(url, draws) {
      if (started) return;
      started = true;
      importFile(url)
        .then((readout) => {
          const observer = readout.startReadout({ version: () => currentVersion(), draws });
          const heard = replay(kept ?? []);
          kept = undefined;
          for (const event of heard) {
            if (event.kind === 'frame') observer.frame(event.time, event.workMs, event.layerMs);
            else if (event.kind === 'pause') observer.pause();
            else observer.resume();
          }
          watch = observer;
        })
        .catch(() => {
          // The readout is optional: a missing or broken file changes nothing on screen.
          kept = undefined;
        });
    },
  };
  return link;
}
