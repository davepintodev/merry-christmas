// XMAS-42a "Browser-free preview image": the share-preview picture, 1200 by 630,
// drawn the way the page's fine layer draws it (tools/fine-frames.ts), with no
// browser. Purple night with the outside snow and the globe snow mid-stir, Santa
// in the glass, no digits and no added lettering. The same bytes on every call.
import { makeSnowRuntime } from '../src/page/snow-runtime.ts';
import type { SceneInput } from '../src/scene/frame.ts';
import type { GlobeSnow } from '../src/scene/snow.ts';
import { fineFrame } from './fine-frames.ts';
import { encodePng } from './png.ts';

export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;
/**
 * Screen pixels to each art pixel: 3, the largest whole zoom at which the whole
 * globe on its base fits the central 630 square. The glass and its base are 135
 * art rows, which is 675 screen rows at zoom 5 (126 rows fit), so zoom 5 would
 * have to crop the base; zoom 4 does not divide 630. At 3 the art is 400 by 210,
 * exactly the picture's height, so the whole scene is drawn with nothing cropped.
 */
export const PREVIEW_ZOOM = 3;

/** The seed and pretend clock every reference picture shares (tools/frames.ts). */
const SEED = 31;
const TIME = 1_234_567;
/** The globe snow's stir: the page's snow steps, the stir raised for the first RAISED_STEPS of STEPS. */
const STEPS = 60;
const RAISED_STEPS = 15;
const RAISE = 0.03;
/**
 * The globe's turn in radians (40 degrees): the lettering's first letter, F, stands at -0.36 at turn 0 (base-fine.ts),
 * so at this turn it stands at -1.06, near the left edge of the visible drum, and the text runs right off the right edge.
 */
const TURN = 0.7;
/**
 * The snow module keeps 30% of the globe's flakes in the air and restarts falling ones to hold that share, so the
 * stir alone cannot thin the drifting snow. The picture draws every resting flake and one airborne flake in every
 * AIR_KEEP: about a fifth of the air, so a few flakes drift in the glass.
 */
const AIR_KEEP = 5;

/** The globe snow as the picture draws it: every resting flake, and one airborne flake in every AIR_KEEP. */
function pictureSnow(snow: GlobeSnow | null): GlobeSnow | undefined {
  if (snow === null) return undefined;
  return { stir: snow.stir, flakes: snow.flakes.filter((f, i) => f.resting || i % AIR_KEEP === 0) };
}

/** The preview's scene input: Purple night, the snows run to mid-stir, the globe turned, at the art size of the picture. */
function previewInput(): SceneInput {
  const size = { width: PREVIEW_WIDTH / PREVIEW_ZOOM, height: PREVIEW_HEIGHT / PREVIEW_ZOOM };
  const runtime = makeSnowRuntime(SEED);
  for (let k = 0; k < STEPS; k++) {
    runtime.step({ turn: TURN, christmasDay: false, ...size, raise: k < RAISED_STEPS ? RAISE : 0 });
  }
  return {
    time: TIME,
    drag: 0,
    turn: TURN,
    phase: { from: 'purple-night', to: 'purple-night', share: 0 },
    seed: SEED,
    ...size,
    snow: pictureSnow(runtime.snow),
    outsideSnow: runtime.outsideSnow ?? undefined,
  };
}

/** The preview as PNG bytes: opaque, PREVIEW_WIDTH by PREVIEW_HEIGHT. */
export function renderPreview(): Uint8Array {
  const { width, height, rgba } = fineFrame(previewInput(), PREVIEW_ZOOM);
  return encodePng(width, height, rgba);
}
