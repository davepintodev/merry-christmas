// XMAS-33 "The ?perf readout": the readout on screen. It is a small labelled
// group under the countdown, at the left, in monospace, with a button that
// restarts the 30 s window. Its text is set about twice a second; it takes no
// pointer input except on the button, so the scene underneath is untouched.
import type { PerfSnapshot } from './perf-stats.ts';

/** What the readout shows; each value is a span with data-perf set to its key. */
type Key = 'countdown-visible' | 'globe-ready' | 'fps-now' | 'fps-window' | 'worst-frame' | 'work' | 'version' | 'window';

const ROWS: readonly [Key, string][] = [
  ['countdown-visible', 'countdown shown'],
  ['globe-ready', 'globe ready'],
  ['fps-now', 'fps, last second'],
  ['fps-window', 'fps, window'],
  ['worst-frame', 'worst frame'],
  ['work', 'scene draw'],
  ['version', 'version'],
  ['window', 'window'],
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
  line-height: 1.5;
  color: #f2f2f2;
  background: rgba(0, 0, 0, 0.6);
}
#perf-readout .row {
  display: flex;
  justify-content: space-between;
  gap: 1em;
}
#perf-readout button {
  margin-top: 4px;
  pointer-events: auto;
  font: inherit;
  color: inherit;
  background: #333;
  border: 1px solid #888;
}
`;

export interface Readout {
  /** Puts one snapshot on screen and keeps the readout just below the countdown. */
  show(snapshot: PerfSnapshot): void;
}

/** A number with its unit, or the dash while nothing is measured yet. */
function quantity(value: number | null, digits: number, unit: string): string {
  return value === null ? DASH : `${value.toFixed(digits)} ${unit}`;
}

/** The text of every field for one snapshot. */
function fields(snap: PerfSnapshot): Record<Key, string> {
  return {
    'countdown-visible': quantity(snap.countdownVisibleMs, 0, 'ms'),
    'globe-ready': quantity(snap.globeReadyMs, 0, 'ms'),
    'fps-now': quantity(snap.fpsNow, 1, 'fps'),
    'fps-window': quantity(snap.fpsWindow, 1, 'fps'),
    'worst-frame': quantity(snap.worstFrameMs, 1, 'ms'),
    work: quantity(snap.workMs, 2, 'ms'),
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
  for (const [key, label] of ROWS) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.dataset['perf'] = key;
    row.append(name, value);
    root.append(row);
    values.set(key, value);
  }
  const button = document.createElement('button');
  button.id = 'perf-restart';
  button.type = 'button';
  button.textContent = 'Restart 30 s window';
  button.addEventListener('click', onRestart);
  root.append(button);
  document.body.append(root);

  return {
    show(snap) {
      const text = fields(snap);
      for (const [key, value] of values) value.textContent = text[key];
      const countdown = document.querySelector('canvas#countdown');
      root.style.top = `${countdown?.getBoundingClientRect().bottom ?? 0}px`;
    },
  };
}
