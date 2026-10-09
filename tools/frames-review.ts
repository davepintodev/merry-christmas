// XMAS-31c "Frames review page": the pure logic behind the `pnpm frames`
// review page, and the page itself. tools/frames-serve.ts reads the folder at
// request time and inlines the three pure functions into the page with
// Function.prototype.toString, so the browser runs the same code the tests
// exercise: each one is a plain arrow with its type on the const it is
// assigned to, and its body holds no type syntax for the inlined text to hit.
import { readdirSync } from 'node:fs';

/** One picture found in the frames folder. */
export interface ReviewFrame {
  /** The file name inside the folder, e.g. `frosty-morning.png`. */
  file: string;
  /** The display name, e.g. `Frosty morning` (see displayName). */
  name: string;
}

/** The owner's judgement of one frame. */
export type Verdict = 'approved' | 'denied' | null;

/** One frame's line in the result: its display name, verdict and comment. */
export interface ReviewEntry {
  name: string;
  verdict: Verdict;
  comment: string;
}

/** A frame's display name from its file name: `.png` dropped, hyphens to spaces, first letter capitalised. */
export const displayName: (file: string) => string = (file) =>
  file
    .replace(/\.png$/i, '')
    .replace(/-/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** Every `.png` file in dir (not folders, not other files), sorted by file name; [] when dir is missing. Never writes. */
export const frameList: (dir: string) => ReviewFrame[] = (dir) => {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(entry.name);
    }
  } catch {
    return []; // a missing or unreadable folder holds no pictures
  }
  return files.sort().map((file) => ({ file, name: displayName(file) }));
};

/**
 * The picture's size on screen: `scale` is the largest whole number of
 * physical pixels per art pixel at which the frame fits the room (CSS pixels)
 * at this device pixel ratio, never below 1; cssWidth and cssHeight are the
 * frame's size in CSS pixels at that scale. A nonsense ratio reads as 1.
 */
export const frameScale: (
  frame: { width: number; height: number },
  room: { width: number; height: number },
  dpr: number,
) => { scale: number; cssWidth: number; cssHeight: number } = (frame, room, dpr) => {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const across = Math.floor((room.width * ratio) / frame.width);
  const down = Math.floor((room.height * ratio) / frame.height);
  const fits = Number.isFinite(across) && Number.isFinite(down) ? Math.min(across, down) : 0;
  const scale = Math.max(1, fits);
  return { scale, cssWidth: (frame.width * scale) / ratio, cssHeight: (frame.height * scale) / ratio };
};

/** The result string: one entry per frame in order, joined by ", ". */
export const resultString: (entries: readonly ReviewEntry[]) => string = (entries) => {
  const parts = entries.map((entry) => {
    if (entry.verdict === 'approved') return `${entry.name}:Yes`;
    if (entry.verdict !== 'denied') return `${entry.name}:Undecided`;
    const comment = entry.comment.replace(/\r\n|\r|\n/g, ' ').trim();
    return comment === '' ? `${entry.name}:Denied` : `${entry.name}:Denied with comments: ${comment}`;
  });
  return parts.join(', ');
};

// The page's own controls wiring, inlined after the three functions above.
// The page keeps one entry per picture for as long as it is open; the radios
// and the comment box always edit the shown entry, and the read-only result
// box is the string the owner copies back.
const WIRING = `
const app = {
  frames: files.map(function (file) {
    return { file: file, name: displayName(file), verdict: null, comment: '' };
  }),
  at: 0,
};

const frame = document.querySelector('img#frame');
const name = document.querySelector('#frame-name');
const count = document.querySelector('#frame-count');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const approved = document.querySelector('#approved');
const denied = document.querySelector('#denied');
const comment = document.querySelector('#comment');
const result = document.querySelector('#result');
const copy = document.querySelector('#copy');
const stage = document.querySelector('#stage');

function updateResult() {
  result.value = resultString(app.frames);
}

/** The picture at the largest whole-number physical scale that fits the stage. */
function fit() {
  var width = frame.naturalWidth;
  var height = frame.naturalHeight;
  if (width === 0 || height === 0) return;
  var size = frameScale(
    { width: width, height: height },
    { width: stage.clientWidth, height: stage.clientHeight },
    window.devicePixelRatio,
  );
  frame.style.width = size.cssWidth + 'px';
  frame.style.height = size.cssHeight + 'px';
}

function show(index) {
  if (app.frames.length === 0) {
    name.textContent = 'No frames';
    count.textContent = '0 of 0';
    frame.hidden = true;
    updateResult();
    return;
  }
  app.at = ((index % app.frames.length) + app.frames.length) % app.frames.length;
  const entry = app.frames[app.at];
  frame.hidden = false;
  name.textContent = entry.name;
  count.textContent = (app.at + 1) + ' of ' + app.frames.length;
  // The box and the pixels belong to the picture that has loaded: hide the
  // element while the next one is pending (Chrome keeps painting the old
  // picture otherwise), clear the shown size, and let the load reveal and fit.
  frame.style.visibility = 'hidden';
  frame.style.width = '';
  frame.style.height = '';
  frame.src = encodeURIComponent(entry.file);
  approved.checked = entry.verdict === 'approved';
  denied.checked = entry.verdict === 'denied';
  comment.value = entry.comment;
  updateResult();
}

/** The picture that just loaded is the one to show, at its own whole scale. */
function loaded() {
  fit();
  frame.style.visibility = 'visible';
}

/** The clipboard fallback: focus the result box and select the whole string. */
function selectResult() {
  result.focus();
  result.select();
}

previous.addEventListener('click', function () { show(app.at - 1); });
next.addEventListener('click', function () { show(app.at + 1); });
frame.addEventListener('load', loaded);
window.addEventListener('resize', fit);
document.addEventListener('keydown', function (event) {
  // The text boxes keep the arrow keys for their own carets, and the radios
  // for their own group: the page only takes an unmodified arrow elsewhere.
  if (event.target === comment || event.target === result || event.target === approved || event.target === denied) return;
  // A modified arrow belongs to the browser, not the page.
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'ArrowLeft') show(app.at - 1);
  else if (event.key === 'ArrowRight') show(app.at + 1);
  else return;
  event.preventDefault();
});
approved.addEventListener('change', function () {
  if (app.frames.length === 0) return; // nothing to judge, nothing to record
  app.frames[app.at].verdict = 'approved';
  updateResult();
});
denied.addEventListener('change', function () {
  if (app.frames.length === 0) return;
  app.frames[app.at].verdict = 'denied';
  updateResult();
});
comment.addEventListener('input', function () {
  if (app.frames.length === 0) return;
  app.frames[app.at].comment = comment.value;
  updateResult();
});
copy.addEventListener('click', function () {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== 'function') {
    selectResult();
    return;
  }
  let done;
  try {
    done = clipboard.writeText(result.value);
  } catch (error) {
    selectResult();
    return;
  }
  // A refusing clipboard must not raise a stray error; selecting is the fallback.
  if (done !== undefined && done !== null && typeof done.then === 'function') {
    done.then(undefined, function () { selectResult(); });
  }
});

show(0);
`;

/** The page's one classic script: the pure functions read back as source, the file list, and the wiring. */
function pageScript(files: readonly string[]): string {
  const list = JSON.stringify(files).replace(/</g, '\\u003c');
  return [
    "'use strict';",
    `const displayName = ${displayName};`,
    `const frameScale = ${frameScale};`,
    `const resultString = ${resultString};`,
    `const files = ${list};`,
    WIRING,
  ].join('\n');
}

/** The review page: one picture at a time, the controls under it, for the frames given. */
export function reviewPage(frames: readonly ReviewFrame[]): string {
  const script = pageScript(frames.map((frame) => frame.file));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Scene frames review</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        height: 100vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: #111;
        color: #eee;
        font-family: system-ui, sans-serif;
      }
      header { flex: none; display: flex; align-items: baseline; gap: 10px; padding: 10px 14px 0; }
      #frame-name { margin: 0; font-size: 18px; font-weight: 600; }
      #frame-count { color: #9a9a9a; }
      #stage {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      img#frame { display: block; image-rendering: pixelated; }
      footer { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; }
      .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      label { font-size: 13px; color: #ccc; }
      button { font: inherit; }
      textarea {
        width: 100%;
        resize: none;
        padding: 4px 6px;
        background: #1a1a1a;
        color: #eee;
        border: 1px solid #444;
        border-radius: 4px;
        font: inherit;
        font-size: 13px;
      }
      #result { flex: 1 1 auto; width: auto; min-width: 0; }
    </style>
  </head>
  <body>
    <header>
      <h1 id="frame-name"></h1>
      <span id="frame-count"></span>
    </header>
    <div id="stage"><img id="frame" alt=""></div>
    <footer>
      <div class="row">
        <button id="previous" type="button">Previous</button>
        <button id="next" type="button">Next</button>
        <label><input type="radio" id="approved" name="verdict"> Approved</label>
        <label><input type="radio" id="denied" name="verdict"> Denied</label>
      </div>
      <label for="comment">Comment</label>
      <textarea id="comment" rows="2"></textarea>
      <label for="result">Result</label>
      <div class="row">
        <textarea id="result" rows="2" readonly></textarea>
        <button id="copy" type="button">Copy result</button>
      </div>
    </footer>
    <script>${script}</script>
  </body>
</html>
`;
}
