// XMAS-131 "Wallpaper Engine build": `pnpm run build:wallpaper` writes wallpaper/ (gitignored), the folder
// Wallpaper Engine opens as a "Web" wallpaper: one self-contained index.html (both scripts inline), project.json
// and the preview picture. The wallpaper has no sound or pause button (the engine's properties take their place),
// and no site icons or their credit, which only the site needs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { countdownPlugin } from './countdown-plugin.ts';
import { renderPreview } from './preview-image.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'wallpaper');

/** Markup a wallpaper does not use, each piece must be in the built page. */
const DROPPED: RegExp[] = [
  /\s*<!-- Favicon:[^]*?-->/,
  /\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>/g,
  /\s*<button id="(?:sound|pause)"[^]*?<\/button>/g,
];

function stripForWallpaper(html: string): string {
  // Odd entries are the inline scripts, kept whole: a string in their code can look like the markup DROPPED cuts.
  const parts = html.split(/(<script>[^]*?<\/script>)/);
  for (const pattern of DROPPED) {
    // A build that changed this markup would ship the site's icons or buttons; failing here keeps that visible.
    if (!parts.some((part, i) => i % 2 === 0 && new RegExp(pattern).test(part))) throw new Error(`wallpaper: the built page has no ${pattern.source}`);
    for (let i = 0; i < parts.length; i += 2) parts[i] = parts[i]!.replace(pattern, '');
  }
  return parts.join('');
}

const project = {
  file: 'index.html',
  preview: 'preview.png',
  title: 'Snow Globe Christmas Countdown',
  type: 'web',
  general: {
    properties: {
      sound: { type: 'bool', value: false, text: 'Sound', order: 0 },
      movement: { type: 'bool', value: true, text: 'Movement', order: 1 },
    },
  },
};

await build({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  publicDir: false,
  plugins: [countdownPlugin({ wallpaper: true })],
  build: { outDir: OUT, emptyOutDir: true },
});

const indexPath = path.join(OUT, 'index.html');
writeFileSync(indexPath, stripForWallpaper(readFileSync(indexPath, 'utf8')));
writeFileSync(path.join(OUT, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
writeFileSync(path.join(OUT, 'preview.png'), renderPreview());
