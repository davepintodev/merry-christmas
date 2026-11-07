// XMAS-73a "Run the gate, gitleaks and leak-check in CI": the private-name
// check over a PR's added lines. Usage: node tools/leak-check.ts <git range>
// (CI passes base...head). The owner's words come from the LEAK_WORDS env var,
// one extended regex per line; blank lines and `#` lines are ignored.
// It prints only `file:line` of each hit. Neither the line, the words nor the
// built-in pattern is ever printed: this repo's CI logs are public. Exit 0 =
// clean, 1 = hits, 2 = could not run (bad range, bad word).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUILT_IN =
  '(^|[^0-9.])(10\\.[0-9]{1,3}|192\\.168|172\\.(1[6-9]|2[0-9]|3[01])|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7]))\\.[0-9]{1,3}\\.[0-9]{1,3}([^0-9.]|$)|/home/[a-z_]|/Users/[A-Za-z]';

// grep -a reads bytes that are not valid UTF-8 as text; a UTF-8 locale keeps -i right for non-ASCII words.
const GREP_ENV = { ...process.env, LC_ALL: 'C.UTF-8' };

type Added = { file: string; line: number; text: string };

/** The `+` lines of a zero-context diff, with the new file and line each sits on. */
export function addedLines(diff: string): Added[] {
  const out: Added[] = [];
  let file = '';
  let line = 0;
  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ ')) {
      file = row.startsWith('+++ b/') ? row.slice(6) : '';
    } else if (row.startsWith('@@')) {
      const m = /\+(\d+)/.exec(row);
      line = m ? Number(m[1]) : 0;
    } else if (row.startsWith('+') && file !== '') {
      out.push({ file, line, text: row.slice(1) });
      line += 1;
    }
  }
  return out;
}

/** Words from the env text: trailing CRs dropped, blank and `#` lines skipped; each keeps its line number. */
export function parseWords(raw: string): { pattern: string; lineNo: number }[] {
  const words: { pattern: string; lineNo: number }[] = [];
  raw.split('\n').forEach((row, i) => {
    const pattern = row.replace(/\r$/, '');
    if (pattern.trim() === '' || pattern.trimStart().startsWith('#')) return;
    words.push({ pattern, lineNo: i + 1 });
  });
  return words;
}

function grep(patternFile: string, input: string, extra: string[] = []) {
  return spawnSync('grep', ['-aEi', ...extra, '-f', patternFile, '-'], { input, encoding: 'utf8', env: GREP_ENV, maxBuffer: 256 * 1024 * 1024 });
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function main(): void {
  const range = process.argv[2];
  if (range === undefined) fail('usage: node tools/leak-check.ts <git range>');

  const diff = spawnSync('git', ['-c', 'core.quotepath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=AM', range, '--'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (diff.status !== 0) fail('git diff failed for the given range');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'xmas-leak-'));
  try {
    const words = parseWords(process.env['LEAK_WORDS'] ?? '');
    for (const { pattern, lineNo } of words) {
      const file = path.join(dir, 'one');
      writeFileSync(file, `${pattern}\n`, { mode: 0o600 });
      // An empty line only matches a pattern that matches the empty string, which would flag every line.
      const probe = grep(file, '\n', ['-q']);
      if (probe.status === 2) fail(`LEAK_WORDS line ${lineNo} is not a valid extended regex`);
      if (probe.status === 0) fail(`LEAK_WORDS line ${lineNo} matches the empty string, so it would flag every line`);
    }

    const all = path.join(dir, 'all');
    writeFileSync(all, [BUILT_IN, ...words.map((w) => w.pattern)].join('\n') + '\n', { mode: 0o600 });

    const added = addedLines(diff.stdout);
    // A line that spans a CR would split grep's records; it cannot hold a word that grep sees as one line anyway.
    const result = grep(all, added.map((a) => a.text.replace(/\r/g, '')).join('\n') + '\n', ['-n']);
    if (result.status === 2) fail('grep failed while checking the added lines');

    const hitIndexes = new Set<number>();
    for (const row of result.stdout.split('\n')) {
      const n = /^(\d+):/.exec(row);
      if (n) hitIndexes.add(Number(n[1]) - 1);
    }
    if (hitIndexes.size === 0) {
      console.log(`leak-check: ${added.length} added lines clean`);
      return;
    }

    for (const i of [...hitIndexes].sort((a, b) => a - b)) {
      const hit = added[i]!;
      // The path is public in the PR, but a hit on the path itself would print a word.
      const onPath = grep(all, `${hit.file}\n`, ['-q']).status === 0;
      console.error(`${onPath ? '<path hidden>' : hit.file}:${hit.line}`);
    }
    console.error(`leak-check: ${hitIndexes.size} added line(s) match a private pattern (patterns and lines are not printed)`);
    process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
