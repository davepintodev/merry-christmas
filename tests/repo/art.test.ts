// XMAS-26 "Art build step and the rough Font sheet": the committed art
// outputs are up to date with the sheets.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { sheets } from '../../art/sheets.ts';
import { generateArtModule, gplFile, packSheet } from '../../tools/art.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATED = 'src/shared/art.generated.ts';
const GPL = 'art/xmas.gpl';

function readText(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`expected ${rel} to exist`);
  return readFileSync(p, 'utf8');
}

describe('committed art outputs are up to date', () => {

  it(`${GPL} is the GIMP palette of the master colour list`, () => {
    const text = readText(GPL);
    const name = /^Name: (.*)$/m.exec(text)?.[1] ?? '';
    expect(name.trim()).not.toBe('');
    expect(text).toBe(gplFile(name, masterColours));
  });

  it(`${GENERATED} is exactly what the sheets give today`, () => {
    const drawings: Parameters<typeof generateArtModule>[0] = {};
    for (const s of sheets) {
      const png = new Uint8Array(readFileSync(path.join(ROOT, 'art', 'sheets', s.file)));
      const packed = packSheet(s, png, masterColours);
      for (const d of s.drawings) {
        const p = packed[d.name];
        if (!p) throw new Error(`packSheet left out ${s.file}:${d.name}`);
        drawings[d.name] = { sheet: s.file, x: d.x, y: d.y, width: p.width, height: p.height, pixels: p.pixels };
      }
    }
    expect(readText(GENERATED)).toBe(generateArtModule(drawings));
  });
});
