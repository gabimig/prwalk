import { describe, expect, it, vi } from 'vitest';
import { SwitchableVoice } from './switchable.js';
import type { VoiceProvider } from './voice.js';

const fake = (name: string) =>
  ({ name, speak: vi.fn(), cancel: vi.fn(), prepare: vi.fn() }) satisfies VoiceProvider;

describe('switchable voice', () => {
  it('speaks with the new voice from the next sentence; cancelling reaches the one speaking', () => {
    const browser = fake('browser');
    const remote = fake('nova');
    const voice = new SwitchableVoice(browser);
    voice.speak('Una.', 'es', () => {});

    voice.use(remote);
    expect(voice.name).toBe('nova');
    voice.cancel();
    expect(browser.cancel).toHaveBeenCalled();

    voice.prepare('Dos.', 'es');
    voice.speak('Dos.', 'es', () => {});
    expect(remote.prepare).toHaveBeenCalledWith('Dos.', 'es');
    expect(remote.speak).toHaveBeenCalledWith('Dos.', 'es', expect.any(Function));
    expect(browser.speak).toHaveBeenCalledTimes(1);
  });
});
