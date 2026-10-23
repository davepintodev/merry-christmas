// XMAS-33 "The ?perf readout": the frame loop's optional observer. With an
// observer, each drawn frame reports its rAF time and how long scene.draw()
// alone took (on the host's now()), and a hidden tab pauses and resumes it.
// Without one, the loop makes no timing call at all, so the readout costs
// nothing when `?perf` is absent.
import { describe, expect, it } from 'vitest';
import { runSceneLoop, type LoopHost, type LoopScene } from './loop.ts';

type Observer = { frame(time: number, workMs: number): void; pause(): void; resume(): void };

/** A fake page whose clock moves only when the test (or the fake scene) moves it. */
class FakeHost implements LoopHost {
  private next = 1;
  readonly pending = new Map<number, (time: number) => void>();
  readonly listeners: (() => void)[] = [];
  readonly marks: string[] = [];
  isHidden = false;
  clock = 0;
  nowCalls = 0;

  constructor(private readonly log: string[]) {}

  requestFrame(callback: (time: number) => void): number {
    const id = this.next++;
    this.pending.set(id, callback);
    return id;
  }
  cancelFrame(handle: number): void {
    this.pending.delete(handle);
  }
  hidden(): boolean {
    return this.isHidden;
  }
  onVisibilityChange(listener: () => void): void {
    this.listeners.push(listener);
  }
  mark(name: string): void {
    this.marks.push(name);
    this.log.push(`mark:${name}`);
  }
  now = (): number => {
    this.nowCalls++;
    return this.clock;
  };
  refresh(time: number): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const callback of waiting) callback(time);
  }
  setHidden(hidden: boolean): void {
    this.isHidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

/** A scene whose step costs 100 ms and whose draw costs `drawMs` on the host's clock. */
class SlowScene implements LoopScene {
  draws = 0;
  drawMs = 7;
  constructor(
    private readonly host: FakeHost,
    private readonly log: string[],
  ) {}
  step(): void {
    this.host.clock += 100;
    this.log.push('step');
  }
  draw(): void {
    this.draws++;
    this.host.clock += this.drawMs;
    this.log.push('draw');
  }
}

class RecordingObserver implements Observer {
  frames: [number, number][] = [];
  pauses = 0;
  resumes = 0;
  constructor(private readonly log: string[]) {}
  frame(time: number, workMs: number): void {
    this.frames.push([time, workMs]);
    this.log.push('observe');
  }
  pause(): void {
    this.pauses++;
    this.log.push('pause');
  }
  resume(): void {
    this.resumes++;
    this.log.push('resume');
  }
}

function setup(): { host: FakeHost; scene: SlowScene; observer: RecordingObserver; log: string[] } {
  const log: string[] = [];
  const host = new FakeHost(log);
  return { host, scene: new SlowScene(host, log), observer: new RecordingObserver(log), log };
}

describe('runSceneLoop with an observer', () => {
  it('reports every drawn frame once, with its rAF time', () => {
    const { host, scene, observer } = setup();
    runSceneLoop(host, scene, observer);
    for (let i = 0; i < 5; i++) host.refresh(1000 + i * 16.5);
    expect(observer.frames.map(([time]) => time)).toEqual([1000, 1016.5, 1033, 1049.5, 1066]);
    expect(scene.draws).toBe(5);
  });

  it('times scene.draw() alone: the steps before it are not work', () => {
    const { host, scene, observer } = setup();
    runSceneLoop(host, scene, observer);
    host.refresh(0);
    scene.drawMs = 3;
    host.refresh(50); // three steps (300 ms on the fake clock) then a 3 ms draw
    scene.drawMs = 11.25;
    host.refresh(66);
    expect(observer.frames.map(([, work]) => work)).toEqual([7, 3, 11.25]);
  });

  it('reports a frame after it is drawn', () => {
    const { host, scene, observer, log } = setup();
    runSceneLoop(host, scene, observer);
    host.refresh(0);
    log.length = 0;
    host.refresh(20);
    expect(log.indexOf('observe')).toBeGreaterThan(log.indexOf('draw'));
    expect(log.filter((e) => e === 'observe')).toHaveLength(1);
  });

  it('still records globe-ready once, after the first draw', () => {
    const { host, scene, observer, log } = setup();
    runSceneLoop(host, scene, observer);
    host.refresh(0);
    host.refresh(16);
    expect(host.marks).toEqual(['globe-ready']);
    expect(log.indexOf('mark:globe-ready')).toBeGreaterThan(log.indexOf('draw'));
  });

  it('pauses when the tab hides and resumes when it shows, reporting no frame while hidden', () => {
    const { host, scene, observer, log } = setup();
    runSceneLoop(host, scene, observer);
    host.refresh(0);
    host.refresh(16);
    host.setHidden(true);
    expect(observer.pauses).toBe(1);
    expect(observer.resumes).toBe(0);
    host.refresh(500); // nothing is waiting, so nothing is drawn or reported
    expect(observer.frames).toHaveLength(2);
    host.setHidden(false);
    expect(observer.resumes).toBe(1);
    host.refresh(60_000);
    expect(observer.frames.map(([time]) => time)).toEqual([0, 16, 60_000]);
    expect(log.indexOf('resume')).toBeGreaterThan(log.indexOf('pause'));
    expect(log.lastIndexOf('observe')).toBeGreaterThan(log.indexOf('resume'));
    expect(scene.draws).toBe(3);
  });

  it('a loop that was stopped tells the observer nothing more', () => {
    const { host, scene, observer } = setup();
    const loop = runSceneLoop(host, scene, observer);
    host.refresh(0);
    loop.stop();
    host.setHidden(true);
    host.setHidden(false);
    host.refresh(16);
    expect(observer.frames).toHaveLength(1);
    expect(observer.pauses + observer.resumes).toBe(0);
  });

  it('an observer that throws does not stop the scene', () => {
    const { host, scene } = setup();
    const broken: Observer = {
      frame: () => {
        throw new Error('readout boom');
      },
      pause: () => {
        throw new Error('readout boom');
      },
      resume: () => {
        throw new Error('readout boom');
      },
    };
    runSceneLoop(host, scene, broken);
    expect(() => host.refresh(0)).not.toThrow();
    expect(() => host.refresh(16)).not.toThrow();
    expect(host.pending.size).toBe(1);
    expect(host.marks).toEqual(['globe-ready']);
    expect(() => host.setHidden(true)).not.toThrow();
    expect(() => host.setHidden(false)).not.toThrow();
    host.refresh(40);
    expect(scene.draws).toBe(3);
    expect(host.pending.size).toBe(1);
  });

  it('falls back to performance.now when the host gives no clock', () => {
    const log: string[] = [];
    const host = new FakeHost(log);
    const plain: LoopHost = {
      requestFrame: (cb) => host.requestFrame(cb),
      cancelFrame: (h) => host.cancelFrame(h),
      hidden: () => host.hidden(),
      onVisibilityChange: (l) => host.onVisibilityChange(l),
      mark: (n) => host.mark(n),
    };
    const observer = new RecordingObserver(log);
    runSceneLoop(plain, { step: () => undefined, draw: () => undefined }, observer);
    host.refresh(10);
    host.refresh(26);
    expect(observer.frames).toHaveLength(2);
    for (const [, work] of observer.frames) {
      expect(Number.isFinite(work)).toBe(true);
      expect(work).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('runSceneLoop without an observer', () => {
  it('makes no timing call at all, over frames, hide and show', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    for (let i = 0; i < 20; i++) host.refresh(i * 16);
    host.setHidden(true);
    host.setHidden(false);
    for (let i = 0; i < 20; i++) host.refresh(10_000 + i * 16);
    expect(scene.draws).toBe(40);
    expect(host.nowCalls).toBe(0);
  });

  it('an undefined observer is the same as none', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene, undefined);
    for (let i = 0; i < 5; i++) host.refresh(i * 16);
    expect(scene.draws).toBe(5);
    expect(host.nowCalls).toBe(0);
  });
});
