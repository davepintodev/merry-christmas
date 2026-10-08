# Art style rules

The rules every sheet is drawn by, rough art first and finished art later.
The art pass replaces one sheet at a time, so each drawing has to keep these
rules on its own.

- Light from the disc at the top left: highlights on top and left edges,
  shade on bottom and right.
- One outline rule: a dark master colour outlines every object, one art pixel
  thick. The walls, roofs and base fill their whole box and carry their
  outline as the lit and shaded box edges instead. Santa (only 6 rows tall)
  and thin details (the snowman's arms, scarf and face, the lamp post, the
  disc) carry their own dark colour instead of a 1-pixel outline.
- At most 10 colours per object. Transparent pixels count as no colour.
- Only colours from the master colour list in `art/colours.ts`. A sheet pixel
  that is not a master-list colour, or has part-opacity, stops the build.
- The object list, with the sheet, name and size of every drawing, is
  `art/objects.ts`; `art/sheets.ts` lays each sheet out left to right from it.
- Draw the sheets with code through `tools/png.ts`, or by hand in Piskel with
  `art/xmas.gpl` loaded. Then run `pnpm run build:art`, which packs the sheets
  into `src/shared/art.generated.ts`, the font-only
  `src/shared/font.generated.ts` and `art/xmas.gpl`. `pnpm run build` runs that
  step first.
