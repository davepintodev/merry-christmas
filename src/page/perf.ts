// XMAS-33 "The ?perf readout": the readout's own file, the third built file
// (assets/perf-<hash>.js), fetched only with the hidden ?perf option. It is an
// ES module: the scene calls its startReadout() once, which shows the readout
// and returns the observer the scene's frame loop reports to. The launch marks come from the performance
// timeline; the stats and the readout are this file's alone.
import type { LoopObserver } from './loop-observer.ts';
import { mountReadout } from './perf-readout.ts';
import { createPerfStats } from './perf-stats.ts';
import type { VersionName } from './version.ts';

/** How often the readout's text is set. */
const REFRESH_MS = 500;

/** The start time of the first performance mark with this name, or null while it is missing. */
function markTime(name: string): number | null {
  return performance.getEntriesByName(name, 'mark')[0]?.startTime ?? null;
}

/** Shows the readout; `version` is the scene's getter, since this file cannot share the scene's version.ts. */
export function startReadout({ version }: { version: () => VersionName }): LoopObserver {
  const stats = createPerfStats({ version });
  // The fine layer's share of the same frames: its workMs is the layer's average. Its own stats, fed the same
  // frames and restarts, so its window is the scene draw's window.
  const layer = createPerfStats({ version });
  let globeKnown = false;

  /** Feeds the two launch marks to the stats as soon as they exist. */
  function readMarks(): void {
    const visible = markTime('countdown-visible');
    if (visible !== null) stats.setCountdownVisible(visible);
    const ready = markTime('globe-ready');
    if (ready !== null) {
      stats.setGlobeReady(ready);
      layer.setGlobeReady(ready);
      globeKnown = true;
    }
  }

  const readout = mountReadout(() => {
    const now = performance.now();
    stats.restartWindow(now);
    layer.restartWindow(now);
  });

  function refresh(): void {
    readMarks();
    const now = performance.now();
    readout.show(stats.snapshot(now), layer.snapshot(now).workMs);
  }

  refresh();
  setInterval(refresh, REFRESH_MS);

  return {
    frame(time, workMs, layerMs = 0) {
      if (!globeKnown) readMarks(); // the globe mark can land after this file has loaded
      stats.frame(time, workMs);
      layer.frame(time, layerMs);
    },
    pause() {
      stats.pause();
      layer.pause();
    },
    resume() {
      stats.resume();
      layer.resume();
    },
  };
}
