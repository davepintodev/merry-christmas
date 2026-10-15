# Art style rules

The rules every sheet is drawn by, rough art first and finished art later.
The art pass replaces one sheet at a time, so each drawing has to keep these
rules on its own.

- Light from the disc at the top left: highlights on top and left edges,
  shade on bottom and right.
- One outline rule: a dark master colour outlines every object, one art pixel
  thick. The walls, roofs and base fill their whole box and carry their
  outline as the lit and shaded box edges instead. Santa (only 9 rows tall)
  and thin details (the snowman's arms, scarf, face and coal buttons, the lamp post, the
  disc) carry their own dark colour instead of a 1-pixel outline.
- At most 10 colours per object. Transparent pixels count as no colour.
- Only colours from the master colour list in `art/colours.ts`. A sheet pixel
  that is not a master-list colour, or has part-opacity, stops the build.
- Two pixel grids. Every drawing in a sheet is drawn on the art pixel grid,
  one drawing pixel per art pixel, and its size is fixed in the object list.
  The page then draws some things on the screen's own pixel grid, the fine
  layer, where one art pixel is 5 to 11 screen pixels:
  - Fine layer: the turning shapes (house, presents, lamp post, pines,
    snowman), their floor shadows, Santa, and the snow inside the glass.
  - Art pixel grid: sky, stars, moon or sun, glass, reflections, base and its
    lettering, the countdown, and outside snow.
- A drawing pixel is always one whole block, on both grids. Never draw an
  in-between shade, a half-pixel detail or a sub-pixel shift into a sheet to
  help a turn: the fine layer places whole blocks on screen pixels, and its
  only softening is at most one screen pixel along the outside edge of a
  shape. The lean shifts rows by whole art pixels, the same on both grids.
- Layer order inside the globe, back to front: glass and reflections, snow
  behind, Santa when behind the shapes, floor shadows, shapes far to near
  (far faces first), Santa when in front, snow in front. Draw each object so
  it reads correctly in any of these places, with its outline all the way
  round.
- Reference pictures that include the fine layer are rendered at one fixed
  whole zoom (5 screen pixels per art pixel), not at the page's own size.
- The object list, with the sheet, name and size of every drawing, is
  `art/objects.ts`; `art/sheets.ts` lays each sheet out left to right from it.
- Draw the sheets with code through `tools/png.ts`, or by hand in Piskel with
  `art/xmas.gpl` loaded. Then run `pnpm run build:art`, which packs the sheets
  into `src/shared/art.generated.ts`, the font-only
  `src/shared/font.generated.ts` and `art/xmas.gpl`. `pnpm run build` runs that
  step first.
