// XMAS-32d "The globe", slice 4: the page turns the globe by itself. No
// visitor input turns it yet, so src/page/scene.ts hands the frames call
// `turn: autoTurn(time)` with the scene's own step time. The page file runs
// on import; here the browser bits it touches are stand-ins, the loop is
// captured instead of run, and the frame source records what it is asked for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneInput } from '../scene/frame.ts';
import { autoTurn } from '../scene/turn.ts';
import type { LoopScene } from './loop.ts';
import { STEP_MS } from './steps.ts';

const captured = vi.hoisted(() => ({ scene: null as LoopScene | null, inputs: [] as SceneInput[] }));

vi.mock('./loop.ts', () => ({
  runSceneLoop: (_host: unknown, scene: LoopScene) => {
    captured.scene = scene;
    return { stop: () => undefined };
  },
}));

vi.mock('./frames.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./frames.ts')>();
  return {
    ...actual,
    makeFrameSource: () => (input: SceneInput, target?: Uint32Array) => {
      captured.inputs.push({ ...input });
      const picture = target ?? new Uint32Array(input.width * input.height);
      return { width: input.width, height: input.height, picture, layout: undefined as never };
    },
  };
});

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => {
  captured.scene = null;
  captured.inputs = [];
  vi.resetModules();
  const canvas = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => ({ putImageData: () => undefined }) };
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
  });
  vi.stubGlobal('document', { querySelector: () => canvas, hidden: false, addEventListener: () => undefined });
  vi.stubGlobal('ImageData', FakeImageData);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadScene(): Promise<LoopScene> {
  await import('./scene.ts');
  const scene = captured.scene;
  if (scene === null) expect.fail('the page did not start the scene loop');
  return scene;
}

function last(): SceneInput {
  const input = captured.inputs[captured.inputs.length - 1];
  if (input === undefined) expect.fail('no frame was drawn');
  return input;
}

describe('the scene page turns the globe by itself', () => {
  it('asks for the first frame at the auto turn of time 0', async () => {
    const scene = await loadScene();
    scene.draw();
    const input = last();
    expect(input.time).toBe(0);
    expect(input.turn, 'a turn is passed').toBeDefined();
    expect(input.turn).toBeCloseTo(autoTurn(0), 12);
  });

  it('passes autoTurn of the scene time on every frame, so the turn grows as the steps go by', async () => {
    const scene = await loadScene();
    const turns: number[] = [];
    for (const steps of [1, 59, 60, 600]) {
      for (let k = 0; k < steps; k++) scene.step();
      scene.draw();
      const input = last();
      expect(input.turn, `time ${input.time}`).toBeDefined();
      expect(input.turn ?? Number.NaN, `time ${input.time}`).toBeCloseTo(autoTurn(input.time), 12);
      turns.push(input.turn ?? Number.NaN);
    }
    expect(last().time).toBeCloseTo(720 * STEP_MS, 9);
    for (let k = 1; k < turns.length; k++) expect(turns[k] ?? 0).toBeGreaterThan(turns[k - 1] ?? 0);
  });
});
