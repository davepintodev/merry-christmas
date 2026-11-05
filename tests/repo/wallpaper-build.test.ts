// XMAS-131 "Wallpaper Engine build": `pnpm run build:wallpaper` writes wallpaper/
// (gitignored): one self-contained index.html, project.json and preview.png.
// Wallpaper Engine opens it from disk, so nothing may be root-relative or fetched.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'wallpaper');

let html = '';
let project: Record<string, unknown> = {};
let siteDir = '';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

beforeAll(async () => {
  // The art is committed, so the build runs without build:art: that step rewrites the generated modules other workers import.
  execFileSync(process.execPath, ['tools/build-wallpaper.ts'], { cwd: ROOT, stdio: 'pipe' });
  html = readFileSync(path.join(OUT, 'index.html'), 'utf8');
  project = JSON.parse(readFileSync(path.join(OUT, 'project.json'), 'utf8')) as Record<string, unknown>;
  siteDir = mkdtempSync(path.join(tmpdir(), 'wallpaper-site-'));
  await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'silent', publicDir: false, build: { outDir: siteDir, emptyOutDir: true } });
}, 240_000);

afterAll(() => {
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

describe('the wallpaper folder', () => {
  it('holds index.html, project.json and the preview image, and is gitignored', () => {
    for (const f of ['index.html', 'project.json', 'preview.png']) expect(existsSync(path.join(OUT, f)), f).toBe(true);
    const png = readFileSync(path.join(OUT, 'preview.png'));
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim())).toContain('wallpaper/');
  });

  it('project.json is a web wallpaper with a title, the preview and the two properties', () => {
    expect(project).toMatchObject({ file: 'index.html', preview: 'preview.png', type: 'web', title: 'Snow Globe Christmas Countdown' });
    const properties = (project['general'] as { properties: Record<string, { type: string; value: boolean; text: string }> }).properties;
    expect(properties['sound']).toMatchObject({ type: 'bool', value: false });
    expect(properties['movement']).toMatchObject({ type: 'bool', value: true });
    expect(properties['sound']!.text).toBeTruthy();
    expect(properties['movement']!.text).toBeTruthy();
  });

  it('index.html is self-contained: no href or src, no import(), no /assets/, no network URL', () => {
    expect(html).not.toMatch(/\b(href|src)\s*=/i);
    expect(html).not.toContain('import(');
    expect(html).not.toContain('/assets/');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('%SCENE_URL%');
    expect(html).not.toContain('%PERF_URL%');
    expect(html).toContain('wallpaperPropertyListener');
  });

  it('has the shake button but neither the sound nor the pause button', () => {
    expect(html).toMatch(/<button\b[^>]*\bid=["']?shake\b/i);
    expect(html).not.toMatch(/\bid=["']?(sound|pause)\b/i);
  });
});

describe('the site build is untouched by the wallpaper code', () => {
  it('carries no wallpaperPropertyListener in any built file', () => {
    const files = listFiles(siteDir).filter((f) => /\.(html|m?js)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toContain('wallpaperPropertyListener');
  });
});
