// XMAS-70 "Background too plain in every phase": the scene's backdrop, the
// things between the sky ramp and the globe: soft clouds, a hazy far ridge, a
// near rolling snow hill and three overlapping ridges with rows of dark pines on the hills. All of it is
// drawn on the art pixel grid in whole pixels, from the seed alone, and never
// behind the glass or over the countdown's strip. One plan (a code per pixel)
// is worked out per picture size and seed; each frame only looks the codes up
// in the phase's palette, so phases and blends just swap colours.
import { mixHex } from '../countdown/colours.ts';
import type { PhaseName } from '../shared/clock.ts';
import type { Rect, SceneLayout } from './frame.ts';

import {
  BELLY, BLUE, BULB, CLOUD_BODY, CLOUD_LIT, CLOUD_SHADE, FAR_HILL, FAR_PINE_LIT, FAR_PINE_SHADE, FAR_SHADE, FLOOR_LIGHT, FLOOR_SHADE, GREEN, MID_HILL,
  MID_RIM, MID_SHADE, NEAR_HILL, NEAR_RIM, NEAR_SHADE, NEAR_SPECK, NONE, PINE_LIT, PINE_SHADE, RED, ROCK, ROCK_LIT, SNOW_CAP, SPARKLE, TRUNK, TUFT,
} from './backdrop-codes.ts';
import { BASE_TOP_ROWS, BASE_WIDTH } from './base-fine.ts';
import { BASE_SINK } from './globe.ts';
import { bird, bunny, BUNNY_SIZE, cabin, CABIN, fence, gifts, topStar, type Put } from './scenery.ts';

/** A seeded PRNG (mulberry32); the scene's only randomness. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each phase's colours for the codes above, light from the top left (lit pine side on the left, shaded on the right). The far ridge is hazy and the pines on it are dimmer than the near ones. */
const PALETTE: Record<PhaseName, readonly string[]> = {
  // Dawn: a dusty violet ridge against the apricot glow, indigo-plum pines, pink cloud tops.
  dawn: ['', '#ffe6d8', '#e8b4c0', '#b98ab4', '#b08cb8', '#c6b4e0', '#fbe8f2', '#8c70a8', '#7c6498', '#3b3a6e', '#2c2a58'],
  // Frosty morning: white clouds, a pale snowy ridge, cold blue-green pines.
  'frosty-morning': ['', '#ffffff', '#f2f8ff', '#cfe2f6', '#bcd8f2', '#bad0ea', '#f2f9ff', '#7fa6c4', '#6f96b6', '#2d5a6e', '#234a5e'],
  // Sunset: coral-lit clouds, a plum ridge, aubergine pines.
  sunset: ['', '#ffc2a8', '#e8788c', '#b04c7c', '#984878', '#e2aac0', '#fdeaf0', '#6e3468', '#602c5c', '#4a2358', '#381a46'],
  // Purple night: faint violet clouds, a deep indigo ridge, the prototype's ink-blue pines.
  'purple-night': ['', '#5a4c98', '#46397f', '#372b6a', '#352c6e', '#a2aee0', '#d6deff', '#26244f', '#201e46', '#1d3350', '#16283f'],
};

/** The colours of codes 11 to 49, in the order of the constants above (hill shades and specks, the middle ridge, snow on branches, trunks, then the floor's shade, light, sparkle, rocks and tufts). */
const EXTRA: Record<PhaseName, readonly string[]> = {
  dawn: ['#9a78a6', '#b4a0d2', '#fff6fa', '#9c7eb0', '#8a6c9e', '#d8c0d8', '#fff0f6', '#4a3050', '#e4d2ee', '#ffffff', '#ffffff', '#6c5a86', '#9a88b4', '#8a6a8c', '#7a4a5e', '#5e3850', '#ffd890', '#e8d8ec', '#3b3a6e', '#ffe0a0', '#6a5a88', '#8a6a7a', '#b49aa8', '#fff6fa', '#2c2040', '#9a6678', '#f4eaff', '#ffe2a8', '#f0b060', '#2f7a5a', '#d8424e', '#f4a0b8', '#2c2040', '#5a4a8a', '#f0d0d8', '#5a8ae0', '#4ac080', '#f08a30', '#7a5a68'],
  'frosty-morning': ['#a6c4e2', '#a4bfdc', '#ffffff', '#9fc0e0', '#8cb0d2', '#e4f2ff', '#ffffff', '#4a3a3a', '#cfe2f6', '#ffffff', '#ffffff', '#6a7f98', '#9fb4cc', '#7a8a6a', '#8a5a50', '#6a443f', '#ffe29a', '#ffffff', '#2d5a6e', '#fff0b0', '#6a8aa8', '#9a7a70', '#a08c90', '#ffffff', '#233a4e', '#a87462', '#ffffff', '#fff2b8', '#e8a050', '#2f7a58', '#d84a4a', '#f4a8b8', '#233a4e', '#4a7a96', '#f4f4f8', '#3a78d8', '#2fb070', '#f08428', '#8a6a58'],
  sunset: ['#84406a', '#cf98b4', '#fff4f6', '#7e3c70', '#6c3262', '#f0b4b8', '#ffd4cc', '#3a1a30', '#f4cedb', '#fff8fa', '#ffffff', '#6a3a62', '#a86a8a', '#8a4a5e', '#6a2c4c', '#4e2040', '#ffc060', '#d89aaa', '#381a46', '#ffd070', '#5a2c5c', '#7a4060', '#8a6070', '#fff0f4', '#2a1236', '#8a3c60', '#ffe4ec', '#ffc27a', '#f09040', '#2a6a50', '#e0505a', '#f8a0a8', '#2a1236', '#6a3a74', '#f4c0c8', '#6a8ae8', '#50c080', '#ff8c3a', '#80506a'],
  'purple-night': ['#2a2258', '#8e9ad0', '#eef2ff', '#2c2860', '#221e4e', '#7c88c8', '#c8d4f8', '#2a2036', '#c4cff2', '#f0f4ff', '#ffffff', '#3c4478', '#7884bc', '#5a5a8e', '#2e2a58', '#241f48', '#ffd060', '#6a64a8', '', '#ffcf6a', '#2a2a58', '#3a3668', '#6a6a9c', '#dfe6ff', '#0e1024', '#46407a', '#cfd8ff', '#ffd27a', '#f0a848', '#2a6a58', '#e04a5e', '#e898b8', '#0e1024', '', '#9a98d0', '#6a9aff', '#58d890', '#f89040', '#8a7aa0'],
};

/** The plan: one code per pixel of the sky and hill rows (0 = bare sky). */
export interface Backdrop {
  /** width * height codes, row by row: the sky and hills above the horizon, the floor details below it. */
  codes: Uint8Array;
  width: number;
}

/** The clear sky over the near hill's rolling line, in art pixels; the far ridge stands a little higher. */
const NEAR_HEIGHT = 5;
const FAR_HEIGHT = 17;
const MID_HEIGHT = 10;

/** Whether (x, y) lies inside the globe's glass, plus a rim of one pixel, or under the base's top rows that rise over the glass's foot (XMAS-68): the backdrop stops short of it. Only where the base's lip really stands (XMAS-95): its slanted ends leave the corners open, and the hills run on there instead of a square of bare sky. */
function behindGlass(layout: SceneLayout, x: number, y: number): boolean {
  const col = x - (layout.globe.cx - BASE_WIDTH / 2);
  if (col >= 0 && col < BASE_WIDTH && y >= layout.groundTop - BASE_SINK + (BASE_TOP_ROWS[col] ?? 0)) return true;
  const dx = x + 0.5 - layout.globe.cx;
  const dy = y + 0.5 - layout.globe.cy;
  return dx * dx + dy * dy <= (layout.globe.radius + 1) ** 2;
}

/** A rolling line: a sum of two sines, phases from the seed, as whole rows of height above the horizon. */
function rolling(width: number, base: number, a1: number, w1: number, a2: number, w2: number, rand: () => number): Int16Array {
  const p1 = rand() * 2 * Math.PI;
  const p2 = rand() * 2 * Math.PI;
  const out = new Int16Array(width);
  for (let x = 0; x < width; x++) out[x] = Math.max(0, Math.round(base + a1 * Math.sin(x * w1 + p1) + a2 * Math.sin(x * w2 + p2)));
  return out;
}

/** A tree's shape: tiers of triangles, a lean in whole pixels per tier, snow on the branches, or bare. */
interface PineShape { tiers: number; lean: number; snowy: boolean; bare: boolean; bulbs?: boolean }

/** One pine: a trunk and stacked triangles, lit left half, shaded right half; a lean shifts the upper tiers sideways by whole pixels. */
function pine(put: Put, x0: number, yBase: number, h: number, lit: number, shade: number, shape: PineShape): void {
  const { tiers, lean, snowy, bare } = shape;
  if (bare) {
    for (let i = 1; i <= h; i++) {
      const x = x0 + Math.round((lean * i) / 4);
      put(x, yBase - i, TRUNK);
      if (i > 3 && i % 3 === 0 && i < h - 1) {
        const reach = Math.max(1, Math.floor((h - i) / 3));
        for (let k = 1; k <= reach; k++) {
          put(x - k, yBase - i - Math.ceil(k / 2), TRUNK);
          put(x + k, yBase - i - Math.ceil(k / 2), TRUNK);
        }
      }
    }
    return;
  }
  put(x0, yBase - 1, TRUNK);
  put(x0, yBase - 2, TRUNK);
  const tier = Math.ceil(h / (tiers - 0.8));
  const step = Math.floor(h / (tiers + 1));
  for (let k = 0; k < tiers; k++) {
    const top = yBase - 2 - h + k * step;
    const cx = x0 + lean * (tiers - 1 - k);
    for (let i = 0; i < tier + k * 2; i++) {
      const half = Math.floor(i / 2);
      for (let dx = -half; dx <= 0; dx++) put(cx + dx, top + i, lit);
      for (let dx = 1; dx <= half; dx++) put(cx + dx, top + i, shade);
    }
    if (shape.bulbs === true) {
      const colours = [BULB, RED, BLUE, GREEN];
      for (let i = 2; i < tier + k * 2; i += 3) {
        const half = Math.floor(i / 2);
        put((i + k) % 2 === 0 ? cx - half : cx + half, top + i, colours[(i + k) % 4] ?? BULB);
      }
      // A garland swag across the tier, sagging in the middle, gold and red beads.
      const wide = Math.floor((tier + k * 2 - 4) / 2);
      for (let dx = -wide; dx <= wide; dx++) put(cx + dx, top + tier + k * 2 - 5 + Math.round(2 * (1 - (dx / Math.max(1, wide)) ** 2)), dx % 3 === 0 ? RED : BULB);
    }
    if (snowy) {
      put(cx, top, SNOW_CAP);
      put(cx - 1 - k, top + 2 + k * 2, SNOW_CAP);
      if (k > 0) put(cx - k, top + 3 + k * 2, SNOW_CAP);
    }
  }
}

/** A pine's shape from the generator: mostly three or four tiers, now and then snowy, leaning or bare. */
function shapeOf(rand: () => number, plain: boolean): PineShape {
  const roll = rand();
  if (plain) return { tiers: 3, lean: 0, snowy: false, bare: false };
  return {
    tiers: rand() < 0.4 ? 4 : 3,
    lean: rand() < 0.2 ? (rand() < 0.5 ? -1 : 1) : 0,
    snowy: roll < 0.4,
    bare: roll > 0.92,
  };
}

/** A cloud as pixels: overlapping rounded puffs, tall in the middle, small at the tapering ends, a gently curved flat-ish underside; the lit pixel is each column's top and the shaded one its bottom. */
function cloudPixels(x: number, base: number, width: number, rand: () => number): { x: number; y: number; code: number }[] {
  const bumps = 3 + Math.floor(rand() * 3);
  const slot = width / (bumps + 1);
  const puffs = Array.from({ length: bumps }, (_, i) => {
    const middle = 1 - Math.abs((i + 0.5) / bumps - 0.5) * 1.6;
    const ry = 1.8 + 5.5 * middle * (0.55 + rand() * 0.45);
    return { cx: x + slot * (i + 1) + (rand() - 0.5) * 2, cy: base - 1 + (rand() - 0.5) * 2, rx: slot * (0.9 + rand() * 0.5), ry, down: 1.2 + ry * 0.3 };
  });
  // Each column's top and bottom row, then the ends rounded off (XMAS-94): the end columns are one pixel tall and each column
  // inward may rise by two rows or sink by one at most, so no end stands as a flat wall.
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (let px = x; px < x + width; px++) {
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (let py = base - 10; py <= base + 3; py++) {
      const inside = puffs.some((e) => {
        const dy = py + 0.5 - e.cy;
        return ((px + 0.5 - e.cx) / e.rx) ** 2 + (dy / (dy < 0 ? e.ry : e.down)) ** 2 <= 1;
      });
      if (!inside) continue;
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    }
    tops.push(top);
    bottoms.push(bottom);
  }
  const filled = tops.map((t) => Number.isFinite(t));
  const first = filled.indexOf(true);
  const last = filled.lastIndexOf(true);
  for (const i of [first, last]) if (i >= 0) tops[i] = bottoms[i] ?? 0;
  const limit = (i: number, from: number): void => {
    if (!filled[i] || !filled[from]) return;
    tops[i] = Math.max(tops[i] ?? 0, (tops[from] ?? 0) - 2);
    bottoms[i] = Math.min(bottoms[i] ?? 0, (bottoms[from] ?? 0) + 1);
  };
  for (let i = first + 1; i <= last; i++) limit(i, i - 1);
  for (let i = last - 1; i >= first; i--) limit(i, i + 1);
  const out: { x: number; y: number; code: number }[] = [];
  for (let i = 0; i < tops.length; i++) {
    if (!filled[i]) continue;
    const top = tops[i] ?? 0;
    const bottom = bottoms[i] ?? 0;
    for (let py = top; py <= bottom; py++) out.push({ x: x + i, y: py, code: py === top ? CLOUD_LIT : py === bottom && bottom > top ? CLOUD_SHADE : CLOUD_BODY });
  }
  return out;
}

/** A cheap deterministic hash of a pixel, 0 to 1, for snow specks. */
function speckle(x: number, y: number): number {
  return (Math.imul(x * 73856093 ^ y * 19349663, 0x2545f491) >>> 8) / 16777216;
}

/** True when the whole box lies clear of the glass (and one pixel round it). */
function clearOfGlass(layout: SceneLayout, x: number, y: number, w: number, h: number): boolean {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) if (behindGlass(layout, px, py)) return false;
  return true;
}

/** The bunny's column and bottom row on the snow under the base on every picture taller than wide (the phone); null otherwise (the bunny then stands on the hill). The sound and pause buttons take the bottom left; the bunny keeps right of them. */
function bunnyBelowBase(layout: SceneLayout): { x: number; bottom: number } | null {
  if (layout.height <= layout.width) return null;
  return { x: layout.globe.cx + 8, bottom: layout.height - 3 };
}

/** One paw print, three art pixels wide: three toes over a pad, in the hill-shade blue so it reads on the snow in every phase. */
const PAW: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [2, 1], [0, 2], [1, 2], [2, 2], [1, 3]];

/** The bunny on the open snow with a trail of paw prints leading to it from the left, one every six pixels, alternating a few rows up and down like hops. */
function bunnyOnSnow(put: Put, x: number, bottom: number): void {
  bunny(put, x, bottom);
  for (let i = 0; i < 3; i++) {
    const px = x - 7 - i * 6;
    const py = bottom - 3 - ((i + 1) % 2) * 3;
    for (const [dx, dy] of PAW) put(px + dx, py + dy, NEAR_SHADE);
  }
}

/** The floor's details below the horizon, in the open snow clear of the base and the hint: drifts, shade bands, footprints, rocks, tufts and sparkles. */
function floorDetails(layout: SceneLayout, rand: () => number): (put: Put) => void {
  const { width, height, groundTop } = layout;
  const cx = layout.globe.cx;
  return (put) => {
    const floor: Put = (x, y, code) => {
      if (x < 0 || x >= width || y < groundTop + 4 || y >= height) return;
      if (Math.abs(x - cx) <= 64 && y < groundTop + 40) return;
      put(x, y, code);
    };
    const rows = height - groundTop;
    // Soft shade bands, broken and wavy, with a light edge under each.
    for (let b = 0; b < 3; b++) {
      const y0 = groundTop + 10 + Math.round(((b + 0.5) * (rows - 12)) / 3);
      const p = rand() * 6;
      const q = rand() * 6;
      for (let x = 0; x < width; x++) {
        if (Math.sin(x * 0.07 + p) + Math.sin(x * 0.19 + q) < 0.5) continue;
        const y = y0 + Math.round(Math.sin(x * 0.05 + b) * 1.5);
        floor(x, y, FLOOR_SHADE);
        floor(x, y + 1, FLOOR_LIGHT);
      }
    }
    // Drifts: low mounds lit on the left, shaded on the right and underneath.
    const mounds = Math.min(9, 3 + Math.floor(width / 45));
    for (let m = 0; m < mounds; m++) {
      const mx = Math.floor(rand() * width);
      const my = groundTop + 8 + Math.floor(rand() * Math.max(1, rows - 12));
      const rx = 8 + Math.floor(rand() * 16);
      const ry = 2 + Math.floor(rand() * 3);
      for (let dx = -rx; dx <= rx; dx++) {
        const t = Math.round(ry * Math.sqrt(1 - (dx / rx) ** 2));
        for (let dy = 0; dy < t; dy++) {
          if (dy === t - 1 && dx < rx * 0.3) floor(mx + dx, my - dy, FLOOR_LIGHT);
          else if (dx > rx * 0.4 && dy >= t - 2) floor(mx + dx, my - dy, FLOOR_SHADE);
        }
        if (Math.abs(dx) < rx * 0.9) floor(mx + dx, my + 1, FLOOR_SHADE);
      }
    }
    // One trail of footprints, a pair of marks every few pixels.
    const fx = Math.floor(rand() * width * 0.6);
    const fy = groundTop + 12 + Math.floor(rand() * Math.max(1, rows - 20));
    for (let i = 0; i < 8; i++) {
      const y = fy + (i % 2) * 2 - Math.floor(i / 3);
      floor(fx + i * 4, y, FLOOR_SHADE);
      floor(fx + i * 4 + 1, y, FLOOR_SHADE);
      floor(fx + i * 4, y + 1, FLOOR_LIGHT);
    }
    // Small rocks with a lit top and a shadow, and grass tufts poking through.
    for (let i = 0; i < Math.min(5, 1 + Math.floor(width / 70)); i++) {
      const x = 2 + Math.floor(rand() * (width - 6));
      const y = groundTop + 10 + Math.floor(rand() * Math.max(1, rows - 14));
      floor(x, y - 1, ROCK_LIT);
      floor(x + 1, y - 1, ROCK);
      for (let dx = -1; dx <= 2; dx++) floor(x + dx, y, ROCK);
      for (let dx = 0; dx <= 3; dx++) floor(x + dx, y + 1, FLOOR_SHADE);
    }
    for (let i = 0; i < Math.min(7, 2 + Math.floor(width / 50)); i++) {
      const x = 2 + Math.floor(rand() * (width - 4));
      const y = groundTop + 8 + Math.floor(rand() * Math.max(1, rows - 12));
      floor(x - 1, y, TUFT);
      floor(x - 1, y - 1, TUFT);
      floor(x, y, TUFT);
      floor(x, y - 1, TUFT);
      floor(x, y - 2, TUFT);
      floor(x + 1, y, TUFT);
      floor(x + 2, y - 1, TUFT);
    }
    // Sparkles in the open snow.
    for (let i = Math.round((width * rows) / 260); i > 0; i--) floor(Math.floor(rand() * width), groundTop + 5 + Math.floor(rand() * Math.max(1, rows - 5)), SPARKLE);
  };
}

/**
 * The backdrop's seed, read off the layout so that a picture depends on the layout alone (the page keeps one
 * layout per size and seed): a hash of where the seed put the stars.
 */
function seedOf(layout: SceneLayout): number {
  return layout.stars.reduce((h, star) => Math.imul(h ^ (star.y * 4099 + star.x), 0x01000193) >>> 0, 0x811c9dc5);
}

/** The backdrop plan for one layout; clip false also fills the space inside the upright glass, for a leaning glass to show where it has left. */
export function makeBackdrop(layout: SceneLayout, clip = true): Backdrop {
  const { width, height, groundTop } = layout;
  const top = layout.countdown.y + layout.countdown.height;
  const codes = new Uint8Array(width * height);
  const rand = random(seedOf(layout));
  const put: Put = (x, y, code) => {
    if (x < 0 || x >= width || y < top + 2 || y >= height) return;
    if (clip && y < groundTop && behindGlass(layout, x, y)) return;
    codes[y * width + x] = code;
  };

  // Clouds in the open sky, clear of the disc, of each other and mostly of the glass.
  const disc: Rect = { x: layout.disc.x - 3, y: layout.disc.y - 3, width: layout.disc.width + 6, height: layout.disc.height + 6 };
  const placed: Rect[] = [];
  const wanted = Math.min(9, Math.max(3, Math.round((width * (groundTop - top)) / 5000)));
  const lowest = groundTop - FAR_HEIGHT - 14;
  for (let tries = 0; tries < wanted * 30 && placed.length < wanted; tries++) {
    const w = 12 + Math.floor(rand() * 20);
    const x = Math.floor(rand() * (width - w));
    const base = top + 12 + Math.floor(rand() * Math.max(1, lowest - top - 12));
    const box: Rect = { x: x - 2, y: base - 11, width: w + 4, height: 16 };
    const clash = (r: Rect): boolean => box.x < r.x + r.width && r.x < box.x + box.width && box.y < r.y + r.height && r.y < box.y + box.height;
    const pixels = cloudPixels(x, base, w, rand);
    if (clash(disc) || placed.some(clash)) continue;
    if (pixels.filter((p) => behindGlass(layout, p.x, p.y)).length > pixels.length * 0.4) continue;
    placed.push(box);
    for (const p of pixels) put(p.x, p.y, p.code);
  }

  // Three overlapping ridges, far to near, each a filled rolling line down to the horizon.
  const near = rolling(width, NEAR_HEIGHT, 3.5, 0.06, 1.5, 0.15, rand);
  const mid = rolling(width, MID_HEIGHT, 3.5, 0.045, 1.8, 0.13, rand);
  const far = rolling(width, FAR_HEIGHT, 5, 0.035, 2, 0.11, rand);
  for (let x = 0; x < width; x++) {
    mid[x] = Math.max(mid[x] ?? 0, (near[x] ?? 0) + 2);
    far[x] = Math.max(far[x] ?? 0, (mid[x] ?? 0) + 2);
  }
  /** Fills a ridge: its lit slope's top row is the rim, the slope falling away to the right is shaded, and the snow has the odd speck. */
  const fill = (line: Int16Array, body: number, shade: number, rim: number, speck: number): void => {
    for (let x = 0; x < width; x++) {
      const h = line[x] ?? 0;
      const falling = (line[x - 1] ?? h) > h || (line[x + 1] ?? h) < h;
      for (let y = groundTop - h; y < groundTop; y++) {
        const depth = y - (groundTop - h);
        let code = body;
        if (depth === 0) code = rim;
        else if (falling && depth <= 2) code = shade;
        else if (speck !== body && speckle(x, y) < 0.05) code = speck;
        put(x, y, code);
      }
    }
  };
  const row = (line: Int16Array, from: number, gap: () => number, size: () => number, lit: number, shade: number, plain: boolean): void => {
    for (let x = from; x < width; x += gap()) {
      pine(put, x, groundTop - (line[x] ?? 0) + 1, size(), lit, shade, shapeOf(rand, plain));
    }
  };
  fill(far, FAR_HILL, FAR_SHADE, FAR_HILL, FAR_HILL);
  row(far, 2 + Math.floor(rand() * 8), () => 6 + Math.floor(rand() * 6), () => 4 + Math.floor(rand() * 4), FAR_PINE_LIT, FAR_PINE_SHADE, true);
  fill(mid, MID_HILL, MID_SHADE, MID_RIM, MID_HILL);
  row(mid, 3 + Math.floor(rand() * 8), () => 8 + Math.floor(rand() * 8), () => 6 + Math.floor(rand() * 6), PINE_LIT, PINE_SHADE, false);
  const taken: Rect[] = [];
  // A cabin on the middle ridge, lit windows and a smoking chimney, picked outside the glass; the near hill hides its foot.
  for (let tries = 0; tries < 60; tries++) {
    const x = 4 + Math.floor(rand() * Math.max(1, width - CABIN.width - 8));
    let low = 99;
    for (let dx = 0; dx < CABIN.width; dx++) low = Math.min(low, mid[x + dx] ?? 0);
    const yb = groundTop - low;
    if (!clearOfGlass(layout, x - 1, yb - 32, CABIN.width + 2, 36)) continue;
    cabin(put, x, yb);
    taken.push({ x: x - 3, y: yb - 20, width: CABIN.width + 6, height: 24 });
    break;
  }
  fill(near, NEAR_HILL, NEAR_SHADE, NEAR_RIM, NEAR_SPECK);
  row(near, 5 + Math.floor(rand() * 8), () => 8 + Math.floor(rand() * 9), () => 8 + Math.floor(rand() * 11), PINE_LIT, PINE_SHADE, false);
  // The near hill's characters, each picked outside the glass: a fence with a lantern, a bow and an owl, a bunny, one lit tree with gifts, and some birds.
  const ground = (x: number): number => groundTop - (near[Math.min(width - 1, Math.max(0, x))] ?? 0) + 1;
  // Each character takes a free stretch on alternate sides of the globe, never over another one.
  let side = 0;
  const place = (w: number, h: number, use: (x: number) => void): void => {
    side++;
    for (let tries = 0; tries < 80; tries++) {
      const left = (side + (tries > 40 ? 1 : 0)) % 2 === 0;
      const from = left ? 2 : layout.globe.cx;
      const to = left ? layout.globe.cx - w - 4 : width - w - 3;
      const x = from + Math.floor(rand() * Math.max(1, to - from));
      const box: Rect = { x: x - 2, y: groundTop - h, width: w + 4, height: h + 3 };
      if (!clearOfGlass(layout, box.x, box.y, box.width, box.height)) continue;
      if (taken.some((r) => box.x < r.x + r.width && r.x < box.x + box.width)) continue;
      taken.push(box);
      use(x);
      return;
    }
  };
  place(30, 32, (x) => {
    const tx = x + 14;
    pine(put, tx, ground(tx), 24, PINE_LIT, PINE_SHADE, { tiers: 4, lean: 0, snowy: false, bare: false, bulbs: true });
    topStar(put, tx, ground(tx) - 2 - 24 - 3);
    gifts(put, tx, ground(tx));
  });
  place(40, 22, (x) => fence(put, x, 5, ground));
  // XMAS-96: where the picture is taller than wide and the snow under the base is deep enough (the phone), the bunny sits there instead, with its tracks.
  const low = bunnyBelowBase(layout);
  if (low === null) place(24, 15, (x) => bunny(put, x, ground(x + 6)));
  const bare = (x: number, y: number): boolean => x >= 0 && x < width && y >= top + 3 && y < groundTop - 20 && codes[y * width + x] === 0 && !behindGlass(layout, x, y);
  for (let n = 0; n < 5; n++) {
    const bx = Math.floor(rand() * (width - 12));
    const by = top + 8 + Math.floor(rand() * Math.max(1, groundTop - top - 50));
    const nearDisc = bx < layout.disc.x + layout.disc.width + 4 && bx + 9 > layout.disc.x - 4 && by < layout.disc.y + layout.disc.height + 4 && by + 4 > layout.disc.y - 4;
    if (nearDisc || !clearOfGlass(layout, bx, by, 9, 4)) continue;
    const spots: [number, number][] = [];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 9; dx++) spots.push([bx + dx, by + dy]);
    if (spots.every(([x, y]) => bare(x, y))) bird(put, bx, by);
  }
  floorDetails(layout, rand)(put);
  if (low !== null) bunnyOnSnow(put, low.x, low.bottom);
  return { codes, width };
}

let last: { layout: SceneLayout; backdrop: Backdrop } | undefined;

/** The backdrop for a layout; the last one is kept, as one picture size asks for the same every frame. */
export function backdropFor(layout: SceneLayout): Backdrop {
  if (last?.layout !== layout) last = { layout, backdrop: makeBackdrop(layout) };
  return last.backdrop;
}

/** True where the backdrop has drawn something (so a star may not light there). */
export function covered(backdrop: Backdrop, x: number, y: number): boolean {
  return (backdrop.codes[y * backdrop.width + x] ?? NONE) !== NONE;
}

/** Each code's colour in a phase blend, or -1 where it is clear: a code that is clear in one phase (birds at night) shows up to the middle of a blend with the phase that has it. */
function blendColours(from: PhaseName, to: PhaseName, share: number): number[] {
  const a = [...PALETTE[from], ...EXTRA[from]];
  const b = [...PALETTE[to], ...EXTRA[to]];
  return a.map((c, i) => {
    const d = b[i] ?? c;
    const hex = c === '' || d === '' ? (share < 0.5 ? c : d) : mixHex(c, d, share);
    return hex === '' ? -1 : Number.parseInt(hex.slice(1), 16);
  });
}

/** Draws the plan over the sky in the colours of a phase blend. */
export function paintBackdrop(picture: Uint32Array, backdrop: Backdrop, from: PhaseName, to: PhaseName, share: number): void {
  const colours = blendColours(from, to, share);
  const { codes } = backdrop;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? NONE;
    const colour = colours[code] ?? -1;
    if (code !== NONE && colour >= 0) picture[i] = colour;
  }
}
