// XMAS-43b: asking for motion access and listening, through a fake host with a timer the test drives.
import { describe, expect, it } from 'vitest';
import { SHAKE_SETTINGS, type MotionReading } from './shake.ts';
import { createShakeAccess, hostFromWindow, type ShakeHost } from './shake-access.ts';

function fakeHost(over: { needsTap?: boolean; available?: boolean; answer?: () => Promise<string> } = {}) {
  const log = { asked: 0, listening: 0, stopped: 0, timers: [] as { ms: number; fn: () => void; cancelled: boolean }[] };
  let handler: ((r: MotionReading) => void) | null = null;
  const host: ShakeHost = {
    needsTap: over.needsTap ?? true,
    available: over.available ?? true,
    requestPermission() {
      log.asked++;
      return (over.answer ?? (() => Promise.resolve('granted')))();
    },
    listen(h) {
      log.listening++;
      handler = h;
      return () => {
        log.stopped++;
        handler = null;
      };
    },
    setTimer(fn, ms) {
      const t = { ms, fn, cancelled: false };
      log.timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  };
  return {
    host,
    log,
    send: (r: MotionReading) => handler?.(r),
    fire: () => log.timers.filter((t) => !t.cancelled).forEach((t) => t.fn()),
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const jolt = (timeSec: number, x = 20): MotionReading => ({ timeSec, acceleration: { x, y: 0, z: 0 } });

describe('shake access', () => {
  it('shows the button and does not listen while the browser needs a tap', () => {
    const f = fakeHost();
    const access = createShakeAccess(f.host);
    expect(access.buttonShown).toBe(true);
    expect(f.log.listening).toBe(0);
    expect(access.take()).toEqual({ raise: 0, push: { x: 0, y: 0, z: 0 } });
  });

  it('asks inside the tap itself, before any await', () => {
    const f = fakeHost();
    createShakeAccess(f.host).tap();
    expect(f.log.asked).toBe(1);
  });

  it('listens and waits the named time once granted, and the button goes', async () => {
    const f = fakeHost();
    const access = createShakeAccess(f.host);
    access.tap();
    await flush();
    expect(access.buttonShown).toBe(false);
    expect(f.log.listening).toBe(1);
    expect(f.log.timers.map((t) => t.ms)).toEqual([SHAKE_SETTINGS.waitSec * 1000]);
  });

  it.each([
    ['denied', () => Promise.resolve('denied')],
    ['rejected', () => Promise.reject(new Error('no'))],
  ])('says nothing more and never listens when the answer is %s', async (_n, answer) => {
    const f = fakeHost({ answer });
    const access = createShakeAccess(f.host);
    access.tap();
    await flush();
    expect(access.buttonShown).toBe(false);
    expect(access.live).toBe(false);
    expect(f.log.listening).toBe(0);
    expect(f.log.timers).toEqual([]);
  });

  it('gives up and stops listening when no real data arrives in time, even if empty readings did', async () => {
    const f = fakeHost();
    const access = createShakeAccess(f.host);
    access.tap();
    await flush();
    expect(() => f.send({ acceleration: { x: null, y: undefined, z: 1 } })).not.toThrow();
    expect(() => f.send({})).not.toThrow();
    f.fire();
    expect(f.log.stopped).toBe(1);
    expect(access.live).toBe(false);
    expect(access.buttonShown).toBe(false);
  });

  it('is live on the first real reading, cancels the wait, and passes the shake through take()', async () => {
    const f = fakeHost();
    const access = createShakeAccess(f.host);
    access.tap();
    await flush();
    f.send(jolt(1));
    f.send(jolt(1.05));
    expect(access.live).toBe(true);
    expect(f.log.timers.every((t) => t.cancelled)).toBe(true);
    f.fire();
    expect(f.log.stopped).toBe(0);
    expect(access.take().raise).toBeGreaterThan(0);
  });

  it('listens at once with no button where no tap is needed', () => {
    const f = fakeHost({ needsTap: false });
    const access = createShakeAccess(f.host);
    expect(access.buttonShown).toBe(false);
    expect(f.log.listening).toBe(1);
    f.send(jolt(1));
    expect(access.live).toBe(true);
  });

  it('does nothing without motion events at all', () => {
    const f = fakeHost({ available: false, needsTap: false });
    const access = createShakeAccess(f.host);
    expect(access.buttonShown).toBe(false);
    expect(f.log.listening).toBe(0);
  });
});

describe('hostFromWindow', () => {
  const win = (motion: unknown, userAgent: string) => ({ DeviceMotionEvent: motion, navigator: { userAgent } }) as never;

  it('needs a tap only where requestPermission is a function, whatever the browser calls itself', () => {
    const fn = { requestPermission: () => Promise.resolve('granted') };
    expect(hostFromWindow(win(fn, 'Mozilla/5.0 (Windows NT 10.0) Firefox')).needsTap).toBe(true);
    expect(hostFromWindow(win(class {}, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari')).needsTap).toBe(false);
  });

  it('is unavailable when the browser has no DeviceMotionEvent', () => {
    expect(hostFromWindow(win(undefined, 'x')).available).toBe(false);
  });
});
