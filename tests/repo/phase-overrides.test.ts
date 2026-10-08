// XMAS-28 "Rough art for the remaining sheets" part 2: the per-phase colour
// tables. Each table in art/colours.ts maps a master colour to the master
// colour it becomes in that phase, taken from the visual-direction prototype's
// themes (hex entries only), minus every colour a protected object is drawn
// with. The colours the house, pines, snowman, presents,
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
const PROTOTYPE = path.join(ROOT, 'prototype', 'visual-direction', 'variant-b.js');

const PHASES = ['frosty-morning', 'sunset', 'purple-night'] as const;
type Phase = (typeof PHASES)[number];
const PROTOTYPE_THEME: Record<Phase, string> = {
  'frosty-morning': 'Frosty morning',
  sunset: 'Sunset',
  'purple-night': 'Purple night',
};

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

/** The hex -> hex entries of one prototype theme, read from the prototype source; rgba entries are dropped. */
function prototypeTheme(name: string): Record<string, string> {
  const src = readFileSync(PROTOTYPE, 'utf8');
  const start = src.indexOf(`['${name}', {`);
  if (start < 0) throw new Error(`prototype has no theme ${name}`);
  const end = src.indexOf('}]', start);
  const body = src.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/'(#[0-9a-fA-F]{6})'\s*:\s*'(#[0-9a-fA-F]{6})'/g)) out[norm(m[1]!)] = norm(m[2]!);
  return out;
}

const normalised = (t: Record<string, string>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [norm(k), norm(v)]));

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

/** Every master colour drawn by a protected object, lower-cased. */
function protectedColours(): Set<string> {
  const used = coloursByObject();
  const out = new Set<string>();
  for (const o of protectedObjects()) for (const c of used.get(o.name) ?? []) out.add(c);
  return out;
}

describe('phaseOverrides: the per-phase colour tables', () => {
  it('has exactly the frosty-morning, sunset and purple-night tables (dawn has none)', () => {
    expect(Object.keys(phaseOverrides).sort()).toEqual([...PHASES].sort());
    expect(Object.keys(phaseOverrides)).not.toContain('dawn');
  });

  it('purple-night is the empty table', () => {
    expect(table('purple-night')).toEqual({});
  });

  it('frosty-morning and sunset are not empty', () => {
    expect(Object.keys(table('frosty-morning')).length).toBeGreaterThan(0);
    expect(Object.keys(table('sunset')).length).toBeGreaterThan(0);
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

describe('phaseOverrides match the prototype themes', () => {
  it('the prototype themes, hex entries only, are themselves all master colours', () => {
    const outside: string[] = [];
    for (const phase of PHASES) {
      for (const [k, v] of Object.entries(prototypeTheme(PROTOTYPE_THEME[phase]))) {
        if (!master.has(k)) outside.push(`${phase} key ${k}`);
        if (!master.has(v)) outside.push(`${phase} value ${v}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('the prototype parse finds 20 frosty-morning and 18 sunset hex entries', () => {
    expect(Object.keys(prototypeTheme('Frosty morning')).length).toBe(20);
    expect(Object.keys(prototypeTheme('Sunset')).length).toBe(18);
    expect(prototypeTheme('Purple night')).toEqual({});
  });

  for (const phase of PHASES) {
    it(`${phase} equals the prototype's ${PROTOTYPE_THEME[phase]} hex entries minus every protected-colour key`, () => {
      const prot = protectedColours();
      const expected = Object.fromEntries(Object.entries(prototypeTheme(PROTOTYPE_THEME[phase])).filter(([k]) => !prot.has(k)));
      expect(normalised(table(phase))).toEqual(expected);
    });
  }

  it('the filter has work to do: the prototype frosty-morning and sunset themes do touch protected colours', () => {
    const prot = protectedColours();
    for (const phase of ['frosty-morning', 'sunset'] as const) {
      const hit = Object.keys(prototypeTheme(PROTOTYPE_THEME[phase])).filter((k) => prot.has(k));
      expect(hit.length, phase).toBeGreaterThan(0);
    }
  });

  it('spot-checks: unprotected sky colours keep their prototype replacements', () => {
    const prot = protectedColours();
    const frosty = normalised(table('frosty-morning'));
    const sunset = normalised(table('sunset'));
    const checks: [Record<string, string>, string, string][] = [
      [frosty, '#2b225c', '#b0d6f4'],
      [frosty, '#aebcf0', '#ffffff'],
      [frosty, '#9fd8ff', '#1d4f7a'],
      [sunset, '#463682', '#ffa07a'],
      [sunset, '#2b225c', '#a03f78'],
      [sunset, '#9fd8ff', '#ffe9d0'],
    ];
    for (const [t, k, v] of checks) {
      if (prot.has(k)) continue; // the art now uses it, so the filter rightly removed it
      expect(t[k], k).toBe(v);
    }
  });

  it('drops the prototype rgba entries', () => {
    for (const phase of PHASES) {
      for (const [k, v] of Object.entries(table(phase))) {
        expect(k, phase).not.toMatch(/rgba/);
        expect(v, phase).not.toMatch(/rgba/);
      }
    }
  });
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
