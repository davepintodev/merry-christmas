// XMAS-28 "Rough art for the remaining sheets" part 1: the drawn sheets
// house.png, santa.png, props.png, base.png and buttons.png at rough level.
// Every check reads the real art/sheets through the art build, run here into
// a temp dir so the committed outputs are never touched.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { maxColoursPerObject, objects, type ArtObject } from '../../art/objects.ts';
import { sheets } from '../../art/sheets.ts';
import { buildArt, type SheetSpec } from '../../tools/art.ts';
import { useTempDirs } from '../helpers/temp.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHEETS_DIR = path.join(ROOT, 'art', 'sheets');
const NEW_SHEET_FILES = ['house.png', 'santa.png', 'props.png', 'base.png', 'buttons.png'] as const;

type Drawing = { sheet: string; x: number; y: number; width: number; height: number; pixels: Uint8Array };

const tempDir = useTempDirs('xmas-rough-');

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

});
