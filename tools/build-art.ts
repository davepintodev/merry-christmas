// XMAS-26 "Art build step and the rough Font sheet": the art CLI.
// Usage: node tools/build-art.ts (from the repo root). Packs every sheet in
// art/sheets.ts, writes src/shared/art.generated.ts, the font-only
// src/shared/font.generated.ts and art/xmas.gpl, and exits 1 with the reason
// if any sheet fails.
import { masterColours } from '../art/colours.ts';
import { sheets } from '../art/sheets.ts';
import { ArtBuildError, buildArt } from './art.ts';

try {
  buildArt({
    sheets,
    sheetsDir: 'art/sheets',
    palette: masterColours,
    moduleFile: 'src/shared/art.generated.ts',
    fontModuleFile: 'src/shared/font.generated.ts',
    gplFile: 'art/xmas.gpl',
    gplName: 'XMAS',
  });
} catch (error) {
  console.error(error instanceof ArtBuildError ? error.message : error);
  process.exitCode = 1;
}
