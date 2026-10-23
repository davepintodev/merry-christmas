// XMAS-31a "Scene core engine and reference pictures": src/scene never
// touches the page and draws its randomness from the seed alone. Reads the
// scene's source and everything it imports at run time (type-only imports
// are skipped), with comments stripped so prose may still say "canvas".
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENE = path.join(ROOT, 'src', 'scene');

const PAGE_GLOBALS = [
  'document',
  'window',
  'canvas',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'ImageData',
  'getContext',
  'navigator',
  'location',
  'requestAnimationFrame',
  'localStorage',
  'matchMedia',
  'HTMLElement',
  'Element',
  'addEventListener',
];
const IMPURE = [/\bMath\s*\.\s*random\b/, /\bDate\s*\.\s*now\b/, /\bnew\s+Date\b/, /\bDate\s*\(/, /\bperformance\b/, /\bcrypto\b/];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The scene's own source files (no tests). */
function sceneFiles(): string[] {
  return readdirSync(SCENE)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(SCENE, f));
}

/** Relative run-time imports of one file, resolved to paths. */
function runtimeImports(file: string): string[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(import|export)\s+(?!type\b)([^'";]*?\bfrom\s+)?['"](\.[^'"]+)['"]/gm)) {
    const spec = m[3] ?? '';
    const resolved = path.resolve(path.dirname(file), spec);
    out.push(existsSync(resolved) ? resolved : `${resolved}.ts`);
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.push(path.resolve(path.dirname(file), m[1] ?? ''));
  return out;
}

/** Every file the scene loads at run time, the scene's own files included. */
function sceneGraph(): string[] {
  const seen = new Set<string>();
  const queue = sceneFiles();
  while (queue.length > 0) {
    const file = queue.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...runtimeImports(file));
  }
  return [...seen].sort();
}

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

describe('src/scene source', () => {
  it('loads the Props sheet art from src/shared/art.generated.ts', () => {
    expect(sceneFiles().map(rel)).toContain('src/scene/frame.ts');
    expect(sceneGraph().map(rel)).toContain('src/shared/art.generated.ts');
  });

  it('imports nothing from src/page and not the countdown page script', () => {
    const graph = sceneGraph().map(rel);
    expect(graph).toContain('src/shared/art.generated.ts');
    expect(graph.filter((f) => f.startsWith('src/page/'))).toEqual([]);
    expect(graph).not.toContain('src/countdown/main.ts');
  });

  it('names no page global anywhere it loads at run time', () => {
    const graph = sceneGraph();
    expect(graph.map(rel)).toContain('src/shared/art.generated.ts');
    const found: string[] = [];
    for (const file of graph) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const name of PAGE_GLOBALS) if (new RegExp(`\\b${name}\\b`).test(code)) found.push(`${rel(file)}: ${name}`);
    }
    expect(found).toEqual([]);
  });

  it('reads no clock and no unseeded randomness in its own files', () => {
    const files = sceneFiles();
    expect(files.map(rel)).toContain('src/scene/frame.ts');
    const found: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of IMPURE) if (pattern.test(code)) found.push(`${rel(file)}: ${pattern.source}`);
    }
    expect(found).toEqual([]);
    // The scene's run-time graph is non-trivial: it really does draw something.
    expect(sceneGraph().length).toBeGreaterThan(files.length);
  });
});
