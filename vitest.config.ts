import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'art/**/*.test.ts',
      'tools/**/*.test.ts',
      'tests/repo/**/*.test.ts',
      'tests/frames/**/*.test.ts',
    ],
  },
});
