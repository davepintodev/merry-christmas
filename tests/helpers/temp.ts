// Temp dirs for tests that write files: made under the OS temp folder and
// removed after the file's tests.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/**
 * Call at the top level of a test file. Returns `tempDir()`, which makes a new
 * dir named `prefix` plus random letters; one `afterAll` removes every dir it
 * made (a dir already gone is fine).
 */
export function useTempDirs(prefix: string): () => string {
  const temps: string[] = [];
  afterAll(() => {
    for (const d of temps) rmSync(d, { recursive: true, force: true });
  });
  return () => {
    const d = mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(d);
    return d;
  };
}
