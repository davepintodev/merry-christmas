// XMAS-28 "Rough art for the remaining sheets" part 1: the drawn sheets
// house.png, santa.png, props.png, base.png and buttons.png at rough level.
// Every check reads the real art/sheets through the art build, run here into
// a temp dir so the committed outputs are never touched.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { maxColoursPerObject, objects, type ArtObject } from '../../art/objects.ts';
import { sheets } from '../../art/sheets.ts';
import { ArtBuildError, buildArt, type SheetSpec } from '../../tools/art.ts';
import { decodePng, encodePng } from '../../tools/png.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHEETS_DIR = path.join(ROOT, 'art', 'sheets');
const NEW_SHEET_FILES = ['house.png', 'santa.png', 'props.png', 'base.png', 'buttons.png'] as const;

/** Sanity cap on the Brotli size of the packed art module, in bytes. */
const ART_MODULE_BROTLI_CAP = 40_000;
/** Sanity cap on the raw size of the packed art module, in bytes. */
const ART_MODULE_RAW_CAP = 40_000 * 4;

/** Objects that are solid surfaces: they must fill at least 30% of their box and touch all four edges. */
const SOLID = /^(house-wall-|house-roof-|base$)/;
const SOLID_COVER = 0.3;
const OTHER_COVER = 0.1;
/** Outline pixels must be darker than this relative luminance. */
const OUTLINE_LUMINANCE = 0.2;
/** Documented in art/STYLE.md: Santa is only 6 rows tall; the rest are thin details. */
const OUTLINE_EXEMPT: ReadonlySet<string> = new Set([
  'santa-trot-1',
  'santa-trot-2',
  'snowman-arms',
  'snowman-scarf',
  'snowman-face',
  'lamp-post',
  'disc',
]);

type Drawing = { sheet: string; x: number; y: number; width: number; height: number; pixels: Uint8Array };

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'xmas-rough-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the call to throw');
}

function buildInto(dir: string, sheetsDir: string, list: readonly SheetSpec[] = sheets) {
  const out = { moduleFile: path.join(dir, 'art.generated.ts'), gplFile: path.join(dir, 'xmas.gpl') };
  buildArt({ sheets: list, sheetsDir, palette: masterColours, ...out, gplName: 'XMAS' });
  return out;
}

let built: { error?: unknown; moduleText: string; drawings: Record<string, Drawing> } = { moduleText: '', drawings: {} };

beforeAll(async () => {
  const dir = tempDir();
  try {
    const out = buildInto(dir, SHEETS_DIR);
    const moduleText = readFileSync(out.moduleFile, 'utf8');
    const mod = (await import(/* @vite-ignore */ pathToFileURL(out.moduleFile).href)) as { drawings: Record<string, Drawing> };
    built = { moduleText, drawings: mod.drawings };
  } catch (error) {
    built = { error, moduleText: '', drawings: {} };
  }
});

function drawingOf(o: ArtObject): Drawing {
  expect(built.error, String(built.error)).toBeUndefined();
  const d = built.drawings[o.name];
  if (!d) throw new Error(`the build packed no drawing named ${o.name}`);
  return d;
}

function allObjects(): readonly ArtObject[] {
  expect(objects.length, 'the object list is empty').toBeGreaterThan(0);
  return objects;
}

describe('the art build on the real sheets', () => {
  it('passes: every sheet is its fixed size and uses only master-list colours', () => {
    expect(built.error, String(built.error)).toBeUndefined();
    for (const f of NEW_SHEET_FILES) expect(sheets.map((s) => s.file), f).toContain(f);
  });

  it('packs every object from its own sheet at its own size', () => {
    for (const o of allObjects()) {
      const d = drawingOf(o);
      expect(d.sheet, o.name).toBe(`${o.sheet}.png`);
      expect([d.width, d.height], o.name).toEqual([o.width, o.height]);
      expect(d.pixels.length, o.name).toBe(o.width * o.height);
    }
  });
});

describe('rough drawings', () => {
  it('draws every object: at least one opaque pixel', () => {
    for (const o of allObjects()) expect(drawingOf(o).pixels.some((p) => p !== 0), `${o.name} is blank`).toBe(true);
  });

  it('fills at least 30% of the box for walls, roofs and the base, and at least 10% for every other object', () => {
    const solids = allObjects().filter((o) => SOLID.test(o.name));
    expect(solids.length).toBe(7); // four walls, two roofs, the base
    for (const o of allObjects()) {
      const px = drawingOf(o).pixels;
      const cover = px.filter((p) => p !== 0).length / px.length;
      const need = SOLID.test(o.name) ? SOLID_COVER : OTHER_COVER;
      expect(cover, `${o.name} covers ${(cover * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(need);
    }
  });

  it('uses no more than maxColoursPerObject distinct colours in any object', () => {
    expect(maxColoursPerObject).toBeGreaterThan(0);
    for (const o of allObjects()) {
      const used = new Set(Array.from(drawingOf(o).pixels).filter((p) => p !== 0));
      expect(used.size, `${o.name} uses ${used.size} colours`).toBeLessThanOrEqual(maxColoursPerObject);
    }
  });

  it('uses only colour numbers that exist in the master list', () => {
    for (const o of allObjects()) {
      for (const p of drawingOf(o).pixels) expect(p, o.name).toBeLessThanOrEqual(masterColours.length);
    }
  });

  it('draws walls, roofs and the base out to all four edges of their box', () => {
    for (const o of allObjects().filter((x) => SOLID.test(x.name))) {
      const { pixels, width: w, height: h } = drawingOf(o);
      const at = (x: number, y: number) => pixels[y * w + x] ?? 0;
      const row = (y: number) => Array.from({ length: w }, (_, x) => at(x, y)).some((p) => p !== 0);
      const col = (x: number) => Array.from({ length: h }, (_, y) => at(x, y)).some((p) => p !== 0);
      expect(row(0), `${o.name}: top row empty`).toBe(true);
      expect(row(h - 1), `${o.name}: bottom row empty`).toBe(true);
      expect(col(0), `${o.name}: left column empty`).toBe(true);
      expect(col(w - 1), `${o.name}: right column empty`).toBe(true);
    }
  });

  it('draws the two frames of each pair differently', () => {
    const pairs = [
      ['santa-trot-1', 'santa-trot-2'],
      ['speaker-muted', 'speaker-on'],
      ['pause-bars', 'pause-triangle'],
      ['house-wall-front', 'house-wall-back'],
    ] as const;
    expect(built.error, String(built.error)).toBeUndefined();
    for (const [a, b] of pairs) {
      const pa = built.drawings[a]?.pixels;
      const pb = built.drawings[b]?.pixels;
      expect(pa && pb, `${a} / ${b} missing`).toBeTruthy();
      expect(Array.from(pa ?? []).join(','), `${a} and ${b} are the same drawing`).not.toBe(Array.from(pb ?? []).join(','));
    }
  });
});

describe('the outline rule', () => {
  /** Relative luminance (WCAG) of a #rrggbb colour. */
  function luminance(hex: string): number {
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  it('the outline threshold separates the dark master colours from snow white', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#0b1026')).toBeLessThan(OUTLINE_LUMINANCE);
    expect(masterColours.filter((c) => luminance(c) < OUTLINE_LUMINANCE).length).toBeGreaterThan(0);
  });

  it('outlines every object that is not a wall, roof, the base or a documented exemption in a dark master colour', () => {
    const outlined = allObjects().filter((o) => !SOLID.test(o.name) && !OUTLINE_EXEMPT.has(o.name));
    expect(outlined.map((o) => o.name)).toContain('pine-1');
    expect(outlined.map((o) => o.name)).toContain('shake-frame');
    const offenders: string[] = [];
    for (const o of outlined) {
      const { pixels, width: w, height: h } = drawingOf(o);
      const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (pixels[y * w + x] ?? 0));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const n = at(x, y);
          if (n === 0) continue;
          const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
          const hex = masterColours[n - 1] ?? '#ffffff';
          if (edge && luminance(hex) >= OUTLINE_LUMINANCE) {
            offenders.push(`${o.name} at ${x},${y} is ${hex}`);
            break;
          }
        }
        if (offenders.at(-1)?.startsWith(`${o.name} `)) break;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exempts only objects that exist in the object list', () => {
    const names = new Set(allObjects().map((o) => o.name));
    for (const n of OUTLINE_EXEMPT) expect(names.has(n), n).toBe(true);
  });
});

describe('the build stops on a new sheet drawn at the wrong size', () => {
  /** A temp copy of art/sheets with one sheet replaced by a re-encoded copy grown or shrunk by dw x dh. */
  function resizedCopy(file: string, dw: number, dh: number): string {
    const dir = tempDir();
    const sheetsDir = path.join(dir, 'sheets');
    mkdirSync(sheetsDir, { recursive: true });
    for (const s of sheets) {
      const src = path.join(SHEETS_DIR, s.file);
      if (existsSync(src)) copyFileSync(src, path.join(sheetsDir, s.file));
    }
    const src = path.join(SHEETS_DIR, file);
    expect(existsSync(src), `art/sheets/${file} must exist`).toBe(true);
    const img = decodePng(new Uint8Array(readFileSync(src)));
    const w = img.width + dw;
    const h = img.height + dh;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < Math.min(h, img.height); y++) {
      for (let x = 0; x < Math.min(w, img.width); x++) {
        rgba.set(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (y * w + x) * 4);
      }
    }
    writeFileSync(path.join(sheetsDir, file), encodePng(w, h, rgba));
    return sheetsDir;
  }

  for (const file of NEW_SHEET_FILES) {
    it(`${file} one column wider: ArtBuildError naming ${file}, nothing written`, () => {
      const sheetsDir = resizedCopy(file, 1, 0);
      const out = tempDir();
      const err = caught(() => buildInto(out, sheetsDir));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain(file);
      expect(existsSync(path.join(out, 'art.generated.ts'))).toBe(false);
      expect(existsSync(path.join(out, 'xmas.gpl'))).toBe(false);
    });
  }

  it('buttons.png one row shorter: ArtBuildError naming buttons.png', () => {
    const sheetsDir = resizedCopy('buttons.png', 0, -1);
    const err = caught(() => buildInto(tempDir(), sheetsDir));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('buttons.png');
  });

  it('a missing props.png: ArtBuildError naming props.png', () => {
    const sheetsDir = resizedCopy('props.png', 0, 0);
    rmSync(path.join(sheetsDir, 'props.png'));
    const err = caught(() => buildInto(tempDir(), sheetsDir));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('props.png');
  });
});

describe('the packed art stays small', () => {
  it(`the built art module is under ${ART_MODULE_BROTLI_CAP} bytes Brotli-compressed`, () => {
    expect(built.error, String(built.error)).toBeUndefined();
    expect(built.moduleText.length).toBeGreaterThan(0);
    for (const f of NEW_SHEET_FILES) expect(built.moduleText, f).toContain(f);
    const size = brotliCompressSync(Buffer.from(built.moduleText, 'utf8')).length;
    expect(size).toBeLessThan(ART_MODULE_BROTLI_CAP);
    expect(Buffer.byteLength(built.moduleText, 'utf8')).toBeLessThan(ART_MODULE_RAW_CAP);
  });

  it('the committed src/shared/art.generated.ts holds every object and is under the same cap', () => {
    const text = readFileSync(path.join(ROOT, 'src', 'shared', 'art.generated.ts'), 'utf8');
    for (const o of allObjects()) expect(text, o.name).toContain(JSON.stringify(o.name));
    expect(brotliCompressSync(Buffer.from(text, 'utf8')).length).toBeLessThan(ART_MODULE_BROTLI_CAP);
  });
});
