import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGlobal, setGlobal } from 'reactn';
import callManager from './callManager';

// withPending marks a mic / camera / screen change as in flight so the controls can show a spinner and
// ignore extra clicks.
const idle = { audio: false, video: false, screen: false };

beforeEach(async () => {
  await setGlobal({ mediaPending: { ...idle } });
});

describe('callManager.withPending', () => {
  it('is pending while the change runs and clears afterwards', async () => {
    let seenDuring;
    await callManager.withPending('video', async () => {
      seenDuring = { ...getGlobal().mediaPending };
    });
    expect(seenDuring).toEqual({ audio: false, video: true, screen: false });
    expect(getGlobal().mediaPending).toEqual(idle);
  });

  it('ignores a second click on the same control while one is in flight', async () => {
    let release;
    const first = callManager.withPending('audio', () => new Promise((resolve) => { release = resolve; }));
    let ran = false;
    await callManager.withPending('audio', async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release('done');
    await expect(first).resolves.toBe('done');
  });

  it('lets different controls change at the same time', async () => {
    let release;
    const mic = callManager.withPending('audio', () => new Promise((resolve) => { release = resolve; }));
    let cameraRan = false;
    await callManager.withPending('video', async () => {
      cameraRan = true;
    });
    expect(cameraRan).toBe(true);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await mic;
  });

  it('clears the pending flag even when the change throws', async () => {
    await expect(
      callManager.withPending('screen', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(getGlobal().mediaPending.screen).toBe(false);
  });
});
