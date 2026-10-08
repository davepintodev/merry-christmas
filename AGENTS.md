# AGENTS.md

Guidance for agents working in this repository. Everything here is public:
keep secrets, tokens, addresses, hostnames, home paths and machine names out
of every file.

## Specs

- XMAS-21 "Build-ready spec for the Christmas countdown site": TypeScript in
  strict mode, Vite, Vitest and Playwright, driven by pnpm. No rendering
  library and no web font. Layout: `index.html`, `src/countdown/`,
  `src/scene/`, `src/page/`, `src/shared/`, `art/sheets/`, `art/colours.ts`,
  `tools/`, `tests/frames/`, `tests/browser/`, `tests/repo/`.
- XMAS-16 "Glossary for the Christmas countdown site": shared names for the
  countdown domain; it grows as features land.
- Art: every sheet is drawn to the rules in [art/STYLE.md](art/STYLE.md); the
  object list with each drawing's sheet, name and size is
  [art/objects.ts](art/objects.ts).

## Commands

- `pnpm check` — full gate. It runs, in order, chained with `&&`:
  `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run build`,
  `pnpm run check:caps`, `pnpm run test:e2e`.
- `pnpm run typecheck` — `tsc --noEmit`.
- `pnpm run test:unit` — `vitest run`.
- `pnpm run build` — `pnpm run build:art` then `vite build`.
- `pnpm run build:art` — `node tools/build-art.ts`; packs the sheets named in
  `art/sheets.ts` into `src/shared/art.generated.ts`, the font-only
  `src/shared/font.generated.ts` and `art/xmas.gpl`.
- `pnpm run check:caps` — `node tools/check-caps.ts`; prints Brotli bytes per
  download cap and fails on any cap that is passed.
- `pnpm run test:e2e` — `playwright test`; it serves the built page with
  `vite preview` via the Playwright web server.
- `pnpm dev` — Vite dev server. Set `HOST` to choose the bind address;
  unset stays on loopback.
