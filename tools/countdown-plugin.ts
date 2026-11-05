// XMAS-27 "Countdown on a plain sky", part B: the page-assembly plugin. At
// build it bundles src/countdown/main.ts in memory (lib/iife, write: false) and
// puts the one classic <script> into index.html in place of the marker, so the
// countdown needs no request beyond the document.
// XMAS-31b "Scene core": the scene (src/page/scene.ts) is a second in-memory
// bundle, emitted next to the page as /assets/scene-<hash>.js. The countdown
// script names it and imports it lazily once the countdown shows, so the page
// still links nothing up front and the plain sky survives any load failure.
// XMAS-33 "The ?perf readout": the readout is a third bundle,
// assets/perf-<hash>.js, an ES module. The scene names it through its token
// and imports it only with the hidden ?perf option.
// XMAS-42b "Build emits the fingerprinted preview": the share preview
// (tools/preview-image.ts) is emitted to the root of dist as
// preview-<hash>.png, and the build's index.html names it in its og:image and
// twitter:image tags. The site never requests it; a dev server does neither.
// XMAS-131 "Wallpaper Engine build": with { wallpaper: true } the plugin inlines the
// scene after the countdown instead of emitting it, with the build flag set so
// neither script imports anything, and emits and tags nothing. The bundles of the
// site build carry the flag as false; tools/build-wallpaper.ts writes the folder.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, type HtmlTagDescriptor, type Plugin } from 'vite';
import { renderPreview } from './preview-image.ts';

const ENTRY = fileURLToPath(new URL('../src/countdown/main.ts', import.meta.url));
const SCENE_ENTRY = fileURLToPath(new URL('../src/page/scene.ts', import.meta.url));
const PERF_ENTRY = fileURLToPath(new URL('../src/page/perf.ts', import.meta.url));
const DEV_SCENE = '/src/page/scene.ts';
const DEV_PERF = '/src/page/perf.ts';
const MARKER = '<!-- countdown-script -->';
const SCENE_TOKEN = '%SCENE_URL%';
const PERF_TOKEN = '%PERF_URL%';

export interface CountdownPluginOptions {
  /** The Wallpaper Engine build: both scripts inline, nothing emitted, no preview tags. */
  wallpaper?: boolean;
}

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

/**
 * The single chunk of one in-memory lib build: an iife script, or an es module when it exports.
 * `wallpaper` sets the build flag the bundle is compiled with.
 */
async function library(entry: string, name: string, { format = 'iife', wallpaper = false }: { format?: 'iife' | 'es'; wallpaper?: boolean } = {}): Promise<string> {
  const outputs = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [dropSheetNames],
    define: { __XMAS_WALLPAPER__: wallpaper },
    build: { write: false, minify: true, lib: { entry, name, formats: [format] } },
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

/**
 * Fills a bundle's URL token. The site's bundles name it once; the wallpaper's name none, as the flag
 * drops every use, so a bundle with another count means a build change that would ship a dead import.
 */
function fillToken(code: string, token: string, value: string, name: string, wallpaper: boolean): string {
  const expected = wallpaper ? 0 : 1;
  const count = code.split(token).length - 1;
  if (count !== expected) throw new Error(`${name}: the bundle names ${token} ${count} times, expected ${expected}`);
  return code.replace(token, value);
}

type BuiltFile = { fileName: string; url: string; code: string };

/** A built file named by the hash of its code, and the URL that names it. */
function hashed(base: string, kind: string, code: string): BuiltFile {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
  const fileName = `assets/${kind}-${hash}.js`;
  return { fileName, url: `${base}${fileName}`, code };
}

/** The readout's built code, its output name and the URL the scene names. */
async function perfFile(base: string): Promise<BuiltFile> {
  return hashed(base, 'perf', await library(PERF_ENTRY, 'perf', { format: 'es' }));
}

/** The scene's built code, its output name and the URL the countdown script names. */
async function sceneFile(base: string, perfUrl: string): Promise<BuiltFile> {
  const code = fillToken(await library(SCENE_ENTRY, 'scene'), PERF_TOKEN, perfUrl, 'scene', false);
  return hashed(base, 'scene', code);
}

/** The share preview's PNG bytes, the root-level file named by their hash, and the URL that names it. */
function previewFile(base: string): { fileName: string; url: string; source: Uint8Array } {
  const source = renderPreview();
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
  const fileName = `preview-${hash}.png`;
  return { fileName, url: `${base}${fileName}`, source };
}

/** The site's origin from PUBLIC_SITE_URL, or undefined when it is unset or empty. Only a bare https host is accepted. */
function siteOrigin(): string | undefined {
  const raw = process.env['PUBLIC_SITE_URL']?.trim();
  if (!raw) return undefined;
  const url = URL.parse(raw);
  // A dotless host (or a stray scheme, as in https://https://x.com) is not a public domain; a path, query or hash is not an origin.
  const bare = url?.protocol === 'https:' && (url.hostname.includes('.') || url.hostname === 'localhost') && url.href === `${url.origin}/`;
  if (!bare) throw new Error(`PUBLIC_SITE_URL must be a bare https:// address with a domain, got "${raw}"`);
  return url.origin;
}

/** The meta tags that name the preview picture to link unfurlers; with a site origin, also og:url and og:type. */
function previewTags(url: string, origin: string | undefined): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [
    { tag: 'meta', attrs: { property: 'og:image', content: url }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'twitter:image', content: url }, injectTo: 'head' },
  ];
  if (origin === undefined) return tags;
  tags.push(
    { tag: 'meta', attrs: { property: 'og:url', content: `${origin}/` }, injectTo: 'head' },
    { tag: 'meta', attrs: { property: 'og:type', content: 'website' }, injectTo: 'head' },
  );
  return tags;
}

/** One classic script holding a bundle's code, with nothing in it that could end or open a comment around the tag. */
function classicScript(code: string): string {
  const safe = code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<script>${safe}</script>`;
}

async function inlineScript(sceneUrl: string): Promise<string> {
  // The one token in main.ts is the scene's URL: fail here rather than ship
  // a countdown that never names its scene file.
  return classicScript(fillToken(await library(ENTRY, 'countdown'), SCENE_TOKEN, sceneUrl, 'countdown', false));
}

/** The wallpaper page's scripts: the countdown, then the scene it would otherwise import, both inline. */
async function wallpaperScripts(): Promise<string> {
  const countdown = fillToken(await library(ENTRY, 'countdown', { wallpaper: true }), SCENE_TOKEN, '', 'countdown', true);
  const scene = fillToken(await library(SCENE_ENTRY, 'scene', { wallpaper: true }), PERF_TOKEN, '', 'scene', true);
  return classicScript(countdown) + classicScript(scene);
}

export function countdownPlugin({ wallpaper = false }: CountdownPluginOptions = {}): Plugin {
  let base = '/';
  let serving = false;
  let sceneUrl: string | null = null;
  let previewUrl: string | null = null;
  return {
    name: 'countdown-script',
    // A dev server serves the countdown as a module; the scene is then its
    // source file. The build's inline bundle gets the emitted asset instead.
    transform(code, id) {
      if (id.endsWith('/src/countdown/main.ts') && code.includes(SCENE_TOKEN)) return code.replace(SCENE_TOKEN, DEV_SCENE);
      if (id.endsWith('/src/page/scene.ts') && code.includes(PERF_TOKEN)) return code.replace(PERF_TOKEN, DEV_PERF);
      return undefined;
    },
    configResolved(config) {
      base = config.base;
      serving = config.command === 'serve';
    },
    async buildStart() {
      if (serving || wallpaper) return;
      // The readout first: the scene names its URL, so its hash goes into the scene's code.
      const perf = await perfFile(base);
      this.emitFile({ type: 'asset', fileName: perf.fileName, source: perf.code });
      const scene = await sceneFile(base, perf.url);
      this.emitFile({ type: 'asset', fileName: scene.fileName, source: scene.code });
      sceneUrl = scene.url;
      // renderPreview() takes seconds, so it runs once per build; a throw here fails the build.
      const preview = previewFile(base);
      this.emitFile({ type: 'asset', fileName: preview.fileName, source: preview.source });
      previewUrl = preview.url;
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        // Exactly one marker, or the built page would silently ship without its script.
        if (html.split(MARKER).length !== 2) throw new Error(`countdown: index.html needs one ${MARKER} marker`);
        if (ctx.server) return html.replace(MARKER, '<script type="module" src="/src/countdown/main.ts"></script>');
        // A replacer function: a string replacement would read $' and $& in the minified code as patterns.
        if (wallpaper) {
          const scripts = await wallpaperScripts();
          return html.replace(MARKER, () => scripts);
        }
        if (sceneUrl === null) throw new Error('countdown: the scene file was not built');
        if (previewUrl === null) throw new Error('countdown: the preview image was not built');
        // Only a build gets here; the dev server never reads the address.
        const origin = siteOrigin();
        const image = origin === undefined ? previewUrl : new URL(previewUrl, `${origin}/`).href;
        const script = await inlineScript(sceneUrl);
        return { html: html.replace(MARKER, () => script), tags: previewTags(image, origin) };
      },
    },
  };
}
