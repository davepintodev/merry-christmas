// XMAS-28 "Rough art for the remaining sheets" part 2: the per-phase colour
// tables. Each table in art/colours.ts maps a master colour to the master
// colour it becomes in that phase. The colours the house, pines, snowman, presents,
// base and Santa are drawn with must be ones no phase replaces; the colours in
// use are read from the real art/sheets.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { masterColours, phaseOverrides } from '../../art/colours.ts';
import { objects, type ArtObject } from '../../art/objects.ts';
import { sheets } from '../../art/sheets.ts';
import { packSheet } from '../../tools/art.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHEETS_DIR = path.join(ROOT, 'art', 'sheets');

const PHASES = ['frosty-morning', 'sunset', 'purple-night'] as const;
type Phase = (typeof PHASES)[number];

/** The objects whose colours every phase must leave alone. */
const PROTECTED = /^(house-|pine-|snowman-|present-|base$|santa-)/;
const PROTECTED_GROUPS = ['house-', 'pine-', 'snowman-', 'present-', 'base', 'santa-'] as const;

const norm = (hex: string) => hex.toLowerCase();
const master = new Set(masterColours.map(norm));

function table(phase: Phase): Record<string, string> {
  const t = (phaseOverrides as Record<string, Record<string, string> | undefined>)[phase];
  if (!t) throw new Error(`phaseOverrides has no table for ${phase}`);
  return t;
}

/** Master colours used by each object, read from the real sheets. */
function coloursByObject(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const s of sheets) {
    if (s.file === 'font.png') continue;
    const packed = packSheet(s, new Uint8Array(readFileSync(path.join(SHEETS_DIR, s.file))), masterColours);
    for (const [name, d] of Object.entries(packed)) {
      const set = new Set<string>();
      for (const p of d.pixels) if (p !== 0) set.add(norm(masterColours[p - 1] ?? `#invalid-${p}`));
      used.set(name, set);
    }
  }
  return used;
}

function protectedObjects(): readonly ArtObject[] {
  return objects.filter((o) => PROTECTED.test(o.name));
}

describe('phaseOverrides: the per-phase colour tables', () => {
  it('has exactly the frosty-morning, sunset and purple-night tables (dawn has none)', () => {
    expect(Object.keys(phaseOverrides).sort()).toEqual([...PHASES].sort());
    expect(Object.keys(phaseOverrides)).not.toContain('dawn');
  });

  for (const phase of PHASES) {
    it(`${phase}: every key and every value is a #rrggbb master colour`, () => {
      const outside: string[] = [];
      for (const [k, v] of Object.entries(table(phase))) {
        expect(k, `${phase} key`).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(v, `${phase} value for ${k}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        if (!master.has(norm(k))) outside.push(`key ${k}`);
        if (!master.has(norm(v))) outside.push(`value ${v} (for ${k})`);
      }
      expect(outside, `${phase} colours missing from masterColours`).toEqual([]);
    });

    it(`${phase}: no key appears twice once case is normalised`, () => {
      const keys = Object.keys(table(phase)).map(norm);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});

describe('the protected colours: every phase leaves the scene objects alone', () => {
  it('the protected set covers the house, pines, snowman, presents, base and Santa, each drawn with at least one colour', () => {
    const names = protectedObjects().map((o) => o.name);
    for (const g of PROTECTED_GROUPS) expect(names.some((n) => n.startsWith(g)), g).toBe(true);
    expect(names).not.toContain('lamp-post');
    expect(names).not.toContain('disc');
    const used = coloursByObject();
    for (const o of protectedObjects()) expect(used.get(o.name)?.size ?? 0, `${o.name} has no colours`).toBeGreaterThan(0);
  });

  for (const phase of PHASES) {
    it(`${phase} replaces no colour used by the house, pines, snowman, presents, base or Santa`, () => {
      const used = coloursByObject();
      const keys = new Set(Object.keys(table(phase)).map(norm));
      const conflicts: string[] = [];
      for (const o of protectedObjects()) {
        const hit = [...(used.get(o.name) ?? [])].filter((c) => keys.has(c)).sort();
        if (hit.length > 0) conflicts.push(`${o.name}: ${hit.join(', ')}`);
      }
      expect(conflicts, `${phase} overrides protected colours`).toEqual([]);
    });
  }
});
