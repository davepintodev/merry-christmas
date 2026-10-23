import { defineConfig } from 'vite';
import { countdownPlugin } from './tools/countdown-plugin.ts';

// Dev server bind address comes from HOST; unset keeps it on loopback.
const host = process.env['HOST'] || 'localhost';

export default defineConfig({
  plugins: [countdownPlugin()],
  server: { host },
  // `vite preview` only serves the e2e tests; keep it on loopback even when
  // HOST points the dev server elsewhere.
  preview: { host: 'localhost' },
});
