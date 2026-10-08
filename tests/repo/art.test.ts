// XMAS-26 "Art build step and the rough Font sheet": repo-level checks that
// the build runs the art step, the committed outputs are up to date with the
// sheets, and the built site holds no PNG.
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

function scripts(): Record<string, string> {
  return (JSON.parse(readText('package.json')) as { scripts?: Record<string, string> }).scripts ?? {};
}

function expandScript(all: Record<string, string>, body: string, depth = 0): string {
  if (depth > 10) throw new Error('script expansion too deep (cycle?)');
  return body.replace(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g, (whole, name: string) => {
    const target = all[name];
    return target === undefined ? whole : `( ${expandScript(all, target, depth + 1)} )`;
  });
}

function tracked(rel: string): boolean {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

describe('package.json runs the art step', () => {
  it('has build:art = node tools/build-art.ts', () => {
    expect(scripts()['build:art']).toBe('node tools/build-art.ts');
  });

  it('build runs build:art before vite build, chained with &&', () => {
    const all = scripts();
    const build = all['build'] ?? '';
    expect(build).toMatch(/\bpnpm\s+(?:run\s+)?build:art\b[^&|;]*&&/);
    const expanded = expandScript(all, build);
    const art = expanded.search(/\bnode\s+tools\/build-art\.ts\b/);
    const vite = expanded.search(/\bvite\s+build\b/);
    expect(art, `build must run the art step (expanded: ${expanded})`).toBeGreaterThanOrEqual(0);
    expect(vite, `build must still run vite build (expanded: ${expanded})`).toBeGreaterThan(art);
    expect(expanded).not.toMatch(/\|\||;/);
  });
});

describe('committed art outputs are up to date', () => {
  it('the font sheet, the generated module and the palette file are tracked by git', () => {
    for (const f of ['art/sheets/font.png', 'art/sheets.ts', GENERATED, GPL, 'tools/build-art.ts']) {
      expect(tracked(f), `${f} must be committed`).toBe(true);
    }
  });

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
  it.skipIf(!existsSync(DIST))('dist/ holds no .png file', () => {
    expect(walk(DIST).filter((f) => /\.png$/i.test(f)).map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it.skipIf(!existsSync(DIST))('dist/index.html and every built .js and .css mention no .png', () => {
    const files = walk(DIST).filter((f) => /\.(html|js|mjs|css)$/i.test(f));
    expect(files.map((f) => path.relative(DIST, f))).toContain('index.html');
    for (const f of files) expect(readFileSync(f, 'utf8'), path.relative(ROOT, f)).not.toMatch(/\.png/i);
  });
});
