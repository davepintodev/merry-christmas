// XMAS-35 "Art pass: Dawn's colour table": every colour the scene's per-phase
// tables name (SKY_RAMP, GROUND_SHADOW, GROUND_SNOW, DISC_BODY, PHASE_GLASS) is
// a master colour from art/colours.ts. The tables are module-private, so this
// reads them from the source, the way contrast.test.ts reads art/colours.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import type { PhaseName } from '../../src/shared/clock.ts';

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const TABLES: [file: string, name: string][] = [
  ['frame.ts', 'SKY_RAMP'],
  ['frame.ts', 'GROUND_SHADOW'],
  ['frame.ts', 'GROUND_SNOW'],
  ['frame.ts', 'DISC_BODY'],
  ['globe.ts', 'PHASE_GLASS'],
];

function source(file: string): string {
  return readFileSync(new URL(`../../src/scene/${file}`, import.meta.url), 'utf8');
}

/** The text of `const NAME ... = { ... };`, up to the closing brace at column 0. */
function tableText(src: string, name: string): string {
  const start = src.search(new RegExp(`^(?:export )?const ${name}\\b`, 'm'));
  if (start < 0) return '';
  const end = src.indexOf('\n};', start);
  return end < 0 ? '' : src.slice(start, end);
}

/** A string constant's value, for entries that name one (DISC_BODY uses SUN_COLOUR). */
function constant(src: string, id: string): string | undefined {
  return new RegExp(`^(?:export )?const ${id}\\s*=\\s*'(#[0-9a-fA-F]{6})'`, 'm').exec(src)?.[1];
}

/** Each phase's colours in a table: every '#rrggbb' literal and named constant in that phase's entry. */
function phaseEntries(src: string, name: string): Map<string, string[]> {
  const text = tableText(src, name);
  const key = /^ {2}(?:'([a-z-]+)'|([a-z-]+)):/gm;
  const marks = [...text.matchAll(key)].map((m) => ({ phase: m[1] ?? m[2] ?? '', at: m.index ?? 0 }));
  const out = new Map<string, string[]>();
  marks.forEach((m, i) => {
    const body = text.slice(m.at, marks[i + 1]?.at ?? text.length).replace(/^ {2}[^:]+:/, '');
    const found: string[] = [];
    for (const lit of body.matchAll(/'(#[0-9a-fA-F]{6})'/g)) found.push(lit[1]!);
    for (const id of body.matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)) {
      found.push(constant(src, id[1]!) ?? `unresolved ${id[1]}`);
    }
    out.set(m.phase, found);
  });
  return out;
}

describe('scene colour tables use master colours', () => {
  for (const [file, name] of TABLES) {
    it(`${name} (${file}) has an entry for each phase, every colour a lowercase master colour`, () => {
      const src = source(file);
      const entries = phaseEntries(src, name);
      expect([...entries.keys()].sort(), `${name} phases`).toEqual([...PHASES].sort());
      const offList: string[] = [];
      for (const p of PHASES) {
        const found = entries.get(p) ?? [];
        expect(found.length, `${name}.${p} colours`).toBeGreaterThan(0);
        for (const c of found) {
          expect(c, `${name}.${p}`).toMatch(/^#[0-9a-f]{6}$/);
          if (!masterColours.includes(c)) offList.push(`${p} ${c}`);
        }
      }
      expect(offList, `${name} colours not in masterColours`).toEqual([]);
    });
  }
});
