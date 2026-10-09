// XMAS-31b "Scene core", page runtime: frames for the scene canvas.
// makeFrameSource(build) gives a frame function that keeps the layout for
// one picture size and seed, building it again only when the size or seed
// changes (not every frame), and draws with the layout it keeps.
// toRgba(picture, out) turns the engine's 0xRRGGBB colour numbers into the
// canvas's RGBA bytes, fully opaque.
import { sceneFrame, sceneLayout, type SceneFrame, type SceneInput, type SceneLayout } from '../scene/frame.ts';

/** Builds one picture's layout; the engine's own sceneLayout by default. */
export type LayoutBuilder = (width: number, height: number, seed: number) => SceneLayout;

export type FrameSource = (input: SceneInput, target?: Uint32Array) => SceneFrame;

export function makeFrameSource(build: LayoutBuilder = sceneLayout): FrameSource {
  let layout: SceneLayout | null = null;
  let seed = 0;
  return (input, target) => {
    if (layout === null || layout.width !== input.width || layout.height !== input.height || seed !== input.seed) {
      // A refused size or a build that throws keeps nothing: the old layout
      // stays in use, and the next frame asks the builder again.
      layout = build(input.width, input.height, input.seed);
      seed = input.seed;
    }
    return sceneFrame(input, target, layout);
  };
}

/** Writes one RGBA byte quadruple per colour number into `out`, alpha 255. */
export function toRgba(picture: Uint32Array, out: Uint8ClampedArray): void {
  const wanted = picture.length * 4;
  if (out.length !== wanted) throw new RangeError(`out must hold ${wanted} RGBA bytes, got ${out.length}`);
  for (let i = 0; i < picture.length; i++) {
    const colour = picture[i] ?? 0;
    out[i * 4] = (colour >> 16) & 0xff;
    out[i * 4 + 1] = (colour >> 8) & 0xff;
    out[i * 4 + 2] = colour & 0xff;
    out[i * 4 + 3] = 255;
  }
}
