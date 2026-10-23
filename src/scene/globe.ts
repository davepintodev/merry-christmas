// XMAS-32a "The globe", slice 1: glass, floor tint, base and its lettering.
// The glass (tinted by the phase, with its rim, frost and the window and disc
// reflections that travel round it with the turn), the floor seen through it,
// and the base under it: the whole picture is worked out in code. The base's
// body (base-fine.ts) is drawn at one pixel to an art pixel only where the page
// has no fine layer; with one, the page draws it at the screen's pixel size.
// Nothing outside the globe, its base and the base's shadow changes.
import { masterColours } from '../../art/colours.ts';
import { drawings, type Drawing } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { BASE_FOOT_ROWS, BASE_TOP_ROWS, BASE_WIDTH, renderBase } from './base-fine.ts';
import { blendShade, edgeCoverage } from './blend.ts';
import type { SceneLayout } from './frame.ts';
import { keepBackdrop, leanGlass } from './lean.ts';
import { drawSanta, santaPlacement } from './santa.ts';
import { drawShapes, insidePolygon, SHADOW_FLAT, SHADOW_LEAN, type ShapeParts } from './shapes-draw.ts';
import { floorDisc, globeShapes, projectPoint } from './shapes.ts';
import { renderSnowSteps, type SnowStep } from './snow-draw-list.ts';
import type { GlobeSnow } from './snow.ts';

/** A full turn in radians: the globe's period, negative and whole turns included. */
const FULL_TURN = 2 * Math.PI;
/** How much of the light direction lies across and down the glass: the light comes from the top left. */
const LIGHT_X = 0.4;
const LIGHT_Y = 0.6;
/** The rim's width inwards from the glass's edge, in art pixels. */
const RIM_WIDTH = 2.5;
/** Where the glass starts to thicken towards its edge, as a share of the radius, and over how much of it. */
const THICK_FROM = 0.7;
const THICK_OVER = 0.28;
/** How far the thick glass leans to the light colour on the lit side and to the deep colour on the shaded side. */
const THICK_LIGHT = 0.5;
const THICK_DEEP = 0.6;
/** The long highlight inside the rim at the top left: its outer edge and greatest width as shares of the radius, and the facing it starts at. */
const SHINE_EDGE = 0.9;
const SHINE_WIDTH = 0.1;
const SHINE_FROM = 0.72;
const SHINE_STRENGTH = 0.65;
const SHINE_STEPS = 6;
/** The bounce light inside the rim at the bottom right: its band as shares of the radius, the facing it starts at and its strength. */
const BOUNCE_INNER = 0.8;
const BOUNCE_OUTER = 0.88;
const BOUNCE_FROM = -0.72;
const BOUNCE_STRENGTH = 0.4;
/**
 * The reflections ride on the glass as on a ball: a point of the glass sits at
 * a latitude (up the ball, negative above its middle) and a longitude (round
 * it, zero facing the visitor), and the turn carries them round. Each row is
 * worked out along SUB lines through it, so edges take in-between shades.
 */
const SUB = 4;
/** Reflections only show this far out (as a share of the radius), clear of the rim. */
const REFLECT_REACH = 0.86;
/** The four-pane window: its longitude at turn 0, half-width round the ball, latitude span and the bars between the panes. */
const WINDOW_LON = -0.15;
const WINDOW_HALF = 0.29;
const WINDOW_TOP = -0.8;
const WINDOW_BOTTOM = -0.28;
const WINDOW_BAR = 0.035;
/**
 * The window and doorway lean with the ball's curve, their sides running a
 * little across the rows: a side straight down the rows would cover every row
 * by the same share and so slide as one block of a single in-between shade.
 */
const WINDOW_LEAN = -0.4;
/** Each pane's strength: the top left one is the window's solid core. */
const PANE_STRENGTH: readonly number[] = [1, 0.8, 0.8, 0.6];
/** The lit doorway on the far side of the room, half a turn round from the window: half-width, latitude span and strength. */
const DOOR_HALF = 0.13;
const DOOR_TOP = -0.72;
const DOOR_BOTTOM = -0.1;
const DOOR_STRENGTH = 0.4;
/** The moon or sun glinting on the ball: its longitude from the window, its latitude, its half-height and half-width in radians, and its strength. */
const MIRROR_LON = 1.4;
const MIRROR_LAT = -0.5;
const MIRROR_SIZE = 0.075;
const MIRROR_WIDTH = 0.025;
const MIRROR_STRENGTH = 0.5;
/** Frost specks stuck on the glass: how many, how strongly they show, and the latitudes they keep to. */
const FROST_COUNT = 48;
const FROST_STRENGTH = 0.75;
const FROST_TOP = -0.2;
const FROST_SPAN = 0.95;
/** Frost fades out this far round towards the glass's middle (1 faces the visitor squarely). */
const FROST_FACE = 0.62;
/** The one flat share of the shade the cast shadow puts on the ground, hard-edged. */
const SHADOW_STRENGTH = 0.4;
/** How many columns at each side of the base the cast shadow fades in over, in how many equal steps of strength (XMAS-95). */
const SHADOW_FADE = 11;
const SHADOW_STEPS = 4;
/** The shade the ground falls to in the cast shadow: the darkest sky colour of the master list. */
const SHADOW_INK = 0x1a1433;
/** How many of the base's top rows rise above the horizon, over the glass's foot, so the glass runs behind the gold lip and joins the base. */
export const BASE_SINK = 5;

/**
 * The parts of the glass a phase paints; every colour is a master colour: the
 * body tint, the lit top left, the deep shade of the thick glass at the bottom
 * right, the rim's light, the snow floor's lit top, its shade and the bank
 * under its front edge, the frost specks and the moon or sun mirrored in it.
 */
type GlassPart = 'tint' | 'light' | 'deep' | 'rim' | 'snow' | 'shade' | 'bank' | 'frost' | 'mirror';
type Glass = Record<GlassPart, number>;
const GLASS_PARTS: readonly GlassPart[] = ['tint', 'light', 'deep', 'rim', 'snow', 'shade', 'bank', 'frost', 'mirror'];

/**
 * One phase's glass colours. One light story for every phase: the disc lights
 * the glass's top left and its rim there, the far bottom right falls into the
 * phase's deepest sky shade, and the snow floor takes the ground's own snow
 * and shadow colours outside, so the snow in the globe and on the ground read
 * as the same snow under the same sky.
 */
const PHASE_GLASS: Record<PhaseName, Record<GlassPart, string>> = {
  dawn: {
    tint: '#6a5aa0',
    light: '#cdbde6',
    deep: '#2b225c',
    rim: '#ffe9d0',
    snow: '#fff0f6',
    shade: '#cdbde6',
    bank: '#a874a8',
    frost: '#ffe9ee',
    mirror: '#ffe9d0',
  },
  'frosty-morning': {
    tint: '#7fb6e6',
    light: '#e2f1fd',
    deep: '#5f86b0',
    rim: '#ffffff',
    snow: '#ffffff',
    shade: '#c4d8f0',
    bank: '#9fb8dc',
    frost: '#ffffff',
    mirror: '#fff3b0',
  },
  sunset: {
    tint: '#5a2a6a',
    light: '#e0637a',
    deep: '#3a1f4a',
    rim: '#ffe9d0',
    snow: '#ffe9ee',
    shade: '#e8b4c8',
    bank: '#b07a9a',
    frost: '#ffd9e6',
    mirror: '#ffd9c8',
  },
  'purple-night': {
    tint: '#1d3350',
    light: '#3d6a8a',
    deep: '#0b1026',
    rim: '#7fb6e6',
    snow: '#dfe6ff',
    shade: '#aab6e6',
    bank: '#7f8ac8',
    frost: '#d6e6f8',
    mirror: '#d6e6f8',
  },
};

/** A '#rrggbb' colour as its 0xRRGGBB number. */
function colourNumber(colour: string): number {
  return Number.parseInt(colour.slice(1), 16);
}

/** One reading's glass: each phase colour mixed by the blend's share. */
function glassOf(reading: PhaseReading): Glass {
  const from = PHASE_GLASS[reading.from];
  const to = PHASE_GLASS[reading.to];
  const out = {} as Glass;
  for (const part of GLASS_PARTS) out[part] = blendShade(colourNumber(from[part]), colourNumber(to[part]), reading.share);
  return out;
}

/** The turn folded into [0, 2π): negative turns and whole turns draw the same picture as turn 0. */
function wrapTurn(turn: number): number {
  return ((turn % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** 0 at 0 and below, 1 at 1 and above, on a straight share. */
function clamp(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** A colour's channels, unrounded. */
type Rgb = readonly [number, number, number];

function rgbOf(colour: number): Rgb {
  return [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
}

/** The colour `t` (0..1) of the way from a to b, unrounded. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Channels rounded once into 0xRRGGBB. */
function packRgb(c: Rgb): number {
  return (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
}

/** u eased in and out between 0 and 1, so a blend shows no corner. */
function smooth(u: number): number {
  const t = clamp(u);
  return t * t * (3 - 2 * t);
}

/** How squarely a point of the glass faces the disc at the top left: 1 facing it, -1 facing away. */
function facing(dx: number, dy: number, d: number): number {
  return (-dx - dy) / (Math.SQRT2 * Math.max(d, 1e-6));
}

/** A step towards the visitor moves a floor point this far down the picture, as the shapes tilt it. */
const TILT = projectPoint(0, 1, 0, 0)[1] - projectPoint(0, 0, 0, 0)[1];

/**
 * The glass and the snow floor inside it: a smooth tint lit from the top left;
 * the snow, a level disc seen from a little above (an ellipse, whose rim meets
 * the glass) over a bank of snow filling the glass below it; the glass
 * thickening towards its edge, lit at the top left and deep at the bottom
 * right; and the rim catching the light. Everything is smooth tones, each edge
 * an in-between shade, all inside the globe's circle.
 */
function paintGlass(picture: Uint32Array, width: number, layout: SceneLayout, glass: Glass): void {
  // The glass does not depend on the turn: it is worked out once for a picture size and glass colours, then copied.
  const { cx, cy, radius } = layout.globe;
  const key = [width, layout.height, cx, cy, radius, ...GLASS_PARTS.map((part) => glass[part])].join(',');
  if (glassCache === null || glassCache.key !== key) {
    const flat = new Int32Array(width * layout.height).fill(-1);
    const scratch = new Uint32Array(width * layout.height);
    scratch.fill(0xffffffff);
    paintGlassPixels(scratch, width, layout, glass);
    for (let i = 0; i < scratch.length; i++) if (scratch[i] !== 0xffffffff) flat[i] = scratch[i] ?? 0;
    glassCache = { key, flat };
  }
  const flat = glassCache.flat;
  const top = Math.max(0, Math.floor(cy - radius)) * width;
  const bottom = Math.min(layout.height, Math.ceil(cy + radius) + 1) * width;
  for (let i = top; i < bottom; i++) {
    const colour = flat[i] ?? -1;
    if (colour >= 0) picture[i] = colour;
  }
}

/** The glass pixels last worked out, with what they were worked out for. */
let glassCache: { key: string; flat: Int32Array } | null = null;

function paintGlassPixels(picture: Uint32Array, width: number, layout: SceneLayout, glass: Glass): void {
  const { cx, cy, radius } = layout.globe;
  const inner = radius - 0.5;
  const rimInner = radius - RIM_WIDTH;
  // The snow's level disc reaches the glass: its half-width is the glass's at the floor's depth.
  const floorY = floorDisc.y;
  const snowX = Math.sqrt(Math.max(1, (radius - 1) ** 2 - floorY * floorY));
  const snowY = snowX * TILT;
  // Worked in unrounded channels and rounded once per pixel: rounding every
  // step would wobble the smooth tones into a 2 x 2 dither.
  const g = {} as Record<GlassPart, Rgb>;
  for (const part of GLASS_PARTS) g[part] = rgbOf(glass[part]);
  const rimMid = mix(g.tint, g.rim, 0.45);
  const top = Math.max(0, Math.floor(cy - radius));
  const bottom = Math.min(layout.height - 1, Math.ceil(cy + radius));
  const left = Math.max(0, Math.floor(cx - radius));
  const right = Math.min(width - 1, Math.ceil(cx + radius));
  for (let y = top; y <= bottom; y++) {
    const dy = y + 0.5 - cy;
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.hypot(dx, dy);
      if (d > inner) continue;
      // The body: the light comes from the top left, so the glass falls away
      // towards the bottom right. The light's two terms only ever grow left to
      // right and top to bottom, so no 2 x 2 block can come out as a dither.
      const lit = clamp((radius - (dx * LIGHT_X + dy * LIGHT_Y)) / (2 * radius));
      let colour = mix(g.tint, g.light, lit);
      // The snow floor: how far out of the level disc's ellipse the pixel lies, in pixels.
      const ex = dx / snowX;
      const ey = (dy - floorY) / snowY;
      const f = ex * ex + ey * ey - 1;
      const slope = 2 * Math.hypot(ex / snowX, ey / snowY);
      const outside = f / Math.max(slope, 1e-6);
      // The level top: lit at the back and left, shading towards the front and right.
      const depth = clamp((ey + 1) / 2);
      const top = mix(g.snow, g.shade, smooth(0.1 + 0.75 * depth * depth + 0.3 * ex));
      if (dy < floorY) {
        // Above the floor's middle only the ellipse's back half is snow.
        colour = mix(colour, top, clamp(0.5 - outside));
      } else {
        // Below it the snow fills the glass: the top in the ellipse, the bank under its front edge, darkening down the glass.
        const down = clamp((dy - floorY - snowY * Math.sqrt(Math.max(0, 1 - ex * ex))) / (radius - floorY - snowY * 0.5));
        const bank = mix(g.shade, g.bank, smooth(0.25 + 0.75 * down));
        colour = mix(bank, top, clamp(0.5 - outside));
      }
      // The glass thickens towards its edge: light where it faces the disc, deep where it faces away.
      const thick = clamp((d / radius - THICK_FROM) / THICK_OVER) ** 2;
      const face = facing(dx, dy, d);
      if (face > 0) colour = mix(colour, g.light, thick * THICK_LIGHT * smooth(face / 0.6));
      else colour = mix(colour, g.deep, thick * THICK_DEEP * smooth(-face / 0.6));
      // The rim: a solid edge, bright where it faces the light, deep where it faces away.
      if (d > rimInner) {
        colour = face >= 0 ? mix(rimMid, g.rim, smooth(face / 0.6)) : mix(rimMid, g.deep, smooth(-face / 0.6) * 0.8);
      }
      picture[y * width + x] = packRgb(colour);
    }
  }
}

/** An angle folded into [-π, π). */
function wrapAngle(a: number): number {
  return a - FULL_TURN * Math.floor((a + Math.PI) / FULL_TURN);
}

/**
 * Lays `colour` over one pixel by `share`. A share so thin it would move the
 * pixel by at most one step of every channel is passed over: over the glass's
 * gradient such a step rounds into a 2 x 2 dither.
 */
function lay(picture: Uint32Array, index: number, colour: number, share: number): void {
  const under = picture[index] ?? 0;
  const drawn = blendShade(under, colour, share);
  const step = (shift: number): boolean => Math.abs(((drawn >> shift) & 0xff) - ((under >> shift) & 0xff)) <= 1;
  if (share < 1 && step(16) && step(8) && step(0)) return;
  picture[index] = drawn;
}

/** The frost specks' places on the ball at turn 0: latitude and longitude, fixed for every frame. */
const FROST: readonly (readonly [number, number])[] = ((): (readonly [number, number])[] => {
  let state = 0x2f6b;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: FROST_COUNT }, () => [FROST_TOP + next() * FROST_SPAN, next() * FULL_TURN] as const);
})();

/** One travelling reflection's stretch along one latitude: its longitudes (from the window's), its strength and its colour (0 the sheen, 1 the mirror). */
type Stretch = readonly [number, number, number, 0 | 1];

/** The stretches of the four-pane window, the lit doorway half a turn round from it, and the moon or sun, along latitude `lat`. */
function stretchesAt(lat: number): Stretch[] {
  const out: Stretch[] = [];
  const mid = (WINDOW_TOP + WINDOW_BOTTOM) / 2;
  if (lat > WINDOW_TOP && lat < WINDOW_BOTTOM && Math.abs(lat - mid) > WINDOW_BAR) {
    const upper = lat < mid;
    const lean = WINDOW_LEAN * (lat - mid);
    out.push([lean - WINDOW_HALF, lean - WINDOW_BAR, PANE_STRENGTH[upper ? 0 : 2] ?? 0, 0]);
    out.push([lean + WINDOW_BAR, lean + WINDOW_HALF, PANE_STRENGTH[upper ? 1 : 3] ?? 0, 0]);
  }
  if (lat > DOOR_TOP && lat < DOOR_BOTTOM) {
    const lean = WINDOW_LEAN * (lat - (DOOR_TOP + DOOR_BOTTOM) / 2);
    out.push([Math.PI + lean - DOOR_HALF, Math.PI + lean + DOOR_HALF, DOOR_STRENGTH, 1]);
  }
  const off = lat - MIRROR_LAT;
  if (Math.abs(off) < MIRROR_SIZE) {
    const lean = WINDOW_LEAN * off;
    const half = (MIRROR_WIDTH * Math.sqrt(1 - (off / MIRROR_SIZE) ** 2)) / Math.cos(lat);
    out.push([MIRROR_LON + lean - half, MIRROR_LON + lean + half, MIRROR_STRENGTH, 1]);
  }
  return out;
}

/**
 * The reflections that travel round the glass with the turn, row by row: each
 * of SUB lines through a row crosses the ball at one latitude, where every
 * reflection is a stretch of longitudes, so a whole span of the row; each
 * pixel takes the share of every span that covers it. Their edges fall exactly
 * where the ball puts them, so they slide on the grid and curve with the ball.
 */
function paintTravelling(picture: Uint32Array, width: number, layout: SceneLayout, sheen: number, mirror: number, turn: number): void {
  const { cx, cy, radius } = layout.globe;
  const reach = radius * REFLECT_REACH;
  const left = Math.max(0, Math.floor(cx - reach));
  const right = Math.min(width - 1, Math.ceil(cx + reach));
  const shares = [new Float64Array(right - left + 1), new Float64Array(right - left + 1)];
  const centre = WINDOW_LON - turn;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(layout.height - 1, cy + reach); y++) {
    for (const row of shares) row.fill(0);
    let any = false;
    for (let j = 0; j < SUB; j++) {
      const dy = y + (j + 0.5) / SUB - cy;
      if (Math.abs(dy) >= reach) continue;
      const lat = Math.asin(dy / radius);
      const ring = radius * Math.cos(lat);
      const edge = Math.sqrt(reach * reach - dy * dy);
      for (const [from, to, strength, which] of stretchesAt(lat)) {
        // Brought round to the visitor's half of the ball, where longitudes run -π/2 to π/2.
        const start = wrapAngle(centre + from);
        for (const shift of [0, -FULL_TURN]) {
          const a = Math.max(-Math.PI / 2, start + shift);
          const b = Math.min(Math.PI / 2, start + shift + (to - from));
          if (b <= a) continue;
          const x0 = cx + Math.max(-edge, ring * Math.sin(a));
          const x1 = cx + Math.min(edge, ring * Math.sin(b));
          if (x1 <= x0) continue;
          const out = shares[which] as Float64Array;
          for (let x = Math.max(left, Math.floor(x0)); x <= Math.min(right, Math.ceil(x1)); x++) {
            out[x - left] = (out[x - left] ?? 0) + (strength * (edgeCoverage(x1, x) - edgeCoverage(x0, x))) / SUB;
          }
          any = true;
        }
      }
    }
    if (!any) continue;
    for (let x = left; x <= right; x++) {
      const index = y * width + x;
      const a = shares[0]?.[x - left] ?? 0;
      const b = shares[1]?.[x - left] ?? 0;
      if (a > 0) lay(picture, index, sheen, a);
      if (b > 0) lay(picture, index, mirror, b);
    }
  }
}

/**
 * Rounding the smooth tones to whole channel steps can, very rarely, leave a
 * 2 x 2 block of two colours one step apart in a checkerboard where an edge
 * shade meets the gradient. Such a block is evened out by giving its top right
 * pixel its top left neighbour's colour: a one-step change no eye can see.
 */
function evenOut(picture: Uint32Array, width: number, layout: SceneLayout): void {
  const { cx, cy, radius } = layout.globe;
  const inner = radius - RIM_WIDTH;
  for (let y = Math.max(0, Math.floor(cy - inner)); y < Math.min(layout.height - 1, cy + inner); y++) {
    for (let x = Math.max(0, Math.floor(cx - inner)); x < Math.min(width - 1, cx + inner); x++) {
      if (Math.hypot(x + 1 - cx, y + 1 - cy) > inner - 1) continue;
      const i = y * width + x;
      const a = picture[i] ?? 0;
      const b = picture[i + 1] ?? 0;
      if (a !== b && a === picture[i + width + 1] && b === picture[i + width]) picture[i + 1] = a;
    }
  }
}

/**
 * What lies on the glass itself, painted under Santa and the shapes so their own colours never tint: the long highlight
 * inside the rim at the top left and the bounce light at the bottom right,
 * which stay with the disc, and the reflections and frost, which travel round
 * with the turn. Each pixel takes the in-between shade the share of it each
 * covers asks for, so they slide on the fixed grid like the lettering.
 */
function paintReflections(picture: Uint32Array, width: number, layout: SceneLayout, glass: Glass, turn: number): void {
  const { cx, cy, radius } = layout.globe;
  const sheen = blendShade(glass.light, 0xffffff, 0.8);
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(layout.height - 1, cy + radius); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, cx + radius); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius - RIM_WIDTH) continue;
      const index = y * width + x;
      const n = d / radius;
      const face = facing(dx, dy, d);
      // The long highlight: widest where the glass faces the disc squarely, tapering to nothing.
      const shine = clamp((face - SHINE_FROM) / (1 - SHINE_FROM));
      if (shine > 0) {
        const innerEdge = radius * (SHINE_EDGE - SHINE_WIDTH * shine);
        const cover = clamp(radius * SHINE_EDGE + 0.5 - d) * clamp(d - innerEdge + 0.5);
        // The highlight is a flat tone in a few steps, not a tint of the gradient under it: tinting the gradient rounds into a dither.
        const level = Math.round(SHINE_STRENGTH * smooth(shine * 3) * SHINE_STEPS) / SHINE_STEPS;
        const tone = blendShade(glass.light, 0xffffff, level);
        const share = Math.round(cover * SHINE_STEPS) / SHINE_STEPS;
        if (share > 0 && level > 0) picture[index] = blendShade(picture[index] ?? 0, tone, share);
      }
      const bounce = clamp((BOUNCE_FROM - face) / 0.2);
      if (bounce > 0 && n > BOUNCE_INNER - 0.02 && n < BOUNCE_OUTER + 0.02) {
        const cover = clamp(radius * BOUNCE_OUTER + 0.5 - d) * clamp(d - radius * BOUNCE_INNER + 0.5);
        if (cover > 0) picture[index] = blendShade(picture[index] ?? 0, glass.light, cover * bounce * BOUNCE_STRENGTH);
      }
    }
  }
  paintTravelling(picture, width, layout, sheen, glass.mirror, turn);
  evenOut(picture, width, layout);
  // Frost stuck on the glass, on the near side only: each speck spread over the four pixels it overlaps.
  for (const [lat, lon] of FROST) {
    const around = lon - turn;
    const ring = Math.cos(lat);
    const near = ring * Math.cos(around);
    // Frost shows towards the glass's edge, where the glass is thick, and fades out across its face.
    if (near < 0.25 || near > FROST_FACE) continue;
    const fx = cx + ring * Math.sin(around) * (radius - 3) - 0.5;
    const fy = cy + Math.sin(lat) * (radius - 3) - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const strength = FROST_STRENGTH * smooth((near - 0.25) / 0.15) * smooth((FROST_FACE - near) / 0.15);
    for (const [x, y, share] of [[x0, y0, (1 - ax) * (1 - ay)], [x0 + 1, y0, ax * (1 - ay)], [x0, y0 + 1, (1 - ax) * ay], [x0 + 1, y0 + 1, ax * ay]] as const) {
      if (x < 0 || y < 0 || x >= width || y >= layout.height || share <= 0) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius - RIM_WIDTH) continue;
      const index = y * width + x;
      lay(picture, index, glass.frost, share * strength);
    }
  }
}

/**
 * The upright glass as drawGlobe paints it at `turn`: the tint, the snow floor
 * and the rim, then the reflections that travel round with the turn. Only the
 * glass's own pixels are written; each is opaque, and the rest of the picture
 * is left as it is.
 */
export function paintUprightGlass(picture: Uint32Array, width: number, layout: SceneLayout, phase: PhaseReading, turn: number): void {
  const glass = glassOf(phase);
  paintGlass(picture, width, layout, glass);
  // The reflections lie on the glass, but under Santa and the shapes, whose own colours never tint.
  paintReflections(picture, width, layout, glass, wrapTurn(turn));
}

/**
 * Where the glass stands, the picture takes `under`'s pixels (the picture with
 * the open backdrop, as pictureWithOpenBackdrop gives it), so the backdrop shows
 * once the glass is apart (XMAS-92a). That is the backdrop's clip disc, one
 * pixel beyond the glass's edge (behindGlass in backdrop.ts), above the ground
 * line; under the base's top rows the backdrop stays clipped, as it is there,
 * so the picture keeps the sky the base's lip stands on.
 */
function openGlassSpace(picture: Uint32Array, width: number, layout: SceneLayout, under: Uint32Array): void {
  const { cx, cy, radius } = layout.globe;
  const reach = radius + 1;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(layout.height - 1, Math.ceil(cy + reach), layout.groundTop - 1); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(width - 1, Math.ceil(cx + reach)); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (Math.abs(dx) <= BASE_WIDTH / 2 && y >= layout.groundTop - BASE_SINK) continue;
      picture[y * width + x] = under[y * width + x] ?? 0;
    }
  }
}

/**
 * The cells of the base's cast shadow, in art pixels from the base box's top
 * left, found once: the shadow never moves with the turn. It is the ground
 * inside a ring the drum throws (shapes-draw.ts lean and flat): the drum's foot
 * from left to right, then each column's top cast back to the left. So the
 * shade follows the rounded foot, is deepest under the middle and steps at the
 * top's corners, and has no holes where the foot steps.
 */
const CAST_CELLS: readonly (readonly [number, number])[] = ((): [number, number][] => {
  const feet = BASE_FOOT_ROWS.map((foot, c): [number, number] => [c + 0.5, foot]);
  const tops = BASE_FOOT_ROWS.map((foot, c): [number, number] => {
    const height = foot - (BASE_TOP_ROWS[c] ?? 0);
    return [c + 0.5 + SHADOW_LEAN * height, foot + SHADOW_FLAT * height];
  }).reverse();
  const ring = [...feet, ...tops];
  const ys = ring.map(([, y]) => y);
  const cells: [number, number][] = [];
  // Only the base's own columns: the shade never falls past the base's sides.
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = 0; x < BASE_WIDTH; x++) {
      if (insidePolygon(ring, x + 0.5, y + 0.5)) cells.push([x, y]);
    }
  }
  return cells;
})();

/**
 * The globe and its base cast a shadow on the ground under the base, leaning
 * right and down the way the shapes' shadows are cast (CAST_CELLS). It is one
 * flat hard-edged shade over ground rows only (the sky stays as it is), clamped
 * to the base's own span, and does not change with the turn; the base is drawn
 * over it.
 */
function paintCastShadow(picture: Uint32Array, width: number, layout: SceneLayout, boxX: number, boxY: number): void {
  for (const [x, y] of CAST_CELLS) {
    const px = boxX + x;
    const py = boxY + y;
    if (px < 0 || px >= width || py < layout.groundTop || py >= layout.height) continue;
    // XMAS-95: over its last columns at each side of the base the shade steps up from a quarter of its strength, so it
    // fades into the snow and does not stop on a hard vertical line.
    const fade = Math.ceil((Math.min(1, (Math.min(x, BASE_WIDTH - 1 - x) + 1) / (SHADOW_FADE + 1))) * SHADOW_STEPS) / SHADOW_STEPS;
    picture[py * width + px] = blendShade(picture[py * width + px] ?? 0, SHADOW_INK, SHADOW_STRENGTH * fade);
  }
}

/**
 * The base at (boxX, boxY): its shadow on the snow under it, then, when the picture is to hold it (the fine layer
 * draws it on the page, at the screen's pixel size, otherwise), the base itself at one pixel to an art pixel.
 */
function paintBase(picture: Uint32Array, width: number, boxX: number, boxY: number, turn: number, body: boolean): void {
  if (body) renderBase(picture, width, boxX, boxY, 1, turn);
}

/** The flakes as draw steps (snowDrawList): those behind the glass centre, and those in front. */
export interface SnowFlakes {
  behind: readonly SnowStep[];
  front: readonly SnowStep[];
}

/** What a layer's colour-number buffer holds where nothing was drawn (XMAS-81): no colour number is this. */
export const NO_FRONT = 0xffffffff;

/**
 * Draws the globe centred on layout.globe, Santa flying round inside it at `time` (ms), leaning by `lean` radians (0 stands it upright), and its base under it, into picture (width art pixels across). `parts` of 'shadows' leaves the shapes' bodies out, and Santa with them, and 'none' the floor shadows too, as the page's fine layer draws them (XMAS-80, XMAS-82, XMAS-83). `snow` is not drawn here: the page draws the flakes as steps on the screen's pixel grid (XMAS-84), so the picture is the same with or without it. `flakes`, when given, are drawn into `picture` at one pixel to an art pixel before the lean, so it shifts them with the glass: the ones behind under Santa and the shapes, the ones in front over them (the page's fallback without a fine layer). `leanUnder`, for a lean, is the picture with the open backdrop, to show where the glass has left (see keepBackdrop). `glassApart` (XMAS-92a) leaves the glass out, and the lean with it: the glass is drawn as a layer of its own (glass-layer.ts), and `leanUnder` shows the backdrop where it stands.
 */
export function drawGlobe(
  picture: Uint32Array,
  width: number,
  layout: SceneLayout,
  phase: PhaseReading,
  turn: number,
  time: number,
  snow?: GlobeSnow,
  lean = 0,
  parts: ShapeParts = 'all',
  flakes?: SnowFlakes,
  leanUnder?: Uint32Array,
  glassApart = false,
): void {
  const base = drawings['base'];
  if (base === undefined) throw new Error('the Base sheet has no base drawing');
  const spin = wrapTurn(turn);
  const boxX = layout.globe.cx - base.width / 2;
  const boxY = layout.groundTop - BASE_SINK;
  const isBehind = santaPlacement(spin, time).depth <= 0;
  // Apart, the glass is a layer of its own (glass-layer.ts) and does not lean: the open backdrop shows where it stands.
  if (glassApart) {
    if (leanUnder !== undefined) openGlassSpace(picture, width, layout, leanUnder);
  } else {
    if (lean !== 0) keepBackdrop(picture, width, layout, leanUnder);
    paintUprightGlass(picture, width, layout, phase, turn);
  }
  if (flakes !== undefined) renderSnowSteps(picture, width, layout, flakes.behind, 1);
  // Santa is drawn with the bodies here (XMAS-83); without them he is a sprite step for the page's fine layer, so he is left out.
  const bodies = parts === 'all';
  if (bodies && isBehind) drawSanta(picture, width, layout, spin, time);
  drawShapes(picture, width, layout, phase, spin, globeShapes, parts);
  if (bodies && !isBehind) drawSanta(picture, width, layout, spin, time);
  if (flakes !== undefined) renderSnowSteps(picture, width, layout, flakes.front, 1);
  if (!glassApart && lean !== 0) leanGlass(picture, width, layout, lean);
  paintCastShadow(picture, width, layout, boxX, boxY);
  paintBase(picture, width, boxX, boxY, spin, bodies);
}
