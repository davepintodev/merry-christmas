// XMAS-70 "Background too plain in every phase", review findings: the backdrop
// must show where a leaning glass has left, differ from the sky in every phase
// and blend, and keep the sky smooth. Measured on whole frames, no mocks.
import { describe, expect, it } from 'vitest';
import { backdropFor } from './backdrop.ts';
import { CLOUD_BODY, CLOUD_LIT, CLOUD_SHADE, FAR_HILL, FAR_PINE_LIT, FAR_PINE_SHADE, MID_HILL, NEAR_HILL, PINE_LIT, PINE_SHADE } from './backdrop-codes.ts';
import { sceneFrame, sceneLayout, type SceneInput } from './frame.ts';
import { rowShift } from './lean.ts';
import type { PhaseName } from '../shared/clock.ts';

const PHASES: PhaseName[] = ['dawn', 'sunset', 'purple-night', 'frosty-morning'];
const BLENDS: [PhaseName, PhaseName, number][] = [['dawn', 'sunset', 0.5], ['sunset', 'purple-night', 0.4], ['purple-night', 'frosty-morning', 0.5], ['frosty-morning', 'dawn', 0.6]];
const HILLS = [FAR_HILL, MID_HILL, NEAR_HILL];
const PINES = [FAR_PINE_LIT, FAR_PINE_SHADE, PINE_LIT, PINE_SHADE];
const CLOUDS = [CLOUD_LIT, CLOUD_BODY, CLOUD_SHADE];

function input(width: number, height: number, from: PhaseName, to: PhaseName, share: number, extra: Partial<SceneInput> = {}): SceneInput {
  return { time: 0, drag: 0, phase: { from, to, share }, seed: 7, width, height, ...extra };
}

describe('the backdrop behind a leaning glass', () => {
  it.each([[0.5], [-0.5], [0.3]])('shows hills, pines or sky details where the leaned glass has left the upright glass (lean %f, 240 x 180)', (lean) => {
    const base = input(240, 180, 'frosty-morning', 'frosty-morning', 0, { lean });
    const plain = sceneFrame({ ...base, backdrop: false });
    const full = sceneFrame(base);
    const { globe, groundTop, countdown } = full.layout;
    const inner = globe.radius - 0.5;
    let notch = 0;
    let shown = 0;
    for (let y = countdown.height + 2; y < groundTop; y++) {
      const shift = rowShift(lean, groundTop, y);
      for (let x = 0; x < full.width; x++) {
        const dx = x + 0.5 - globe.cx;
        const dy = y + 0.5 - globe.cy;
        if (dx * dx + dy * dy > (globe.radius + 1) ** 2) continue;
        // Still inside the leaned glass: not the notch.
        const from = x - shift + 0.5 - globe.cx;
        if (Math.abs(dy) < inner && Math.abs(from) <= Math.sqrt(inner * inner - dy * dy) + 1) continue;
        notch++;
        if (full.picture[y * full.width + x] !== plain.picture[y * full.width + x]) shown++;
      }
    }
    expect(notch).toBeGreaterThan(0);
    // The backdrop's own pixels (hills, pines, clouds) must show in the space the glass left; today none does.
    expect(shown).toBeGreaterThan(0);
  });

  it('keeps the backdrop outside the glass the same whatever the lean', () => {
    const upright = sceneFrame(input(240, 180, 'dawn', 'dawn', 0, { lean: 0 }));
    const leaned = sceneFrame(input(240, 180, 'dawn', 'dawn', 0, { lean: 0.3 }));
    const { globe, groundTop } = upright.layout;
    for (let y = 0; y < groundTop; y++) {
      for (let x = 0; x < 240; x++) {
        if (Math.abs(x + 0.5 - globe.cx) < globe.radius + 80) continue;
        expect(leaned.picture[y * 240 + x], `${x},${y}`).toBe(upright.picture[y * 240 + x]);
      }
    }
  });
});

describe('the backdrop differs from the sky behind it', () => {
  const cases: [string, PhaseName, PhaseName, number][] = [
    ...PHASES.map((p): [string, PhaseName, PhaseName, number] => [p, p, p, 0]),
    ...BLENDS.map(([a, b, s]): [string, PhaseName, PhaseName, number] => [`${a} to ${b} at ${s}`, a, b, s]),
  ];
  it.each(cases)('has hill, pine and cloud pixels unlike the sky under them in %s', (_name, from, to, share) => {
    const base = input(320, 200, from, to, share);
    const plain = sceneFrame({ ...base, backdrop: false });
    const full = sceneFrame(base);
    const { codes } = backdropFor(full.layout);
    const { groundTop } = full.layout;
    for (const [label, set] of [['hill', HILLS], ['pine', PINES], ['cloud', CLOUDS]] as const) {
      let seen = 0;
      for (let y = 0; y < groundTop; y++) {
        for (let x = 0; x < 320; x++) {
          const code = codes[y * 320 + x] ?? 0;
          if (!set.includes(code)) continue;
          seen++;
          expect(full.picture[y * 320 + x], `${label} at ${x},${y} code ${code}`).not.toBe(plain.picture[y * 320 + x]);
        }
      }
      expect(seen, label).toBeGreaterThan(0);
    }
  });
});

describe('the sky with the backdrop on', () => {
  it.each(PHASES)('stays smooth in %s: open sky pixels are the plain ramp, no dithering, no checkerboard', (phase) => {
    const base = input(320, 200, phase, phase, 0);
    const plain = sceneFrame({ ...base, backdrop: false });
    const full = sceneFrame(base);
    const { codes } = backdropFor(full.layout);
    const stars = new Set(full.layout.stars.map((s) => s.y * 320 + s.x));
    const { groundTop, globe } = full.layout;
    const open = (x: number, y: number): boolean => {
      const dx = x + 0.5 - globe.cx;
      const dy = y + 0.5 - globe.cy;
      return codes[y * 320 + x] === 0 && !stars.has(y * 320 + x) && dx * dx + dy * dy > (globe.radius + 2) ** 2;
    };
    let checked = 0;
    for (let y = 0; y < groundTop; y++) {
      for (let x = 0; x < 320; x++) {
        if (y < 30 && x < 40) continue; // the disc
        if (!open(x, y)) continue;
        checked++;
        expect(full.picture[y * 320 + x], `${x},${y}`).toBe(plain.picture[y * 320 + x]);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // Down a column the colour moves by at most the plain ramp's own step.
    const channel = (c: number, s: number): number => (c >> s) & 255;
    for (let y = 1; y < groundTop; y++) {
      for (const x of [3, 150, 310]) {
        if (!open(x, y) || !open(x, y - 1)) continue;
        for (const s of [0, 8, 16]) {
          const step = Math.abs(channel(plain.picture[y * 320 + x] ?? 0, s) - channel(plain.picture[(y - 1) * 320 + x] ?? 0, s));
          expect(Math.abs(channel(full.picture[y * 320 + x] ?? 0, s) - channel(full.picture[(y - 1) * 320 + x] ?? 0, s))).toBeLessThanOrEqual(step);
        }
      }
    }
  });

  it('shows stars at night, each one art pixel, only on open sky', () => {
    // A star is lit one second and dark the next, so the two frames differ at stars alone (the plain frame has stars too).
    const on = sceneFrame(input(320, 200, 'purple-night', 'purple-night', 0, { time: 0 }));
    const later = sceneFrame(input(320, 200, 'purple-night', 'purple-night', 0, { time: 1000 }));
    const { codes } = backdropFor(on.layout);
    const stars = new Set(on.layout.stars.map((s) => s.y * 320 + s.x));
    const { groundTop, globe } = on.layout;
    let twinkling = 0;
    for (let y = 0; y < groundTop; y++) {
      for (let x = 0; x < 320; x++) {
        const i = y * 320 + x;
        const dx = x + 0.5 - globe.cx;
        const dy = y + 0.5 - globe.cy;
        if (dx * dx + dy * dy <= (globe.radius + 2) ** 2 || (y < 30 && x < 40)) continue;
        if (on.picture[i] === later.picture[i]) continue;
        expect(stars.has(i), `${x},${y} changed but is no star`).toBe(true);
        expect(codes[i], `${x},${y} star over the backdrop`).toBe(0);
        twinkling++;
      }
    }
    expect(twinkling).toBeGreaterThan(5);
  });

  it('leaves the countdown strip plain sky in every phase and blend', () => {
    for (const [from, to, share] of [...PHASES.map((p): [PhaseName, PhaseName, number] => [p, p, 0]), ...BLENDS]) {
      const base = input(130, 260, from, to, share);
      const plain = sceneFrame({ ...base, backdrop: false });
      const full = sceneFrame(base);
      for (let y = 0; y < full.layout.countdown.height; y++) {
        for (let x = 0; x < 130; x++) expect(full.picture[y * 130 + x], `${from} ${to} ${x},${y}`).toBe(plain.picture[y * 130 + x]);
      }
    }
  });

  it.each([[112, 172], [240, 180], [320, 200], [600, 400], [900, 600]])('has hills and pines above the horizon in every phase at %i x %i', (width, height) => {
    for (const phase of PHASES) {
      const plain = sceneFrame(input(width, height, phase, phase, 0, { backdrop: false }));
      const full = sceneFrame(input(width, height, phase, phase, 0));
      const { codes } = backdropFor(full.layout);
      for (const [label, set] of [['hill', HILLS], ['pine', PINES]] as const) {
        let shown = 0;
        for (let y = full.layout.groundTop - 40; y < full.layout.groundTop; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (set.includes(codes[i] ?? 0) && full.picture[i] !== plain.picture[i]) shown++;
          }
        }
        expect(shown, `${phase} ${label}`).toBeGreaterThan(width / 4);
      }
    }
  });

  it('draws a leaning globe with the backdrop on in every phase', () => {
    for (const phase of PHASES) {
      const f = sceneFrame(input(240, 180, phase, phase, 0, { lean: 0.5 }));
      expect(f.picture.length).toBe(240 * 180);
    }
  });
});

void sceneLayout;
