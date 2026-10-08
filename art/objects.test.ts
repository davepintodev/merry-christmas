// XMAS-28 "Rough art for the remaining sheets" part 1: the single object list
// in art/objects.ts and the sheet manifest in art/sheets.ts derived from it.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maxColoursPerObject, objects, type ArtObject } from './objects.ts';
import { sheets } from './sheets.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED: ReadonlyArray<[ArtObject['sheet'], string, number, number]> = [
  ['house', 'house-wall-front', 22, 12],
  ['house', 'house-wall-back', 22, 12],
  ['house', 'house-wall-left', 16, 12],
  ['house', 'house-wall-right', 16, 12],
  ['house', 'house-roof-front', 22, 10],
  ['house', 'house-roof-back', 22, 10],
  ['house', 'house-chimney', 4, 8],
  ['santa', 'santa-trot-1', 31, 6],
  ['santa', 'santa-trot-2', 31, 6],
  ['props', 'pine-1', 7, 20],
  ['props', 'pine-2', 6, 16],
  ['props', 'pine-3', 5, 13],
  ['props', 'snowman-body', 6, 12],
  ['props', 'snowman-face', 3, 3],
  ['props', 'snowman-arms', 8, 3],
  ['props', 'snowman-scarf', 6, 2],
  ['props', 'lamp-post', 2, 12],
  ['props', 'present-1-top', 5, 5],
  ['props', 'present-1-side', 5, 5],
  ['props', 'present-2-top', 4, 4],
  ['props', 'present-2-side', 4, 4],
  ['props', 'present-3-top', 3, 3],
  ['props', 'present-3-side', 3, 3],
  ['props', 'present-4-top', 5, 5],
  ['props', 'present-4-side', 5, 5],
  ['props', 'disc', 13, 13],
  ['base', 'base', 112, 22],
  ['buttons', 'speaker-muted', 20, 10],
  ['buttons', 'speaker-on', 20, 10],
  ['buttons', 'pause-bars', 20, 10],
  ['buttons', 'pause-triangle', 20, 10],
  ['buttons', 'shake-frame', 60, 12],
];

const NEW_SHEET_FILES = ['house.png', 'santa.png', 'props.png', 'base.png', 'buttons.png'];

function key(o: { name: string; width: number; height: number }, file: string): string {
  return `${file}:${o.name}:${o.width}x${o.height}`;
}

describe('art/objects.ts: the object list', () => {
  it('holds exactly the agreed objects, each on its sheet at its exact size', () => {
    const got = objects.map((o) => `${o.sheet}:${o.name}:${o.width}x${o.height}`).sort();
    const want = EXPECTED.map(([s, n, w, h]) => `${s}:${n}:${w}x${h}`).sort();
    expect(got).toEqual(want);
  });

  it('names every object once', () => {
    const names = objects.map((o) => o.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every object a positive whole-number size', () => {
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) {
      expect(Number.isInteger(o.width) && o.width > 0, o.name).toBe(true);
      expect(Number.isInteger(o.height) && o.height > 0, o.name).toBe(true);
    }
  });

  it('sets maxColoursPerObject to a whole number between 4 and 12', () => {
    expect(Number.isInteger(maxColoursPerObject)).toBe(true);
    expect(maxColoursPerObject).toBeGreaterThanOrEqual(4);
    expect(maxColoursPerObject).toBeLessThanOrEqual(12);
  });
});

describe('art/sheets.ts is derived from the object list', () => {
  it('keeps font.png and adds house.png, santa.png, props.png, base.png and buttons.png', () => {
    const files = sheets.map((s) => s.file);
    expect(files).toContain('font.png');
    for (const f of NEW_SHEET_FILES) expect(files, f).toContain(f);
    expect(new Set(files).size).toBe(files.length);
  });

  it('every drawing on a new sheet is an object with the same name, size and sheet, and every object is drawn once', () => {
    const fromSheets = sheets
      .filter((s) => NEW_SHEET_FILES.includes(s.file))
      .flatMap((s) => s.drawings.map((d) => key(d, s.file)))
      .sort();
    const fromObjects = objects.map((o) => key(o, `${o.sheet}.png`)).sort();
    expect(fromObjects.length).toBe(EXPECTED.length);
    expect(fromSheets).toEqual(fromObjects);
  });

  it('places no object on font.png', () => {
    const font = sheets.find((s) => s.file === 'font.png');
    const names = new Set(font?.drawings.map((d) => d.name));
    for (const o of objects) expect(names.has(o.name), o.name).toBe(false);
  });

  it('keeps every drawing on a new sheet inside the sheet, at whole-number positions', () => {
    const news = sheets.filter((s) => NEW_SHEET_FILES.includes(s.file));
    expect(news.length).toBe(NEW_SHEET_FILES.length);
    for (const s of news) {
      expect(s.drawings.length, s.file).toBeGreaterThan(0);
      for (const d of s.drawings) {
        expect(Number.isInteger(d.x) && Number.isInteger(d.y), `${s.file}:${d.name}`).toBe(true);
        expect(d.x >= 0 && d.y >= 0 && d.x + d.width <= s.width && d.y + d.height <= s.height, `${s.file}:${d.name}`).toBe(true);
      }
    }
  });

  it('never overlaps two drawings on the same sheet', () => {
    const news = sheets.filter((s) => NEW_SHEET_FILES.includes(s.file));
    expect(news.length).toBe(NEW_SHEET_FILES.length);
    for (const s of news) {
      for (let i = 0; i < s.drawings.length; i++) {
        for (let j = i + 1; j < s.drawings.length; j++) {
          const a = s.drawings[i];
          const b = s.drawings[j];
          if (!a || !b) continue;
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart, `${s.file}: ${a.name} overlaps ${b.name}`).toBe(true);
        }
      }
    }
  });

  it('has every new sheet file in art/sheets', () => {
    for (const f of NEW_SHEET_FILES) expect(existsSync(path.join(HERE, 'sheets', f)), f).toBe(true);
  });
});
