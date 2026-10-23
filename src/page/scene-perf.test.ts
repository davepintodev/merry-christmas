// XMAS-33 "The ?perf readout": without `?perf` the scene page hands the frame
// loop no observer, so nothing is timed and the readout's file is never
// asked for. The page file runs on import; the browser bits it touches are
// stand-ins and the loop is captured instead of run.
//
// The scene's side of the link (readoutLink in scene-perf.ts) hands the
// readout file the scene's version getter when it starts it, since the two
// files are separate bundles and cannot share version.ts. Frames drawn
// before the file arrives are kept (bounded, but never losing the worst gap)
// and replayed in order, so the worst frame since globe-ready is complete.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopObserver } from './loop-observer.ts';
import { createPerfStats } from './perf-stats.ts';
import { readoutLink } from './scene-perf.ts';
import { setVersionSource, type VersionName } from './version.ts';

const captured = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock('./loop.ts', () => ({
  runSceneLoop: (...args: unknown[]) => {
    captured.calls.push(args);
    return { stop: () => undefined };
  },
}));

let created: string[] = [];

beforeEach(() => {
  captured.calls = [];
  created = [];
  vi.resetModules();
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => ({ putImageData: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
  });
  vi.stubGlobal('document', {
    // The scene canvas alone: no pause button in this markup (XMAS-45b).
    querySelector: (selector: string) => (selector === 'canvas#scene' ? canvas : null),
    hidden: false,
    addEventListener: () => undefined,
    createElement: (tag: string) => {
      created.push(`createElement:${tag}`);
      return {};
    },
  });
  vi.stubGlobal('ImageData', class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  setVersionSource(() => 'full scene');
});

describe('the scene page without ?perf', () => {
  it.each(['', '?now=2026-12-01T22:00:00', '?perfect', '?xperf=1'])('starts the loop with no observer for %j', async (search) => {
    vi.stubGlobal('location', { search });
    await import('./scene.ts');
    expect(captured.calls).toHaveLength(1);
    const args = captured.calls[0] ?? [];
    expect(args[2], 'a third argument (observer) was passed').toBeUndefined();
    expect(created).toEqual([]);
  });
});

/** What the readout file exports: started once with the scene's version getter, it returns its observer. */
type ReadoutModule = { startReadout(opts: { version: () => VersionName }): LoopObserver };

/** A readout file whose import resolves or fails when the test says, recording every call it hears. */
function fakeFile() {
  const calls: string[] = [];
  const started: { version: () => VersionName }[] = [];
  const stats = createPerfStats({ version: () => 'full scene' });
  stats.setGlobeReady(0);
  let resolve: (m: ReadoutModule) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const loaded = new Promise<ReadoutModule>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The base promise is the test's own; only a rejection the link leaves unhandled should surface.
  loaded.catch(() => undefined);
  const module: ReadoutModule = {
    startReadout(opts) {
      started.push(opts);
      return {
        frame(time, workMs) {
          calls.push(`frame:${time}:${workMs}`);
          stats.frame(time, workMs);
        },
        pause() {
          calls.push('pause');
          stats.pause();
        },
        resume() {
          calls.push('resume');
          stats.resume();
        },
      };
    },
  };
  const urls: string[] = [];
  const importFile = (url: string): Promise<ReadoutModule> => {
    urls.push(url);
    return loaded;
  };
  return { calls, started, stats, urls, importFile, arrive: () => resolve(module), fail: (e: unknown) => reject(e) };
}

/** Lets pending promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('readoutLink: the version crosses to the readout file', () => {
  it('starts the readout with a getter that reads the scene\'s version seam', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    link.load('/assets/perf-abc.js');
    file.arrive();
    await settle();
    expect(file.urls).toEqual(['/assets/perf-abc.js']);
    expect(file.started).toHaveLength(1);
    const version = file.started[0]!.version;
    expect(version()).toBe('full scene');
    setVersionSource(() => 'lighter version');
    expect(version()).toBe('lighter version');
    setVersionSource(() => 'every second frame');
    expect(version()).toBe('every second frame');
  });

  it('a version set before the file arrives is what the readout reads', async () => {
    setVersionSource(() => 'lighter version');
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    link.load('/assets/perf-abc.js');
    file.arrive();
    await settle();
    expect(file.started[0]?.version()).toBe('lighter version');
  });

  it('imports the file once, however often load is called', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    link.load('/assets/perf-abc.js');
    link.load('/assets/perf-abc.js');
    file.arrive();
    await settle();
    expect(file.urls).toHaveLength(1);
    expect(file.started).toHaveLength(1);
  });
});

describe('readoutLink: frames before the file arrives', () => {
  it('replays frames, pauses and resumes heard before the load, in order, then forwards live ones after them', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    link.observer.frame(0, 4);
    link.observer.frame(16, 5);
    link.observer.pause();
    link.observer.resume();
    link.load('/assets/perf-abc.js');
    link.observer.frame(5000, 6);
    link.observer.frame(5016, 7);
    expect(file.calls).toEqual([]);
    file.arrive();
    await settle();
    link.observer.frame(5032, 8);
    expect(file.calls).toEqual(['frame:0:4', 'frame:16:5', 'pause', 'resume', 'frame:5000:6', 'frame:5016:7', 'frame:5032:8']);
  });

  it('a hitch before the file arrives is the readout\'s worst frame', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    let t = 0;
    link.observer.frame(t, 2);
    for (let i = 0; i < 10; i++) link.observer.frame((t += 16), 2);
    link.observer.frame((t += 120), 2); // the first hitch, while the readout is still downloading
    for (let i = 0; i < 10; i++) link.observer.frame((t += 16), 2);
    link.load('/assets/perf-abc.js');
    file.arrive();
    await settle();
    for (let i = 0; i < 10; i++) link.observer.frame((t += 16), 2);
    expect(file.stats.snapshot(t).worstFrameMs).toBe(120);
  });

  it('keeps at most the last 600 frames, in order, ending with the newest', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    for (let i = 0; i < 5000; i++) link.observer.frame(i * 16, 1);
    link.load('/assets/perf-abc.js');
    file.arrive();
    await settle();
    const times = file.calls.filter((c) => c.startsWith('frame:')).map((c) => Number(c.split(':')[1]));
    expect(times.length).toBeGreaterThanOrEqual(600);
    expect(times.length).toBeLessThanOrEqual(602);
    expect(times[times.length - 1]).toBe(4999 * 16);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    expect(file.stats.snapshot(4999 * 16).worstFrameMs).toBe(16);
  });

  it('keeps the worst gap even when it falls out of the last 600 frames, and invents no bigger one', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    let t = 0;
    link.observer.frame(t, 1);
    for (let i = 0; i < 50; i++) link.observer.frame((t += 16), 1);
    link.observer.frame((t += 120), 1); // the hitch, then far more than 600 smooth frames
    for (let i = 0; i < 3000; i++) link.observer.frame((t += 16), 1);
    link.load('/assets/perf-abc.js');
    file.arrive();
    await settle();
    expect(file.stats.snapshot(t).worstFrameMs).toBe(120);
    const frames = file.calls.filter((c) => c.startsWith('frame:'));
    expect(frames.length).toBeLessThanOrEqual(602);
    expect(frames[frames.length - 1]).toBe(`frame:${t}:1`);
  });

  it('a failed load drops what was kept, silently, and the observer stays harmless', async () => {
    const file = fakeFile();
    const link = readoutLink(file.importFile);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      for (let i = 0; i < 100; i++) link.observer.frame(i * 16, 1);
      link.load('/assets/perf-abc.js');
      file.fail(new Error('network down'));
      await settle();
      expect(() => {
        for (let i = 100; i < 5000; i++) link.observer.frame(i * 16, 1);
        link.observer.pause();
        link.observer.resume();
      }).not.toThrow();
      await settle();
      expect(unhandled).toEqual([]);
      expect(file.calls).toEqual([]);
      expect(file.started).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
