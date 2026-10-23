// XMAS-46c "Sound button and page wiring": the sound button's drawing and name for each state, as pure
// functions. The DOM wiring is checked in the browser (tests/browser/sound.spec.ts).
import { describe, expect, it } from 'vitest';
import { drawings } from '../shared/art.generated.ts';
import { soundDrawing, soundName } from './sound-button.ts';

describe('soundDrawing', () => {
  it('shows the speaker with sound waves when on and the speaker with a red cross when muted', () => {
    expect(soundDrawing(true)).toBe(drawings['speaker-on']);
    expect(soundDrawing(false)).toBe(drawings['speaker-muted']);
  });
});

describe('soundName', () => {
  it('says the state and what a press does now', () => {
    expect(soundName(true)).toBe('Sound is on. Turn sound off');
    expect(soundName(false)).toBe('Sound is off. Turn sound on');
  });
});
