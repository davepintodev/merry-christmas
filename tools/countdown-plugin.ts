// XMAS-27 "Countdown on a plain sky", part B: the page-assembly plugin. At
// build it bundles src/countdown/main.ts in memory (lib/iife, write: false) and
// puts the one classic <script> into index.html in place of the marker, so the
// countdown needs no request beyond the document.
// XMAS-31b "Scene core": the scene (src/page/scene.ts) is a second in-memory
// bundle, emitted next to the page as /assets/scene-<hash>.js. The countdown
// script names it and imports it lazily once the countdown shows, so the page
// still links nothing up front and the plain sky survives any load failure.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

const ENTRY = fileURLToPath(new URL('../src/countdown/main.ts', import.meta.url));
const SCENE_ENTRY = fileURLToPath(new URL('../src/page/scene.ts', import.meta.url));
const DEV_SCENE = '/src/page/scene.ts';
const MARKER = '<!-- countdown-script -->';
const SCENE_TOKEN = '%SCENE_URL%';

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

/** The single chunk of one in-memory lib/iife build. */
async function library(entry: string, name: string): Promise<string> {
  const outputs = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [dropSheetNames],
    build: { write: false, minify: true, lib: { entry, name, formats: ['iife'] } },
  });
  const result = Array.isArray(outputs) ? outputs[0] : outputs;
  if (result === undefined || !('output' in result)) throw new Error(`${name}: the bundle produced no output`);
  const chunk = result.output.find((item) => item.type === 'chunk');
  if (chunk === undefined) throw new Error(`${name}: the bundle produced no script`);
  // The transform above drops the sheet names; failing here keeps a generator
  // or minifier change from slipping a PNG name into the page unnoticed.
  if (/\.png\b/i.test(chunk.code)) throw new Error(`${name}: the bundle still names a PNG sheet`);
  return chunk.code;
}

/** The scene's built code, its output name and the URL the countdown script names. */
async function sceneFile(base: string): Promise<{ fileName: string; url: string; code: string }> {
  const code = await library(SCENE_ENTRY, 'scene');
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
  const fileName = `assets/scene-${hash}.js`;
  return { fileName, url: `${base}${fileName}`, code };
}

async function inlineScript(sceneUrl: string): Promise<string> {
  const code = await library(ENTRY, 'countdown');
  // The one token in main.ts is the scene's URL: fail here rather than ship a
  // countdown that never names its scene file.
  if (code.split(SCENE_TOKEN).length !== 2) throw new Error('countdown: the bundle does not name one scene file');
  const safe = code
    .replace(SCENE_TOKEN, sceneUrl)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
  return `<script>${safe}</script>`;
}

export function countdownPlugin(): Plugin {
  let base = '/';
  let serving = false;
  let sceneUrl: string | null = null;
  return {
    name: 'countdown-script',
    // A dev server serves the countdown as a module; the scene is then its
    // source file. The build's inline bundle gets the emitted asset instead.
    transform(code, id) {
      return id.endsWith('/src/countdown/main.ts') && code.includes(SCENE_TOKEN)
        ? code.replace(SCENE_TOKEN, DEV_SCENE)
        : undefined;
    },
    configResolved(config) {
      base = config.base;
      serving = config.command === 'serve';
    },
    async buildStart() {
      if (serving) return;
      const scene = await sceneFile(base);
      this.emitFile({ type: 'asset', fileName: scene.fileName, source: scene.code });
      sceneUrl = scene.url;
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        // Exactly one marker, or the built page would silently ship without its script.
        if (html.split(MARKER).length !== 2) throw new Error(`countdown: index.html needs one ${MARKER} marker`);
        if (ctx.server) return html.replace(MARKER, '<script type="module" src="/src/countdown/main.ts"></script>');
        if (sceneUrl === null) throw new Error('countdown: the scene file was not built');
        return html.replace(MARKER, await inlineScript(sceneUrl));
      },
    },
  };
}
