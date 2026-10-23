// XMAS-85: tools/turn-sequence.ts, run as the CLI (`pnpm run frames:turn <dir>`),
// which has no exports: its output folder is what is checked.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTempDirs } from '../tests/helpers/temp.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = useTempDirs('xmas-turn-');

const run = (args: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'turn-sequence.ts'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

describe('turn-sequence', () => {
  const dir = path.join(tempDir(), 'nested', 'out');
  let result: ReturnType<typeof run>;
  beforeAll(() => {
    result = run([dir]);
  }, 180_000);

  it('writes 72 numbered frames, a contact sheet and an index, nothing else', () => {
    expect(result.status, result.stderr).toBe(0);
    const files = readdirSync(dir).sort();
    const frames = Array.from({ length: 72 }, (_, n) => `frame-${String(n).padStart(2, '0')}.png`);
    expect(files).toEqual([...frames, 'contact-sheet.png', 'index.txt'].sort());
  });
});
