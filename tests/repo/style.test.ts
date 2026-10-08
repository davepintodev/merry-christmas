// XMAS-28 "Rough art for the remaining sheets" part 1: the art style rules
// in art/STYLE.md, kept in the repo for agents to load, and linked from
// AGENTS.md with the object list.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maxColoursPerObject } from '../../art/objects.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STYLE = 'art/STYLE.md';

function readText(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`expected ${rel} to exist`);
  return readFileSync(p, 'utf8');
}

describe(`${STYLE}`, () => {
  it('exists', () => {
    expect(existsSync(path.join(ROOT, STYLE))).toBe(true);
  });

  for (const phrase of ['light from the disc at the top left', 'outline', 'colours per object', 'master colour list']) {
    it(`covers "${phrase}"`, () => {
      expect(readText(STYLE).toLowerCase()).toContain(phrase);
    });
  }

  it('states the colour cap as the same number as maxColoursPerObject, on the colours-per-object line', () => {
    expect(maxColoursPerObject).toBeGreaterThan(0);
    const lines = readText(STYLE).split('\n').filter((l) => /colours per object/i.test(l));
    expect(lines.length).toBeGreaterThan(0);
    const number = new RegExp(`(?<![0-9])${maxColoursPerObject}(?![0-9])`);
    expect(lines.some((l) => number.test(l)), lines.join('\n')).toBe(true);
  });

  it('states no other colour cap than maxColoursPerObject', () => {
    const lines = readText(STYLE).split('\n').filter((l) => /colours per object/i.test(l));
    for (const l of lines) {
      for (const n of l.match(/\d+/g) ?? []) expect(Number(n), l).toBe(maxColoursPerObject);
    }
  });

  it('names the outline exemptions in the outline rule: Santa and the thin details', () => {
    const blocks = readText(STYLE).split(/\n(?=\s*(?:[-*] |#|\n))/).filter((b) => /outline/i.test(b));
    expect(blocks.length).toBeGreaterThan(0);
    const outline = blocks.join('\n').toLowerCase();
    expect(outline).toContain('santa');
    expect(outline).toContain('thin');
  });

  it('holds no home path, hostname or address', () => {
    const text = readText(STYLE);
    expect(text).not.toMatch(/\/home\/|\/Users\//);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('AGENTS.md', () => {
  it('links art/STYLE.md and art/objects.ts', () => {
    const text = readText('AGENTS.md');
    expect(text).toContain('art/STYLE.md');
    expect(text).toContain('art/objects.ts');
  });
});
