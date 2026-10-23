// XMAS-26 "Art build step and the rough Font sheet": the committed art
// outputs are up to date with the sheets.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('tools/build-art.ts', () => {
  const saved = new Map<string, string>();
  afterEach(() => {
    for (const [rel, text] of saved) writeFileSync(path.join(ROOT, rel), text);
    saved.clear();
  });

  it('runs under node, exits 0 and rewrites the committed outputs byte for byte', () => {
    for (const rel of [GENERATED, GPL]) saved.set(rel, readText(rel));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-art.ts')], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    for (const [rel, before] of saved) expect(readText(rel), rel).toBe(before);
  });
});
