import { describe, expect, it, vi } from 'vitest';
import { RemoteVoice, type Sound } from './remote.js';
import type { VoiceProvider } from './voice.js';

/** A daemon that answers each request when the test says so, and a player that never ends alone. */
function setup() {
  const requests: {
    body: unknown;
    token: string | null;
    signal: AbortSignal;
    answer: (ok: boolean) => void;
  }[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        requests.push({
          body: JSON.parse(String(init.body)),
          token: new Headers(init.headers).get('x-prwalk-token'),
          signal: init.signal as AbortSignal,
          answer: (ok) =>
            resolve(
              ok
                ? new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/wav' } })
                : Response.json({ error: 'The voice adapter failed: no' }, { status: 502 }),
            ),
        });
      }),
  );
  const sounds: { rate: number; stopped: boolean; end: () => void; fail: () => void }[] = [];
  const play = (_audio: Blob, rate: number): Sound => {
    let end = () => {};
    let fail = () => {};
    const ended = new Promise<void>((resolve, reject) => {
      end = resolve;
      fail = () => reject(new Error('cannot play'));
    });
    const sound = { rate, stopped: false, end, fail };
    sounds.push(sound);
    return {
      ended,
      stop: () => {
        sound.stopped = true;
      },
    };
  };
  const fallback = {
    name: 'browser',
    speed: 1,
    speak: vi.fn(),
    cancel: vi.fn(),
  } satisfies VoiceProvider;
  const names: string[] = [];
  const voice = new RemoteVoice({
    name: 'nova',
    token: 'secret',
    fallback,
    labels: { failing: (name, instead) => `${name} failing, ${instead}` },
    onNameChange: (name) => names.push(name),
    setFallbackSpeed: (rate) => {
      fallback.speed = rate;
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    play,
  });
  return { voice, fetch, requests, sounds, fallback, names };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('remote voice', () => {
  it('plays the audio of the sentence it prepared, at the chosen speed', async () => {
    const { voice, fetch, requests, sounds } = setup();
    voice.choose(1.2);
    voice.prepare('Hola.', 'es');
    const onEnd = vi.fn();
    voice.speak('Hola.', 'es', onEnd);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requests[0]).toMatchObject({ body: { text: 'Hola.', lang: 'es' }, token: 'secret' });

    requests[0]?.answer(true);
    await settle();
    expect(sounds.map(({ rate }) => rate)).toEqual([1.2]);
    sounds[0]?.end();
    await settle();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('cancelling aborts the request and stops the sound', async () => {
    const { voice, requests, sounds } = setup();
    const onEnd = vi.fn();
    voice.speak('Una.', 'es', onEnd);
    voice.cancel();
    expect(requests[0]?.signal.aborted).toBe(true);

    voice.speak('Dos.', 'es', onEnd);
    requests[1]?.answer(true);
    await settle();
    voice.cancel();
    sounds[0]?.end();
    await settle();
    expect(sounds[0]?.stopped).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('says a sentence that fails with the fallback, and stops asking after three in a row', async () => {
    const { voice, requests, sounds, fallback, names } = setup();
    // The first one comes but cannot be played; the others do not come.
    voice.speak('Una.', 'es', () => {});
    requests[0]?.answer(true);
    await settle();
    sounds[0]?.fail();
    await settle();
    const fail = async (text: string) => {
      voice.speak(text, 'es', () => {});
      requests.at(-1)?.answer(false);
      await settle();
    };
    await fail('Dos.');
    // One that plays breaks the run, and the header names the voice again.
    voice.speak('Buena.', 'es', () => {});
    requests.at(-1)?.answer(true);
    await settle();
    sounds[1]?.end();
    await settle();
    for (const text of ['Tres.', 'Cuatro.', 'Cinco.']) await fail(text);
    expect(fallback.speak.mock.calls.map(([text]) => text)).toEqual([
      'Una.',
      'Dos.',
      'Tres.',
      'Cuatro.',
      'Cinco.',
    ]);
    expect(names).toEqual(['nova failing, browser', 'nova', 'nova failing, browser']);

    voice.speak('Seis.', 'es', () => {});
    expect(requests).toHaveLength(6);
    expect(fallback.speak).toHaveBeenCalledTimes(6);

    // The speed menu still works: the fallback says the sentences at the speed chosen.
    voice.choose(1.4);
    expect(fallback.speed).toBe(1.4);
    expect(voice.speed).toBe(1.4);
  });
});
