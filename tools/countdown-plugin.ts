// XMAS-27 "Countdown on a plain sky", part B: the page-assembly plugin. At
// build it bundles src/countdown/main.ts in memory (lib/iife, write: false) and
// puts the one classic <script> into index.html in place of the marker, so the
// countdown needs no request beyond the document.
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

const ENTRY = fileURLToPath(new URL('../src/countdown/main.ts', import.meta.url));
const MARKER = '<!-- countdown-script -->';

// The generated art and font modules name the PNG sheets they were cut from.
// The page must never mention a PNG, so the countdown bundle drops that
// build-time field: the field name and any quoted value, whatever spacing the
// generator uses.
const dropSheetNames: Plugin = {
  name: 'countdown-drop-sheet-names',
  transform: (code, id) =>
    id.endsWith('.generated.ts')
      ? code.replace(/\bsheet\s*:\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,?/g, '')
      : undefined,
};

async function inlineScript(): Promise<string> {
  const outputs = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [dropSheetNames],
    build: { write: false, minify: true, lib: { entry: ENTRY, name: 'countdown', formats: ['iife'] } },
  });
  const result = Array.isArray(outputs) ? outputs[0] : outputs;
  if (result === undefined || !('output' in result)) throw new Error('countdown: the bundle produced no output');
  const chunk = result.output.find((item) => item.type === 'chunk');
  if (chunk === undefined) throw new Error('countdown: the bundle produced no script');
  // The transform above drops the sheet names; failing here keeps a generator
  // or minifier change from slipping a PNG name into the page unnoticed.
  if (/\.png\b/i.test(chunk.code)) throw new Error('countdown: the bundle still names a PNG sheet');
  const safe = chunk.code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<script>${safe}</script>`;
}

export function countdownPlugin(): Plugin {
  return {
    name: 'countdown-script',
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        // Exactly one marker, or the built page would silently ship without its script.
        if (html.split(MARKER).length !== 2) throw new Error(`countdown: index.html needs one ${MARKER} marker`);
        if (ctx.server) return html.replace(MARKER, '<script type="module" src="/src/countdown/main.ts"></script>');
        return html.replace(MARKER, await inlineScript());
      },
    },
  };
}
