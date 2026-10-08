// XMAS-26 "Art build step and the rough Font sheet": packing sheets into
// colour numbers, the two build-stopping errors, the GIMP palette file, the
// generated art module and the whole build step. Every sheet here is a small
// made-up PNG built with node:zlib; none depends on the real art.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { ArtBuildError, buildArt, generateArtModule, gplFile, packSheet, type SheetSpec } from './art.ts';

// ---------------------------------------------------------------------------
// Fixtures

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'xmas-art-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function chunk(type: string, data: Uint8Array): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/** 8-bit RGBA PNG, unfiltered rows. */
function makePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const PALETTE = ['#ff0000', '#00ff00', '#0000ff'] as const; // colour numbers 1, 2, 3

// One character per pixel. '.' is fully transparent (with junk RGB, which must be ignored).
const KEY: Record<string, [number, number, number, number]> = {
  '.': [0x12, 0x34, 0x56, 0],
  r: [0xff, 0x00, 0x00, 255],
  g: [0x00, 0xff, 0x00, 255],
  b: [0x00, 0x00, 0xff, 255],
  X: [0x12, 0x34, 0x56, 255], // not in PALETTE
  h: [0xff, 0x00, 0x00, 128], // a palette colour, but half transparent
};

function sheetPng(rows: string[]): Uint8Array {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    expect(row.length, 'fixture rows must be the same length').toBe(width);
    [...row].forEach((ch, x) => {
      const px = KEY[ch];
      if (!px) throw new Error(`fixture: unknown key ${ch}`);
      rgba.set(px, (y * width + x) * 4);
    });
  });
  return makePng(width, height, rgba);
}

// 8x4 sheet: drawing "left" is 3x4 at (0,0), drawing "right" is 4x4 at (4,0); column 3 is a gap.
const GOOD_ROWS = [
  'rgb.rrrr', //
  'g.b.g..g',
  'bbb.g..g',
  '.r..bbbb',
];

function spec(overrides: Partial<SheetSpec> = {}): SheetSpec {
  return {
    file: 'tiny.png',
    width: 8,
    height: 4,
    drawings: [
      { name: 'left', x: 0, y: 0, width: 3, height: 4 },
      { name: 'right', x: 4, y: 0, width: 4, height: 4 },
    ],
    ...overrides,
  };
}

function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the call to throw');
}

type ModuleEntry = { sheet: string; x: number; y: number; width: number; height: number; pixels: Uint8Array };

async function importModule(source: string, dir = tempDir(), name = 'art.generated.ts'): Promise<Record<string, ModuleEntry>> {
  const file = path.join(dir, name);
  writeFileSync(file, source);
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { drawings: Record<string, ModuleEntry> };
  return mod.drawings;
}

function entry(sheet: string, x: number, y: number, width: number, height: number, bytes: number[]): ModuleEntry {
  return { sheet, x, y, width, height, pixels: Uint8Array.from(bytes) };
}

// ---------------------------------------------------------------------------
describe('packSheet', () => {
  it('turns every pixel into its colour number (index + 1), transparent into 0, row-major per drawing', () => {
    const out = packSheet(spec(), sheetPng(GOOD_ROWS), PALETTE);
    expect(Object.keys(out).sort()).toEqual(['left', 'right']);
    expect(out['left']?.width).toBe(3);
    expect(out['left']?.height).toBe(4);
    expect(Array.from(out['left']?.pixels ?? [])).toEqual([1, 2, 3, 2, 0, 3, 3, 3, 3, 0, 1, 0]);
    expect(out['right']?.width).toBe(4);
    expect(out['right']?.height).toBe(4);
    expect(Array.from(out['right']?.pixels ?? [])).toEqual([1, 1, 1, 1, 2, 0, 0, 2, 2, 0, 0, 2, 3, 3, 3, 3]);
  });

  it('cuts drawings that sit away from the top-left corner and leaves gaps out', () => {
    const rows = [
      '........', //
      '.....rg.',
      '.....bg.',
      '........',
    ];
    const s = spec({ drawings: [{ name: 'chip', x: 5, y: 1, width: 2, height: 1 }] });
    const out = packSheet(s, sheetPng(rows), PALETTE);
    expect(Object.keys(out)).toEqual(['chip']);
    expect(Array.from(out['chip']?.pixels ?? [])).toEqual([1, 2]);
  });

  it('matches a palette colour regardless of the RGB bytes of fully transparent pixels', () => {
    const out = packSheet(spec(), sheetPng(['........', '........', '........', '........']), PALETTE);
    expect(Array.from(out['left']?.pixels ?? [])).toEqual(new Array(12).fill(0));
    expect(Array.from(out['right']?.pixels ?? [])).toEqual(new Array(16).fill(0));
  });

  it('uses the palette it is given, not a built-in list', () => {
    const reversed = [...PALETTE].reverse(); // blue 1, green 2, red 3
    const out = packSheet(spec(), sheetPng(GOOD_ROWS), reversed);
    expect(Array.from(out['left']?.pixels ?? []).slice(0, 3)).toEqual([3, 2, 1]);
  });

  it('gives colour number 255 to the 255th palette entry', () => {
    const palette = Array.from({ length: 255 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    const rgba = Uint8Array.from([0, 0, 254, 255, 0, 0, 0, 255]);
    const s: SheetSpec = { file: 'wide.png', width: 2, height: 1, drawings: [{ name: 'p', x: 0, y: 0, width: 2, height: 1 }] };
    expect(Array.from(packSheet(s, makePng(2, 1, rgba), palette)['p']?.pixels ?? [])).toEqual([255, 1]);
  });

  describe('a colour not in the master list stops the build', () => {
    it('throws ArtBuildError naming the file and the sheet position x,y', () => {
      const rows = [...GOOD_ROWS];
      rows[3] = '.r..bbbX'; // (7,3): inside "right", local (3,3)
      const err = caught(() => packSheet(spec(), sheetPng(rows), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('tiny.png');
      expect(err.message).toContain('7,3');
    });

    it('reports sheet coordinates, not coordinates inside the drawing', () => {
      const rows = [...GOOD_ROWS];
      rows[1] = 'g.b.gX.g'; // (5,1) on the sheet, (1,1) inside "right"
      const err = caught(() => packSheet(spec(), sheetPng(rows), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('5,1');
      expect(err.message).not.toContain('1,1');
    });

    it('names the file from the spec, including a file in a subfolder', () => {
      const rows = [...GOOD_ROWS];
      rows[0] = 'Xgb.rrrr';
      const err = caught(() => packSheet(spec({ file: 'scene/globe-base.png' }), sheetPng(rows), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('scene/globe-base.png');
      expect(err.message).toContain('0,0');
    });

    it('treats a half-transparent pixel as an error naming file and position, even in a palette colour', () => {
      const rows = [...GOOD_ROWS];
      rows[2] = 'bbb.gh.g'; // (5,2)
      const err = caught(() => packSheet(spec(), sheetPng(rows), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('tiny.png');
      expect(err.message).toContain('5,2');
    });

    it('rejects every opaque pixel when the palette is empty', () => {
      expect(() => packSheet(spec(), sheetPng(GOOD_ROWS), [])).toThrow(ArtBuildError);
    });
  });

  describe('a drawing not the size fixed for it stops the build', () => {
    it('throws ArtBuildError naming the file, the first drawing and the expected size when the image is too tall', () => {
      const rows = [...GOOD_ROWS, 'rrrrrrrr'];
      const err = caught(() => packSheet(spec(), sheetPng(rows), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('tiny.png');
      expect(err.message).toContain('left');
      expect(err.message).toContain('8x4');
    });

    it('throws when the image is narrower than fixed, even though every drawing would still fit', () => {
      const s = spec({ drawings: [{ name: 'left', x: 0, y: 0, width: 3, height: 4 }] });
      const rows = GOOD_ROWS.map((r) => r.slice(0, 7));
      const err = caught(() => packSheet(s, sheetPng(rows), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('tiny.png');
      expect(err.message).toContain('left');
      expect(err.message).toContain('8x4');
    });

    it('names the first drawing in manifest order whose rectangle runs off the image, with its size', () => {
      const s = spec({
        drawings: [
          { name: 'fits', x: 0, y: 0, width: 3, height: 4 },
          { name: 'spills', x: 6, y: 0, width: 3, height: 2 },
          { name: 'alsoSpills', x: 0, y: 3, width: 1, height: 2 },
        ],
      });
      const err = caught(() => packSheet(s, sheetPng(GOOD_ROWS), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('tiny.png');
      expect(err.message).toContain('spills');
      expect(err.message).toContain('3x2');
      expect(err.message).not.toContain('alsoSpills');
    });

    it('rejects a drawing at a negative position', () => {
      const s = spec({ drawings: [{ name: 'neg', x: -1, y: 0, width: 2, height: 2 }] });
      const err = caught(() => packSheet(s, sheetPng(GOOD_ROWS), PALETTE));
      expect(err).toBeInstanceOf(ArtBuildError);
      expect(err.message).toContain('neg');
    });

    it('accepts a drawing that touches the right and bottom edges exactly', () => {
      const s = spec({ drawings: [{ name: 'corner', x: 7, y: 3, width: 1, height: 1 }] });
      expect(Array.from(packSheet(s, sheetPng(GOOD_ROWS), PALETTE)['corner']?.pixels ?? [])).toEqual([3]);
    });
  });

  it('throws on bytes that are not a PNG', () => {
    expect(() => packSheet(spec(), new TextEncoder().encode('not a png'), PALETTE)).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('gplFile', () => {
  it('writes the GIMP palette header, then one right-aligned R G B line per colour, with a trailing newline', () => {
    expect(gplFile('Tiny', ['#ffffff', '#0b1026', '#000000', '#0a6e05'])).toBe(
      'GIMP Palette\nName: Tiny\nColumns: 0\n#\n' +
        '255 255 255\t#ffffff\n' +
        ' 11  16  38\t#0b1026\n' +
        '  0   0   0\t#000000\n' +
        ' 10 110   5\t#0a6e05\n',
    );
  });

  it('keeps the master list order, so line n is colour number n', () => {
    const text = gplFile('Order', ['#0000ff', '#ff0000']);
    const lines = text.trimEnd().split('\n').slice(4);
    expect(lines).toEqual(['  0   0 255\t#0000ff', '255   0   0\t#ff0000']);
  });

  it('writes only the header for an empty list', () => {
    expect(gplFile('Empty', [])).toBe('GIMP Palette\nName: Empty\nColumns: 0\n#\n');
  });
});

// ---------------------------------------------------------------------------
describe('generateArtModule', () => {
  const sample: Record<string, ModuleEntry> = {
    B: entry('font.png', 4, 0, 3, 5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    A: entry('font.png', 0, 0, 3, 5, [255, 254, 0, 0, 0, 128, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    '.': entry('font.png', 8, 0, 3, 5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]),
    tree: entry('scene/tree.png', 17, 9, 2, 1, [5, 6]),
  };

  it('round-trips every field of every drawing through the generated module', async () => {
    const drawings = await importModule(generateArtModule(sample));
    expect(Object.keys(drawings).sort()).toEqual(Object.keys(sample).sort());
    for (const [name, want] of Object.entries(sample)) {
      const got = drawings[name];
      expect(got, name).toBeDefined();
      expect(got?.sheet).toBe(want.sheet);
      expect([got?.x, got?.y, got?.width, got?.height]).toEqual([want.x, want.y, want.width, want.height]);
      expect(got?.pixels).toBeInstanceOf(Uint8Array);
      expect(Array.from(got?.pixels ?? [])).toEqual(Array.from(want.pixels));
    }
  });

  it('keeps every byte value 0..255 intact', async () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    const drawings = await importModule(generateArtModule({ ramp: entry('ramp.png', 0, 0, 16, 16, all) }));
    expect(Array.from(drawings['ramp']?.pixels ?? [])).toEqual(all);
  });

  it('survives drawing and sheet names shaped like hostile input', async () => {
    const odd: Record<string, ModuleEntry> = {
      '"': entry('q"uote.png', 0, 0, 1, 1, [1]),
      "'": entry("it's.png", 1, 0, 1, 1, [2]),
      '\\': entry('back\\slash.png', 2, 0, 1, 1, [3]),
      '${x}': entry('`tick`.png', 3, 0, 1, 1, [4]),
      '*/ end': entry('</script>.png', 4, 0, 1, 1, [5]),
      'line\nbreak': entry('snow é.png', 5, 0, 1, 1, [6]),
      ':': entry('font.png', 6, 0, 1, 1, [7]),
      '!': entry('font.png', 7, 0, 1, 1, [8]),
    };
    const drawings = await importModule(generateArtModule(odd));
    expect(Object.keys(drawings).sort()).toEqual(Object.keys(odd).sort());
    for (const [name, want] of Object.entries(odd)) {
      expect(drawings[name]?.sheet, name).toBe(want.sheet);
      expect(Array.from(drawings[name]?.pixels ?? []), name).toEqual(Array.from(want.pixels));
    }
  });

  it('is deterministic: the same drawings in any insertion order give the same text', () => {
    const reordered: Record<string, ModuleEntry> = {};
    for (const k of Object.keys(sample).reverse()) reordered[k] = sample[k] as ModuleEntry;
    expect(generateArtModule(reordered)).toBe(generateArtModule(sample));
    expect(generateArtModule(sample)).toBe(generateArtModule(sample));
  });

  it('lists drawings sorted by name', () => {
    const text = generateArtModule({ zeta: entry('s.png', 0, 0, 1, 1, [1]), alpha: entry('s.png', 1, 0, 1, 1, [2]) });
    expect(text.indexOf('alpha')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'));
  });

  it('changes when a single pixel changes', () => {
    const changed = { ...sample, B: entry('font.png', 4, 0, 3, 5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]) };
    expect(generateArtModule(changed)).not.toBe(generateArtModule(sample));
  });

  it('exports an empty drawings object for no drawings', async () => {
    expect(await importModule(generateArtModule({}))).toEqual({});
  });

  it('runs in a browser: no Node-only API or import in the generated source', () => {
    const text = generateArtModule(sample);
    expect(text).not.toMatch(/\bBuffer\b/);
    expect(text).not.toMatch(/\brequire\s*\(/);
    expect(text).not.toMatch(/from\s+['"]node:/);
    expect(text).not.toMatch(/\bprocess\./);
  });

  it('embeds pixels as base64, not as a long number list', () => {
    const big = Array.from({ length: 600 }, (_, i) => (i * 7) & 0xff);
    const text = generateArtModule({ big: entry('big.png', 0, 0, 30, 20, big) });
    expect(text).toContain(Buffer.from(big).toString('base64'));
  });
});

// ---------------------------------------------------------------------------
describe('buildArt', () => {
  type Base = { sheetsDir: string; moduleFile: string; gpl: string };

  /** A temp dir with an empty sheets/ folder and an out/ folder for the outputs. */
  function setup(): Base {
    const dir = tempDir();
    const sheetsDir = path.join(dir, 'sheets');
    mkdirSync(sheetsDir, { recursive: true });
    mkdirSync(path.join(dir, 'out'), { recursive: true });
    return { sheetsDir, moduleFile: path.join(dir, 'out', 'art.generated.ts'), gpl: path.join(dir, 'out', 'tiny.gpl') };
  }

  function writeSheets(sheetsDir: string, sheets: Record<string, Uint8Array>): void {
    for (const [file, bytes] of Object.entries(sheets)) {
      const full = path.join(sheetsDir, file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    }
  }

  const SECOND_ROWS = ['rb', 'br']; // 2x2
  const second: SheetSpec = { file: 'deco/second.png', width: 2, height: 2, drawings: [{ name: 'check', x: 0, y: 0, width: 2, height: 2 }] };

  function opts(base: Base, sheets: SheetSpec[]) {
    return { sheets, sheetsDir: base.sheetsDir, palette: PALETTE, moduleFile: base.moduleFile, gplFile: base.gpl, gplName: 'Tiny' };
  }

  it('writes the module with every drawing of every sheet, carrying its sheet file and position, and the .gpl', async () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS), 'deco/second.png': sheetPng(SECOND_ROWS) });
    buildArt(opts(base, [spec(), second]));

    expect(readFileSync(base.gpl, 'utf8')).toBe(gplFile('Tiny', PALETTE));
    const source = readFileSync(base.moduleFile, 'utf8');
    const drawings = await importModule(source);
    expect(Object.keys(drawings).sort()).toEqual(['check', 'left', 'right']);
    expect(drawings['right']).toMatchObject({ sheet: 'tiny.png', x: 4, y: 0, width: 4, height: 4 });
    expect(Array.from(drawings['right']?.pixels ?? [])).toEqual([1, 1, 1, 1, 2, 0, 0, 2, 2, 0, 0, 2, 3, 3, 3, 3]);
    expect(drawings['check']).toMatchObject({ sheet: 'deco/second.png', x: 0, y: 0, width: 2, height: 2 });
    expect(Array.from(drawings['check']?.pixels ?? [])).toEqual([1, 3, 3, 1]);
  });

  it('writes the same text generateArtModule gives for the packed drawings', () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS) });
    buildArt(opts(base, [spec()]));
    const packed = packSheet(spec(), sheetPng(GOOD_ROWS), PALETTE);
    const expected: Record<string, ModuleEntry> = {};
    for (const d of spec().drawings) {
      const p = packed[d.name];
      if (!p) throw new Error(d.name);
      expected[d.name] = { sheet: 'tiny.png', x: d.x, y: d.y, width: p.width, height: p.height, pixels: p.pixels };
    }
    expect(readFileSync(base.moduleFile, 'utf8')).toBe(generateArtModule(expected));
  });

  it('overwrites stale outputs on success', () => {
    const base = setup();
    writeFileSync(base.moduleFile, 'stale module');
    writeFileSync(base.gpl, 'stale gpl');
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS) });
    buildArt(opts(base, [spec()]));
    expect(readFileSync(base.moduleFile, 'utf8')).not.toBe('stale module');
    expect(readFileSync(base.gpl, 'utf8')).toBe(gplFile('Tiny', PALETTE));
  });

  it('stops on an unknown colour in a later sheet, naming file and position, and writes nothing', () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS), 'deco/second.png': sheetPng(['rb', 'bX']) });
    const err = caught(() => buildArt(opts(base, [spec(), second])));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('deco/second.png');
    expect(err.message).toContain('1,1');
    expect(existsSync(base.moduleFile)).toBe(false);
    expect(existsSync(base.gpl)).toBe(false);
  });

  it('leaves existing outputs untouched when the build stops halfway', () => {
    const base = setup();
    writeFileSync(base.moduleFile, 'previous module');
    writeFileSync(base.gpl, 'previous gpl');
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS), 'deco/second.png': sheetPng(['rb', 'br', 'rr']) });
    const err = caught(() => buildArt(opts(base, [spec(), second])));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('deco/second.png');
    expect(err.message).toContain('check');
    expect(err.message).toContain('2x2');
    expect(readFileSync(base.moduleFile, 'utf8')).toBe('previous module');
    expect(readFileSync(base.gpl, 'utf8')).toBe('previous gpl');
  });

  it('stops when two sheets use the same drawing name, naming it, and writes nothing', () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS), 'deco/second.png': sheetPng(SECOND_ROWS) });
    const clash: SheetSpec = { ...second, drawings: [{ name: 'right', x: 0, y: 0, width: 2, height: 2 }] };
    const err = caught(() => buildArt(opts(base, [spec(), clash])));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('right');
    expect(existsSync(base.moduleFile)).toBe(false);
    expect(existsSync(base.gpl)).toBe(false);
  });

  it('stops when one sheet names the same drawing twice', () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS) });
    const twice = spec({
      drawings: [
        { name: 'dup', x: 0, y: 0, width: 3, height: 4 },
        { name: 'dup', x: 4, y: 0, width: 4, height: 4 },
      ],
    });
    const err = caught(() => buildArt(opts(base, [twice])));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('dup');
    expect(existsSync(base.moduleFile)).toBe(false);
  });

  it('stops with ArtBuildError naming the file when a sheet is missing, and writes nothing', () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': sheetPng(GOOD_ROWS) });
    const err = caught(() => buildArt(opts(base, [spec(), second])));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('deco/second.png');
    expect(existsSync(base.moduleFile)).toBe(false);
    expect(existsSync(base.gpl)).toBe(false);
  });

  it('stops with ArtBuildError naming the file when a sheet is not a PNG, and writes nothing', () => {
    const base = setup();
    writeSheets(base.sheetsDir, { 'tiny.png': new TextEncoder().encode('<svg/>') });
    const err = caught(() => buildArt(opts(base, [spec()])));
    expect(err).toBeInstanceOf(ArtBuildError);
    expect(err.message).toContain('tiny.png');
    expect(existsSync(base.moduleFile)).toBe(false);
    expect(existsSync(base.gpl)).toBe(false);
  });

  it('with no sheets, still writes an empty module and the .gpl', async () => {
    const base = setup();
    buildArt(opts(base, []));
    expect(readFileSync(base.gpl, 'utf8')).toBe(gplFile('Tiny', PALETTE));
    expect(await importModule(readFileSync(base.moduleFile, 'utf8'))).toEqual({});
  });
});
