// XMAS-25: the shared clock is built into two separate outputs (the tiny page
// script and the scene bundle). Both copies must give the same phase and time
// left for the same clock reading.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type ClockModule = typeof import('./clock.ts');

const entry = path.resolve(import.meta.dirname, 'clock.ts');
let tmp = '';
let pageCopy: ClockModule;
let sceneCopy: ClockModule;
const originalTZ = process.env['TZ'];

async function buildCopy(name: string, minify: boolean): Promise<ClockModule> {
  const outDir = path.join(tmp, name);
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      minify,
      lib: { entry, formats: ['es'], fileName: () => `${name}.js` },
    },
  });
  return (await import(pathToFileURL(path.join(outDir, `${name}.js`)).href)) as ClockModule;
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'xmas-clock-'));
  pageCopy = await buildCopy('page', true);
  sceneCopy = await buildCopy('scene', false);
}, 60_000);

afterAll(() => {
  if (originalTZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = originalTZ;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('two separate builds of the shared clock', () => {
  it('are separate module instances', () => {
    expect(pageCopy).not.toBe(sceneCopy);
    expect(pageCopy.timeLeft).not.toBe(sceneCopy.timeLeft);
  });

  it.each(['UTC', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles'])(
    'give the same phase and time left for the same readings in %s',
    (tz) => {
      process.env['TZ'] = tz;
      const readings = [
        new Date(2026, 11, 24, 23, 59, 59),
        new Date(2026, 11, 25, 0, 0, 0),
        new Date(2026, 11, 25, 23, 59, 59),
        new Date(2026, 11, 26, 0, 0, 0),
        new Date(2028, 1, 29, 6, 30, 0),
        new Date(2026, 9, 25, 17, 22, 30),
        new Date(2026, 2, 29, 8, 7, 13),
      ];
      for (const now of readings) {
        const a = { left: pageCopy.timeLeft(now), phase: pageCopy.phaseAt(now) };
        const b = { left: sceneCopy.timeLeft(now), phase: sceneCopy.phaseAt(now) };
        expect(a).toEqual(b);
      }
      // Spot-check the copies are not merely agreeing on a wrong answer.
      expect(pageCopy.timeLeft(new Date(2026, 11, 24, 23, 59, 59))).toEqual({
        christmasDay: false,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 1,
      });
      expect(sceneCopy.phaseAt(new Date(2026, 11, 10, 6, 30, 0))).toEqual({
        from: 'purple-night',
        to: 'dawn',
        share: expect.closeTo(0.5, 9),
      });
    },
  );

  it('give the same answers when driven by the same pretend clock', () => {
    process.env['TZ'] = 'UTC';
    let t = 0;
    const pageClock = pageCopy.makeClock('?now=2026-12-24T23:59:50', () => t);
    const sceneClock = sceneCopy.makeClock('?now=2026-12-24T23:59:50', () => t);
    for (let i = 0; i < 12; i++) {
      expect(pageClock().getTime()).toBe(sceneClock().getTime());
      expect(pageCopy.timeLeft(pageClock())).toEqual(sceneCopy.timeLeft(sceneClock()));
      expect(pageCopy.phaseAt(pageClock())).toEqual(sceneCopy.phaseAt(sceneClock()));
      t += 1_000;
    }
    expect(pageCopy.timeLeft(pageClock()).christmasDay).toBe(true);
  });
});
