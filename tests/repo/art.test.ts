// XMAS-26 "Art build step and the rough Font sheet": the committed art
// outputs are up to date with the sheets, and the built site holds no PNG.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { sheets } from '../../art/sheets.ts';
import { generateArtModule, gplFile, packSheet } from '../../tools/art.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATED = 'src/shared/art.generated.ts';
const GPL = 'art/xmas.gpl';
const DIST = path.join(ROOT, 'dist');

function readText(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`expected ${rel} to exist`);
  return readFileSync(p, 'utf8');
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
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

describe('the built site has no PNG', () => {
  const PREVIEW = /^preview-[0-9a-f]+\.png$/;
  const ICON = /^(icon-32|icon-192|apple-touch-icon)\.png$/;

  it.skipIf(!existsSync(DIST))('dist/ holds no .png file except the one fingerprinted preview image and the favicon icons', () => {
    const pngs = walk(DIST).filter((f) => /\.png$/i.test(f)).map((f) => path.relative(DIST, f)).filter((f) => !ICON.test(f));
    expect(pngs).toHaveLength(1);
    expect(pngs[0]).toMatch(PREVIEW);
  });

  it.skipIf(!existsSync(DIST))('built .js and .css mention no .png, and index.html only the preview image and the favicon icons', () => {
    const files = walk(DIST).filter((f) => /\.(html|js|mjs|css)$/i.test(f));
    expect(files.map((f) => path.relative(DIST, f))).toContain('index.html');
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const mentions = text.match(/[^\s"'=()<>/]*\.png/gi) ?? [];
      if (path.basename(f) === 'index.html') {
        for (const m of mentions) expect(m, 'index.html').toMatch(new RegExp(`${PREVIEW.source}|${ICON.source}`));
      } else {
        expect(mentions, path.relative(ROOT, f)).toEqual([]);
      }
    }
  });
});
