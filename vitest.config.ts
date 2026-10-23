import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The CPU renderers sweep many turns and zooms; a loaded machine needs more than the default 5 s.
    testTimeout: 30_000,
    // Repo tests build the site; keep preview tags root-relative even when CI exports PUBLIC_SITE_URL.
    env: { PUBLIC_SITE_URL: '' },
    include: [
      'src/**/*.test.ts',
      'art/**/*.test.ts',
      'tools/**/*.test.ts',
      'tests/repo/**/*.test.ts',
      'tests/frames/**/*.test.ts',
    ],
  },
});
