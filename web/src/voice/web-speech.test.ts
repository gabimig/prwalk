import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceInfo } from './pick-voice.js';
import type { VoiceProvider } from './voice.js';
import { WebSpeechVoice } from './web-speech.js';

/** What the provider sets on an utterance; the fake synth fires its events by hand. */
class FakeUtterance {
  voice: VoiceInfo | null = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

const MONICA: VoiceInfo = { name: 'Mónica', lang: 'es-ES', localService: true };

function fakeSynth(voices: VoiceInfo[]) {
  const events = new EventTarget();
  const spoken: FakeUtterance[] = [];
  const synth = {
    voices,
    getVoices: () => synth.voices,
    speak: (utterance: FakeUtterance) => spoken.push(utterance),
    cancel: vi.fn(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    loadVoices(list: VoiceInfo[]) {
      synth.voices = list;
      events.dispatchEvent(new Event('voiceschanged'));
    },
  };
  return { synth, spoken };
}

function setup(voices: VoiceInfo[]) {
  const { synth, spoken } = fakeSynth(voices);
  const fallback = { name: 'silent', speak: vi.fn(), cancel: vi.fn() } satisfies VoiceProvider;
  const names: string[] = [];
  const voice = new WebSpeechVoice(
    synth as unknown as SpeechSynthesis,
    fallback,
    { browser: 'browser', unavailable: 'unavailable' },
    (name) => names.push(name),
  );
  return { synth, spoken, fallback, names, voice };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Web Speech voice', () => {
  it('hands over to the fallback for good when a sentence does not start within 2.5 s', () => {
    const { synth, spoken, fallback, names, voice } = setup([MONICA]);
    const onEnd = () => {};
    voice.speak('Hola.', 'es-ES', onEnd);
    expect(spoken.map(({ text, voice }) => [text, voice?.name])).toEqual([['Hola.', 'Mónica']]);

    vi.advanceTimersByTime(2500);

    expect(fallback.speak).toHaveBeenCalledWith('Hola.', 'es-ES', onEnd);
    expect(names).toEqual(['unavailable']);
    voice.speak('Adiós.', 'es-ES', onEnd);
    expect(spoken).toHaveLength(1);
    expect(fallback.speak).toHaveBeenLastCalledWith('Adiós.', 'es-ES', onEnd);

    const synthCancels = synth.cancel.mock.calls.length;
    voice.cancel();
    expect(fallback.cancel).toHaveBeenCalledOnce();
    expect(synth.cancel).toHaveBeenCalledTimes(synthCancels);
  });

  it('cancels the speech and ignores the events of the cancelled sentence', () => {
    const { synth, spoken, names, voice } = setup([MONICA]);
    const onEnd = vi.fn();
    voice.speak('Hola.', 'es-ES', onEnd);

    voice.cancel();
    spoken[0]?.onstart?.();
    spoken[0]?.onend?.();

    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
    expect(names).toEqual([]);
  });

  it('moves on when the voice fails after it started', () => {
    const { spoken, fallback, names, voice } = setup([MONICA]);
    const onEnd = vi.fn();
    voice.speak('Hola.', 'es-ES', onEnd);
    spoken[0]?.onstart?.();
    spoken[0]?.onerror?.();

    expect(onEnd).toHaveBeenCalledOnce();
    expect(fallback.speak).not.toHaveBeenCalled();
    expect(names).toEqual(['Mónica']);
  });

  it('waits for the voice list when the browser has not loaded it yet', () => {
    const { synth, spoken, voice } = setup([]);
    voice.speak('Hola.', 'es-ES', () => {});
    expect(spoken).toHaveLength(0);

    synth.loadVoices([MONICA]);

    expect(spoken.map(({ voice }) => voice?.name)).toEqual(['Mónica']);
  });

  it('says the next sentence with the voice and speed chosen meanwhile', () => {
    const paulina = { name: 'Paulina', lang: 'es-MX', localService: true };
    const { spoken, voice } = setup([MONICA, paulina]);
    voice.speak('Uno.', 'es-ES', () => {});
    voice.choose('Paulina', 1.4);
    voice.speak('Dos.', 'es-ES', () => {});

    expect(spoken.map(({ voice, rate }) => [voice?.name, rate])).toEqual([
      ['Mónica', 1],
      ['Paulina', 1.4],
    ]);
  });
});
