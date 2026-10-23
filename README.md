# Merry Christmas

A one-page website that counts down to Christmas. Below the countdown is a snow globe you can turn, flick and stir, and on a phone you can shake it. The page also makes its own sound.

## What the site is

- A countdown of the days, hours, minutes and seconds left until Christmas, shown at the top of the page.
- A snow globe below it. Drag it, flick it, or use the arrow keys to turn it. Space gives it a shake; on phones, moving the phone can shake it too.
- Sound: a soft wind and a few chimes, with a sound button to mute it.
- A pause button freezes the scene on a still frame. The countdown keeps going while the scene is paused.
- Four phases (Dawn, Frosty morning, Sunset and Purple night), chosen from the visitor's clock. A phase changes colours only; nothing in the scene is added, removed or moved.
- On 25 December the countdown gives way to "MERRY CHRISTMAS" until the next midnight.
- Nothing is stored on the visitor's device, and nothing is remembered between visits.

## What is unusual about the code

- **Every pixel is written by the site's own code.** There is no rendering library and no web font. The scene is drawn by hand on canvases.
- **The art is drawn as sprite sheets.** The drawings live in `art/sheets/` and follow the rules in `art/STYLE.md`. At build time they are packed into `src/shared/art.generated.ts`, so the site never loads a PNG.
- **The sound is synthesised.** Web Audio makes the wind from filtered noise and the chimes from sine tones. There is no audio file.
- **The countdown is independent of the scene.** It is a small script written into the page at build time, with the time left kept as hidden real text for screen readers. It appears before the scene and still works if the scene never loads.
- **Two pixel grids.** Most of the scene is drawn on the art pixel grid, where each art pixel covers several screen pixels. The fine layer is a second canvas laid exactly over the globe, whose pixels are screen pixels. The turning shapes, Santa and the snow inside the glass are drawn there.
- **Download caps.** `pnpm run check:caps` measures the built files compressed with Brotli, adds them up per cap, and fails the build if a cap is passed.

## Credits

- Christmas tree icons created by [Smashicons - Flaticon](https://www.flaticon.com/free-icons/christmas-tree). The favicon uses them.
- The favicon is not covered by the repository's art licence. It is used under the Flaticon free licence, which asks for the link above.

## Licence

The code is MIT licensed. The artwork is all rights reserved. See [LICENSE](LICENSE).
