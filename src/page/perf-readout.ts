// XMAS-33 "The ?perf readout": the readout on screen. It is a small labelled
// group under the countdown, at the left, in monospace, with a button that
// restarts the 30 s window. Its text is set about twice a second; it takes no
// pointer input except on the button, so the scene underneath is untouched.
import type { Spread, TraceSecond } from './frame-trace.ts';
import type { PerfSnapshot } from './perf-stats.ts';

/** The draw's canvas calls, per frame (XMAS-113): their milliseconds and calls. */
type CanvasKey = 'save' | 'path' | 'clip' | 'draw' | 'transform' | 'fill';

/** The fine layer's phases (XMAS-113 phase 2): their milliseconds per frame, canvas calls inside them included. */
type PhaseKey = 'inputs' | 'glass' | 'flakes' | 'shadows' | 'faces' | 'shapes-rest' | 'base' | 'other';

/** What the readout shows; each value is a span with data-perf set to its key. */
type Key = 'countdown-visible' | 'globe-ready' | 'fps-now' | 'fps-window' | 'worst-frame' | 'work' | 'fine-layer' | CanvasKey | PhaseKey | 'version' | 'window';

const ROWS: readonly [Key, string][] = [
  ['countdown-visible', 'countdown shown'],
  ['globe-ready', 'globe ready'],
  ['fps-now', 'fps, last second'],
  ['fps-window', 'fps, window'],
  ['worst-frame', 'worst frame'],
  ['work', 'scene draw'],
  ['fine-layer', 'fine layer'],
  ['version', 'version'],
  ['window', 'window'],
];

/** The canvas figures (XMAS-113): two to a line, or one to a line on a narrow screen (see CSS). */
const CANVAS: readonly [CanvasKey, string][] = [
  ['save', 'canvas save/restore'],
  ['path', 'canvas clip path'],
  ['clip', 'canvas clip()'],
  ['draw', 'canvas drawImage'],
  ['transform', 'canvas setTransform'],
  ['fill', 'canvas fillRect'],
];

/** The fine layer's phases (XMAS-113 phase 2): four to a line, or two on a narrow screen (see CSS). Flakes are both layers' flakes. */
const PHASES: readonly [PhaseKey, string][] = [
  ['inputs', 'inputs'],
  ['glass', 'glass'],
  ['flakes', 'flakes'],
  ['shadows', 'shadows'],
  ['faces', 'faces'],
  ['shapes-rest', 'shapes rest'],
  ['base', 'base'],
  ['other', 'other'],
];

const DASH = '–';

const CSS = `
#perf-readout {
  position: fixed;
  left: 0;
  z-index: 2;
  box-sizing: border-box;
  padding: 6px 8px;
  pointer-events: none;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.25;
  color: #f2f2f2;
  background: rgba(0, 0, 0, 0.6);
  /* The summary rows at the left, the phases beside them, and the canvas figures and the button under both (XMAS-113 phase 2). */
  display: grid;
  grid-template-columns: max-content max-content;
  column-gap: 1.5em;
  align-items: start;
}
#perf-readout .row {
  display: flex;
  justify-content: space-between;
  gap: 1em;
}
#perf-readout .figures {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, max-content);
  column-gap: 1.5em;
}
#perf-readout .phases {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  column-gap: 1.5em;
}
@media (max-width: 480px) {
  #perf-readout {
    grid-template-columns: max-content;
  }
  #perf-readout .figures {
    grid-template-columns: max-content;
  }
}
#perf-readout button {
  grid-column: 1 / -1;
  justify-self: start;
  margin-top: 4px;
  pointer-events: auto;
  font: inherit;
  color: inherit;
  background: #333;
  border: 1px solid #888;
}
`;

export interface Readout {
  /**
   * Puts one snapshot on screen, with the fine layer's average milliseconds and the second's canvas calls (XMAS-113, null
   * while no traced frame was drawn), and keeps the readout just below the countdown.
   */
  show(snapshot: PerfSnapshot, fineMs: number | null, canvas: TraceSecond | null): void;
}

/** A number with its unit, or the dash while nothing is measured yet. */
function quantity(value: number | null, digits: number, unit: string): string {
  return value === null ? DASH : `${value.toFixed(digits)} ${unit}`;
}

/** A sum of milliseconds over the second's frames, as milliseconds per frame. */
function perFrameMs(sum: number, frames: number): string {
  return `${(sum / frames).toFixed(2)} ms`;
}

/** Each canvas call kind's milliseconds and calls per frame, over the second's frames (XMAS-113). */
function canvasFields(canvas: TraceSecond | null): Record<CanvasKey, string> {
  if (canvas === null) return { save: DASH, path: DASH, clip: DASH, draw: DASH, transform: DASH, fill: DASH };
  const frames = canvas.frames;
  const ms = (spread: Spread): string => perFrameMs(spread.sum, frames);
  const calls = (count: number, noun = 'calls'): string => `${Math.round(count / frames)} ${noun}`;
  return {
    save: `${ms(canvas.saveMs)}, ${calls(canvas.saves + canvas.restores)}`,
    path: `${ms(canvas.pathMs)}, ${calls(canvas.paths, 'paths')}`,
    clip: `${ms(canvas.clipMs)}, ${calls(canvas.clips)}`,
    draw: `${ms(canvas.drawImageMs)}, ${calls(canvas.drawImages)}`,
    transform: `${ms(canvas.setTransformMs)}, ${calls(canvas.setTransforms)}`,
    fill: `${ms(canvas.fillRectMs)}, ${calls(canvas.fillRects)}`,
  };
}

/** Each fine layer phase's milliseconds per frame, over the second's frames (XMAS-113 phase 2). */
function phaseFields(canvas: TraceSecond | null): Record<PhaseKey, string> {
  if (canvas === null) {
    return { inputs: DASH, glass: DASH, flakes: DASH, shadows: DASH, faces: DASH, 'shapes-rest': DASH, base: DASH, other: DASH };
  }
  const frames = canvas.frames;
  return {
    inputs: perFrameMs(canvas.inputsMs.sum, frames),
    glass: perFrameMs(canvas.glassMs.sum, frames),
    flakes: perFrameMs(canvas.behindMs.sum + canvas.frontMs.sum, frames),
    shadows: perFrameMs(canvas.shadowsMs.sum, frames),
    faces: perFrameMs(canvas.facesMs.sum, frames),
    'shapes-rest': perFrameMs(canvas.shapesRestMs.sum, frames),
    base: perFrameMs(canvas.baseMs.sum, frames),
    other: perFrameMs(canvas.otherMs.sum, frames),
  };
}

/** The text of every field for one snapshot. */
function fields(snap: PerfSnapshot, fineMs: number | null, canvas: TraceSecond | null): Record<Key, string> {
  return {
    'countdown-visible': quantity(snap.countdownVisibleMs, 0, 'ms'),
    'globe-ready': quantity(snap.globeReadyMs, 0, 'ms'),
    'fps-now': quantity(snap.fpsNow, 1, 'fps'),
    'fps-window': quantity(snap.fpsWindow, 1, 'fps'),
    'worst-frame': quantity(snap.worstFrameMs, 1, 'ms'),
    work: quantity(snap.workMs, 2, 'ms'),
    'fine-layer': quantity(fineMs, 2, 'ms'),
    ...canvasFields(canvas),
    ...phaseFields(canvas),
    version: snap.version,
    window: `${(snap.windowElapsedMs / 1000).toFixed(1)} of 30 s${snap.windowDone ? ', done' : ''}`,
  };
}

/** Builds the readout into the page; onRestart runs when its button is pressed. */
export function mountReadout(onRestart: () => void): Readout {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const root = document.createElement('div');
  root.id = 'perf-readout';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Performance readout');
  const values = new Map<Key, HTMLElement>();
  const makeRow = (key: Key, label: string): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.dataset['perf'] = key;
    row.append(name, value);
    values.set(key, value);
    return row;
  };
  const summary = document.createElement('div');
  for (const [key, label] of ROWS) summary.append(makeRow(key, label));
  root.append(summary);
  const phases = document.createElement('div');
  phases.className = 'phases';
  for (const [key, label] of PHASES) phases.append(makeRow(key, label));
  root.append(phases);
  const figures = document.createElement('div');
  figures.className = 'figures';
  for (const [key, label] of CANVAS) figures.append(makeRow(key, label));
  root.append(figures);
  const button = document.createElement('button');
  button.id = 'perf-restart';
  button.type = 'button';
  button.textContent = 'Restart 30 s window';
  button.addEventListener('click', onRestart);
  root.append(button);
  document.body.append(root);

  return {
    show(snap, fineMs, canvas) {
      const text = fields(snap, fineMs, canvas);
      for (const [key, value] of values) value.textContent = text[key];
      const countdown = document.querySelector('canvas#countdown');
      root.style.top = `${countdown?.getBoundingClientRect().bottom ?? 0}px`;
    },
  };
}
