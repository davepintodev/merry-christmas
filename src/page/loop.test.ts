// XMAS-31b "Scene core", page runtime: the scene's frame loop on the main
// thread. runSceneLoop(host, scene) draws one frame per screen refresh
// (host.requestFrame, i.e. requestAnimationFrame), runs the scene's fixed
// 60-steps-a-second clock before each draw, records `globe-ready` once when
// the first frame is drawn, stops asking for frames while the tab is hidden
// and resumes when it comes back, without replaying the time away.
import { describe, expect, it } from 'vitest';
import { STEP_MS } from './steps.ts';
import { runSceneLoop, type LoopHost, type LoopScene } from './loop.ts';

/** A fake page: frames fire only when the test says so. */
class FakeHost implements LoopHost {
  private next = 1;
  readonly pending = new Map<number, (time: number) => void>();
  readonly listeners: (() => void)[] = [];
  readonly marks: string[] = [];
  requested = 0;
  cancelled = 0;
  isHidden: boolean;
  log: string[];

  constructor(log: string[], hidden = false) {
    this.log = log;
    this.isHidden = hidden;
  }

  requestFrame(callback: (time: number) => void): number {
    const id = this.next++;
    this.requested++;
    this.pending.set(id, callback);
    return id;
  }

  cancelFrame(handle: number): void {
    if (this.pending.delete(handle)) this.cancelled++;
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

  /** Fires every frame callback waiting now, as one screen refresh at `time`. */
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

class FakeScene implements LoopScene {
  steps = 0;
  draws = 0;
  constructor(private readonly log: string[]) {}
  step(): void {
    this.steps++;
    this.log.push('step');
  }
  draw(): void {
    this.draws++;
    this.log.push('draw');
  }
}

function setup(hidden = false): { host: FakeHost; scene: FakeScene; log: string[] } {
  const log: string[] = [];
  return { host: new FakeHost(log, hidden), scene: new FakeScene(log), log };
}

describe('runSceneLoop', () => {
  it('asks for exactly one frame when started on a visible tab, and draws nothing before it', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    expect(host.pending.size).toBe(1);
    expect(scene.draws).toBe(0);
  });

  it('draws once per screen refresh and keeps exactly one frame request waiting', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    for (let i = 0; i < 10; i++) {
      host.refresh(1000 + i * 16);
      expect(scene.draws).toBe(i + 1);
      expect(host.pending.size).toBe(1);
    }
  });

  it.each([30, 60, 144])('runs 60 steps over a second of %s Hz refreshes, counted from the first frame', (hz) => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    const start = 4321.5;
    host.refresh(start);
    expect(scene.steps).toBe(0); // the first frame is step 0
    for (let i = 1; i <= hz; i++) host.refresh(start + (i * 1000) / hz);
    expect(scene.steps).toBe(60);
    expect(scene.draws).toBe(hz + 1);
  });

  it('runs a frame\'s steps before drawing it', () => {
    const { host, log } = setup();
    runSceneLoop(host, new FakeScene(log));
    host.refresh(0);
    log.length = 0;
    host.refresh(50); // 3 steps due
    expect(log).toEqual(['step', 'step', 'step', 'draw']);
  });

  it('records globe-ready once, right after the first frame is drawn', () => {
    const { host, scene, log } = setup();
    runSceneLoop(host, scene);
    expect(host.marks).toEqual([]);
    host.refresh(0);
    expect(log).toEqual(['draw', 'mark:globe-ready']);
    for (let i = 1; i < 5; i++) host.refresh(i * 16);
    expect(host.marks).toEqual(['globe-ready']);
  });

  it('started on a hidden tab: asks for no frame, draws nothing and records nothing until the tab shows', () => {
    const { host, scene } = setup(true);
    runSceneLoop(host, scene);
    expect(host.pending.size).toBe(0);
    host.refresh(0);
    expect(scene.draws).toBe(0);
    expect(host.marks).toEqual([]);
    host.setHidden(false);
    expect(host.pending.size).toBe(1);
    host.refresh(10);
    expect(scene.draws).toBe(1);
    expect(host.marks).toEqual(['globe-ready']);
  });

  it('stops drawing while the tab is hidden: no frame left waiting, none drawn', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    host.refresh(0);
    host.refresh(16);
    host.setHidden(true);
    const drawn = scene.draws;
    // Whatever the page still delivers draws nothing and asks for nothing more.
    host.refresh(32);
    host.refresh(48);
    expect(scene.draws).toBe(drawn);
    expect(host.pending.size).toBe(0);
  });

  it('resumes when the tab shows again, with one frame request, not one per event', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    host.refresh(0);
    host.setHidden(true);
    host.setHidden(false);
    host.setHidden(false); // a second visible event must not start a second loop
    expect(host.pending.size).toBe(1);
    host.refresh(5000);
    expect(scene.draws).toBe(2);
    expect(host.pending.size).toBe(1);
  });

  it('a hidden-visible-hidden flicker before the next refresh leaves nothing waiting', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    host.refresh(0);
    host.setHidden(true);
    host.setHidden(false);
    host.setHidden(true);
    host.refresh(16);
    expect(scene.draws).toBe(1);
    expect(host.pending.size).toBe(0);
  });

  it('does not replay the time away as steps: a minute hidden gives no burst', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    host.refresh(0);
    host.refresh(1000);
    expect(scene.steps).toBe(60);
    host.setHidden(true);
    host.setHidden(false);
    host.refresh(61_000); // first frame back, a minute later
    expect(scene.steps).toBeLessThanOrEqual(61);
    for (let i = 1; i <= 60; i++) host.refresh(61_000 + (i * 1000) / 60);
    expect(scene.steps).toBeGreaterThanOrEqual(120);
    expect(scene.steps).toBeLessThanOrEqual(121);
  });

  it('records globe-ready only once across hide and show', () => {
    const { host, scene } = setup();
    runSceneLoop(host, scene);
    host.refresh(0);
    host.setHidden(true);
    host.setHidden(false);
    host.refresh(100);
    expect(scene.draws).toBe(2);
    expect(host.marks).toEqual(['globe-ready']);
  });

  it('stop() ends the loop: the waiting request is dropped and a later visible event starts nothing', () => {
    const { host, scene } = setup();
    const loop = runSceneLoop(host, scene);
    host.refresh(0);
    loop.stop();
    expect(host.pending.size).toBe(0);
    host.setHidden(true);
    host.setHidden(false);
    host.refresh(16);
    expect(host.pending.size).toBe(0);
    expect(scene.draws).toBe(1);
  });
});

// XMAS-31b review round 1: "one frame per screen refresh" holds even when the
// picture stops changing (Frosty morning: no stars, one steady phase). The
// loop never swaps frame requests for a timer, so a phase change while the
// tab was hidden shows on the very next frame after it comes back.
describe('runSceneLoop with a picture that never changes', () => {
  /** A page that also offers a timer; the loop must never use it. */
  class TimerHost extends FakeHost {
    readonly waits: number[] = [];
    wait(ms: number, _callback: (time: number) => void): number {
      this.waits.push(ms);
      return -1;
    }
  }

  /** A scene that reports it is holding still, as a no-star noon sky would. */
  class StillScene extends FakeScene {
    moving(): boolean {
      return false;
    }
  }

  function still(hidden = false): { host: TimerHost; scene: StillScene } {
    const log: string[] = [];
    return { host: new TimerHost(log, hidden), scene: new StillScene(log) };
  }

  it('asks for a frame on every refresh and draws each one, for two seconds and more', () => {
    const { host, scene } = still();
    runSceneLoop(host, scene);
    const refreshes = 60 * 3;
    for (let i = 0; i < refreshes; i++) {
      host.refresh(1000 + (i * 1000) / 60);
      expect(host.pending.size, `refresh ${i}`).toBe(1);
    }
    expect(scene.draws).toBe(refreshes);
    expect(host.requested).toBe(refreshes + 1);
    expect(host.waits).toEqual([]);
  });

  it('asks for a frame at once when the tab is shown again, never a timer', () => {
    const { host, scene } = still();
    runSceneLoop(host, scene);
    for (let i = 0; i < 120; i++) host.refresh(i * 16); // two seconds of a still picture
    host.setHidden(true);
    expect(host.pending.size).toBe(0);
    const before = host.requested;
    host.setHidden(false);
    expect(host.requested).toBe(before + 1);
    expect(host.pending.size).toBe(1);
    expect(host.waits).toEqual([]);
    const drawn = scene.draws;
    host.refresh(60_000); // the very next refresh draws the new picture
    expect(scene.draws).toBe(drawn + 1);
  });

  it('started hidden and shown later: the first frame is a frame request, not a timer', () => {
    const { host, scene } = still(true);
    runSceneLoop(host, scene);
    host.setHidden(false);
    expect(host.pending.size).toBe(1);
    host.refresh(10);
    host.refresh(26);
    expect(scene.draws).toBe(2);
    expect(host.waits).toEqual([]);
  });
});

// XMAS-79 "Smooth between steps": draw gets how far the frame time is into the
// next step, for the same frame time the steps were counted for.
describe('runSceneLoop passing the part-step to draw', () => {
  class FractionScene implements LoopScene {
    readonly drawn: number[] = [];
    readonly stepsAtDraw: number[] = [];
    steps = 0;
    constructor(private readonly log: string[] = []) {}
    step(): void {
      this.steps++;
      this.log.push('step');
    }
    draw(fraction: number): void {
      this.drawn.push(fraction);
      this.stepsAtDraw.push(this.steps);
      this.log.push(`draw:${fraction.toFixed(3)}`);
    }
  }

  function start(hidden = false): { host: FakeHost; scene: FractionScene; log: string[] } {
    const log: string[] = [];
    const host = new FakeHost(log, hidden);
    const scene = new FractionScene(log);
    runSceneLoop(host, scene);
    return { host, scene, log };
  }

  it('draws the first frame with fraction 0', () => {
    const { host, scene } = start();
    host.refresh(4321.5);
    expect(scene.drawn).toEqual([0]);
  });

  it('a frame with no step due gets the part-step', () => {
    const { host, scene } = start();
    host.refresh(1000);
    host.refresh(1000 + STEP_MS * 0.25);
    host.refresh(1000 + STEP_MS * 0.5);
    host.refresh(1000 + STEP_MS * 0.75);
    expect(scene.steps).toBe(0);
    expect(scene.drawn[0]).toBe(0);
    expect(scene.drawn[1]).toBeCloseTo(0.25, 9);
    expect(scene.drawn[2]).toBeCloseTo(0.5, 9);
    expect(scene.drawn[3]).toBeCloseTo(0.75, 9);
  });

  it('a frame with one step due gets the part-step after it, with the step already run', () => {
    const { host, scene } = start();
    host.refresh(0);
    host.refresh(STEP_MS * 1.3);
    expect(scene.stepsAtDraw[1]).toBe(1);
    expect(scene.drawn[1]).toBeCloseTo(0.3, 9);
  });

  it('several steps in one frame: all run, then draw gets the part-step of the frame time', () => {
    const { host, scene, log } = start();
    host.refresh(500);
    log.length = 0;
    host.refresh(500 + STEP_MS * 3.6);
    expect(log).toEqual(['step', 'step', 'step', 'draw:0.600']);
    expect(scene.drawn[1]).toBeCloseTo(0.6, 9);
  });

  it('a frame exactly on a step boundary gets 0 after its step', () => {
    const { host, scene } = start();
    host.refresh(0);
    host.refresh(100); // six steps
    expect(scene.steps).toBe(6);
    expect(scene.drawn[1]).toBe(0);
  });

  it('a frame at the same time again gets the same part-step and runs no step', () => {
    const { host, scene } = start();
    host.refresh(0);
    host.refresh(STEP_MS * 1.5);
    host.refresh(STEP_MS * 1.5);
    expect(scene.steps).toBe(1);
    expect(scene.drawn[2]).toBeCloseTo(scene.drawn[1], 12);
  });

  it('time going backwards gets 0 and no step', () => {
    const { host, scene } = start();
    host.refresh(1000);
    host.refresh(1500);
    const steps = scene.steps;
    host.refresh(1200);
    expect(scene.steps).toBe(steps);
    expect(scene.drawn[2]).toBe(0);
  });

  it('every fraction over a run of 144 Hz refreshes is in [0, 1) and matches the time', () => {
    const { host, scene } = start();
    const t0 = 2000.25;
    for (let i = 0; i <= 288; i++) host.refresh(t0 + (i * 1000) / 144);
    scene.drawn.forEach((f, i) => {
      const expected = (((i * 1000) / 144) / STEP_MS) % 1;
      const diff = Math.min(Math.abs(f - expected), 1 - Math.abs(f - expected));
      expect(diff, `frame ${i}`).toBeLessThan(1e-6);
    });
  });

  it('the first frame back from hidden is drawn with fraction 0, whatever the part-step was before', () => {
    const { host, scene } = start();
    host.refresh(0);
    host.refresh(STEP_MS * 5.7); // 0.7 pending
    expect(scene.drawn[1]).toBeCloseTo(0.7, 9);
    host.setHidden(true);
    host.setHidden(false);
    host.refresh(60_000 + STEP_MS * 0.4);
    expect(scene.drawn[2]).toBe(0);
    host.refresh(60_000 + STEP_MS * 0.4 + STEP_MS * 0.5);
    expect(scene.drawn[3]).toBeCloseTo(0.5, 9);
  });

  it('works with a draw that takes no argument', () => {
    const log: string[] = [];
    const host = new FakeHost(log);
    const scene = new FakeScene(log);
    runSceneLoop(host, scene);
    host.refresh(0);
    host.refresh(50);
    expect(scene.draws).toBe(2);
  });
});
