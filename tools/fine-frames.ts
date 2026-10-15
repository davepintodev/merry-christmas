// XMAS-85 "Fine layer: reference pictures and the owner's turn review": a scene
// input drawn the way the page's fine layer draws it, without a browser. The
// coarse picture (shapeBodies false) is upscaled by a whole zoom, nearest
// neighbour, and the fine pieces go over it in the order src/page/fine-layer.ts
// draws them: the flakes behind the glass centre, each floor shadow, the faces
// with Santa by depth, then the flakes in front. Lean is 0 only: the fine
// layer's row shifts are not drawn here.
import { sceneFrame, type SceneInput } from '../src/scene/frame.ts';
import { drawListOf, renderDrawList, renderShadowSteps, shadowDrawList, turnBodies } from '../src/scene/shape-draw-list.ts';
import { flakeSize, renderSnowSteps, snowDrawList } from '../src/scene/snow-draw-list.ts';

/** A picture as RGBA bytes, opaque: width x height pixels, row by row from the top left. */
export interface FineRgba {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** The fine layer's picture of `input` at `zoom` screen pixels to each art pixel, as RGBA bytes. Throws a RangeError for a zoom that is not a whole number of at least 1, or a lean other than 0. */
export function fineFrame(input: SceneInput, zoom = 5): FineRgba {
  if (!Number.isInteger(zoom) || zoom < 1) throw new RangeError(`zoom must be a whole number of at least 1, got ${zoom}`);
  if ((input.lean ?? 0) !== 0) throw new RangeError(`fineFrame draws lean 0 only, got ${input.lean}`);
  const turn = input.turn ?? 0;
  // The coarse picture without the shapes' bodies or shadows: the fine pieces below draw those, Santa and the snow.
  const frame = sceneFrame({ ...input, shapeBodies: false });
  const { width, height, layout } = frame;
  const side = width * zoom;
  const rows = height * zoom;
  const picture = new Uint32Array(side * rows);
  for (let y = 0; y < rows; y++) {
    const from = Math.floor(y / zoom) * width;
    for (let x = 0; x < side; x++) picture[y * side + x] = frame.picture[from + Math.floor(x / zoom)] ?? 0;
  }

  // The snow as the page hands it over: no earlier snow to blend from, so each flake is where its current step put it.
  const size = flakeSize(zoom);
  const behind = input.snow === undefined ? [] : snowDrawList(input.snow, undefined, 1, 'behind', input.time);
  const front = input.snow === undefined ? [] : snowDrawList(input.snow, undefined, 1, 'front', input.time);
  renderSnowSteps(picture, width, layout, behind, zoom, size);
  renderShadowSteps(picture, width, layout, shadowDrawList(turn), zoom);
  renderDrawList(picture, width, layout, drawListOf(turnBodies(turn), input.time), zoom);
  renderSnowSteps(picture, width, layout, front, zoom, size);

  const rgba = new Uint8Array(picture.length * 4);
  for (let i = 0; i < picture.length; i++) {
    const colour = picture[i] ?? 0;
    rgba[i * 4] = (colour >> 16) & 0xff;
    rgba[i * 4 + 1] = (colour >> 8) & 0xff;
    rgba[i * 4 + 2] = colour & 0xff;
    rgba[i * 4 + 3] = 0xff;
  }
  return { width: side, height: rows, rgba };
}
