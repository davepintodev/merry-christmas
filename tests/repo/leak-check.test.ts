// XMAS-73a "Run the gate, gitleaks and leak-check in CI": the leak-check CLI
// (tools/leak-check.ts) run against throwaway git repos. Every private-looking
// fixture is built at runtime so this file itself passes the leak check.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useTempDirs } from '../helpers/temp.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'leak-check.ts');

const tempDir = useTempDirs('xmas-leak-check-');

const FAKE_WORD = ['zeb', 'rafish', 'quill'].join('');
const PRIVATE_IP = ['192', '168', '7', '21'].join('.');
const HOME_PATH = ['', 'home', 'someone', 'notes'].join('/');

function git(cwd: string, args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A repo whose base commit holds `before` and whose head commit holds `after`. */
function repoWith(before: Record<string, string>, after: Record<string, string | null>): string {
  const dir = tempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  const write = (files: Record<string, string | null>) => {
    for (const [name, text] of Object.entries(files)) {
      const p = path.join(dir, name);
      mkdirSync(path.dirname(p), { recursive: true });
      if (text === null) git(dir, ['rm', '-q', '-f', name]);
      else writeFileSync(p, text);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'step', '--allow-empty']);
  };
  write({ 'README.md': 'hello\n', ...before });
  git(dir, ['tag', 'base']);
  write(after);
  return dir;
}

function leakCheck(cwd: string, words?: string): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['LEAK_WORDS'];
  if (words !== undefined) env['LEAK_WORDS'] = words;
  return spawnSync(process.execPath, [SCRIPT, 'base...HEAD'], { cwd, encoding: 'utf8', env, timeout: 60_000 });
}

const output = (r: SpawnSyncReturns<string>): string => `${r.stdout}${r.stderr}`;

describe('leak-check CLI', () => {
  it('fails on an added line that matches a word and prints neither the word nor the line', () => {
    const line = `the ${FAKE_WORD} is here`;
    const dir = repoWith({ 'a.txt': 'one\ntwo\n' }, { 'a.txt': `one\ntwo\n${line}\n` });
    const r = leakCheck(dir, `# comment\n${FAKE_WORD}\n`);
    expect(r.status).toBe(1);
    expect(output(r)).toContain('a.txt:3');
    expect(output(r)).not.toContain(FAKE_WORD);
    expect(output(r)).not.toContain(line);
  });

  it('matches words case-insensitively', () => {
    const dir = repoWith({}, { 'b.txt': `${FAKE_WORD.toUpperCase()}\n` });
    expect(leakCheck(dir, FAKE_WORD).status).toBe(1);
  });

  it('passes a clean diff', () => {
    const dir = repoWith({}, { 'c.txt': 'nothing private here\n' });
    const r = leakCheck(dir, `${FAKE_WORD}\n`);
    expect(r.status, output(r)).toBe(0);
  });

  it('still catches a private IP when the words are empty or unset', () => {
    const dir = repoWith({}, { 'd.txt': `host ${PRIVATE_IP} ok\n` });
    for (const words of ['', '\n\n', '# only a comment\n', undefined]) {
      const r = leakCheck(dir, words);
      expect(r.status).toBe(1);
      expect(output(r)).toContain('d.txt:1');
      expect(output(r)).not.toContain(PRIVATE_IP);
    }
  });

  it('catches a home path', () => {
    const dir = repoWith({}, { 'e.txt': `see ${HOME_PATH}\n` });
    const r = leakCheck(dir, '');
    expect(r.status).toBe(1);
    expect(output(r)).not.toContain(HOME_PATH);
  });

  it('does not match every line when the words hold only comments and blanks', () => {
    const dir = repoWith({}, { 'f.txt': 'plain\n' });
    expect(leakCheck(dir, '\n# note\n   \n').status).toBe(0);
  });

  it('ignores a comment line even when its text is in the diff', () => {
    const dir = repoWith({}, { 'g.txt': `${FAKE_WORD}\n` });
    expect(leakCheck(dir, `# ${FAKE_WORD}\n`).status).toBe(0);
  });

  it('checks only added lines, not removed ones', () => {
    const dir = repoWith({ 'h.txt': `${FAKE_WORD}\nkeep\n` }, { 'h.txt': 'keep\n' });
    expect(leakCheck(dir, FAKE_WORD).status).toBe(0);
  });

  it('reports the line number of a hit inside a later hunk', () => {
    const before = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join('\n') + '\n';
    const rows = before.trimEnd().split('\n');
    rows[24] = `row ${FAKE_WORD}`;
    const dir = repoWith({ 'i.txt': before }, { 'i.txt': rows.join('\n') + '\n' });
    const r = leakCheck(dir, FAKE_WORD);
    expect(r.status).toBe(1);
    expect(output(r)).toContain('i.txt:25');
  });

  it('refuses a word that matches the empty string without printing it', () => {
    const dir = repoWith({}, { 'j.txt': 'plain\n' });
    const r = leakCheck(dir, `(${FAKE_WORD})?\n`);
    expect(r.status).toBe(2);
    expect(output(r)).toContain('LEAK_WORDS line 1');
    expect(output(r)).not.toContain(FAKE_WORD);
  });

  it('refuses a word that is not a valid regex without printing it', () => {
    const dir = repoWith({}, { 'k.txt': 'plain\n' });
    const r = leakCheck(dir, `ok\n(${FAKE_WORD}\n`);
    expect(r.status).toBe(2);
    expect(output(r)).toContain('LEAK_WORDS line 2');
    expect(output(r)).not.toContain(FAKE_WORD);
  });

  it('fails when the range is not a git range', () => {
    const dir = repoWith({}, {});
    const r = spawnSync(process.execPath, [SCRIPT, 'nope...HEAD'], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
