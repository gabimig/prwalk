import type { VoiceProvider } from './voice.js';

/** A sound being played: it resolves when it ends, rejects if it cannot be played, and can be cut short. */
export type Sound = { ended: Promise<void>; stop(): void };

/** After this many sentences in a row fail, the remote voice is not asked again. */
const MAX_FAILURES = 3;
/** How many prepared sentences are kept waiting to be said. */
const MAX_PREPARED = 2;

export type RemoteVoiceOptions = {
  /** The adapter's name, shown in the header. */
  name: string;
  /** Lets the page ask the daemon for audio; it comes with the voice over the WebSocket. */
  token: string;
  /** Says the sentences the adapter could not. */
  fallback: VoiceProvider;
  labels: { failing: (name: string, fallback: string) => string };
  onNameChange: (name: string) => void;
  /** Tells the fallback the speed chosen, so the sentences it says follow the menu too. */
  setFallbackSpeed?: (rate: number) => void;
  fetch?: typeof fetch;
  play?: (audio: Blob, rate: number) => Sound;
};

/**
 * A voice the daemon synthesizes with the user's adapter: the page asks `POST /api/tts` for each
 * sentence's audio and plays it at the chosen speed, keeping the pitch. `prepare` asks for the
 * next sentence early, so there is no gap.
 *
 * A sentence that fails is said by the fallback, and the header says so; after three failures in
 * a row the adapter is not asked again (until the page gets another voice).
 */
export class RemoteVoice implements VoiceProvider {
  #name: string;
  #rate = 1;
  #failures = 0;
  /** Identifies the sentence being said; anything about older ones is ignored. */
  #current = 0;
  #controller: AbortController | undefined;
  #sound: Sound | undefined;
  readonly #prepared = new Map<string, { audio: Promise<Blob>; controller: AbortController }>();
  readonly #options: RemoteVoiceOptions;
  readonly #fetch: typeof fetch;
  readonly #play: (audio: Blob, rate: number) => Sound;

  constructor(options: RemoteVoiceOptions) {
    this.#options = options;
    this.#name = options.name;
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#play = options.play ?? playInPage;
  }

  get name(): string {
    return this.#name;
  }

  /** The rate chosen; the fallback's speed once it says every sentence. */
  get speed(): number {
    return this.#gaveUp() ? (this.#options.fallback.speed ?? 1) : this.#rate;
  }

  /** From the next sentence on, play the audio at this rate, and have the fallback speak at it. */
  choose(rate: number): void {
    this.#rate = rate;
    this.#options.setFallbackSpeed?.(rate);
  }

  prepare(text: string, lang: string): void {
    if (this.#gaveUp()) return;
    const key = keyOf(text, lang);
    if (this.#prepared.has(key)) return;
    const controller = new AbortController();
    const audio = this.#request(text, lang, controller.signal);
    audio.catch(() => {});
    this.#prepared.set(key, { audio, controller });
    for (const [oldest, { controller: old }] of this.#prepared) {
      if (this.#prepared.size <= MAX_PREPARED) break;
      old.abort();
      this.#prepared.delete(oldest);
    }
  }

  speak(text: string, lang: string, onEnd: () => void): void {
    this.#stop();
    const id = ++this.#current;
    if (this.#gaveUp()) {
      this.#options.fallback.speak(text, lang, onEnd);
      return;
    }
    const key = keyOf(text, lang);
    const prepared = this.#prepared.get(key);
    this.#prepared.delete(key);
    const controller = prepared?.controller ?? new AbortController();
    this.#controller = controller;
    const audio = prepared?.audio ?? this.#request(text, lang, controller.signal);
    audio.then(
      (blob) => {
        if (id !== this.#current) return;
        this.#failures = 0;
        this.#rename(this.#options.name);
        const sound = this.#play(blob, this.#rate);
        this.#sound = sound;
        sound.ended.then(
          () => {
            if (id === this.#current) onEnd();
          },
          () => {
            if (id === this.#current) this.#failed(text, lang, onEnd);
          },
        );
      },
      () => {
        if (id === this.#current) this.#failed(text, lang, onEnd);
      },
    );
  }

  /** The adapter's audio did not come or did not play: the fallback says the sentence. */
  #failed(text: string, lang: string, onEnd: () => void): void {
    this.#failures++;
    this.#rename(this.#options.labels.failing(this.#options.name, this.#options.fallback.name));
    this.#options.fallback.speak(text, lang, onEnd);
  }

  cancel(): void {
    this.#current++;
    this.#stop();
    for (const { controller } of this.#prepared.values()) controller.abort();
    this.#prepared.clear();
    this.#options.fallback.cancel();
  }

  #stop(): void {
    this.#controller?.abort();
    this.#controller = undefined;
    this.#sound?.stop();
    this.#sound = undefined;
  }

  #gaveUp(): boolean {
    return this.#failures >= MAX_FAILURES;
  }

  async #request(text: string, lang: string, signal: AbortSignal): Promise<Blob> {
    const reply = await this.#fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-prwalk-token': this.#options.token },
      body: JSON.stringify({ text, lang }),
      signal,
    });
    if (!reply.ok) throw new Error(`The daemon answered ${reply.status} for the audio.`);
    return reply.blob();
  }

  #rename(name: string): void {
    if (name === this.#name) return;
    this.#name = name;
    this.#options.onNameChange(name);
  }
}

function keyOf(text: string, lang: string): string {
  return `${lang}\n${text}`;
}

/** Plays audio in the page; the sound fails if the browser cannot decode or play it. */
function playInPage(audio: Blob, rate: number): Sound {
  const url = URL.createObjectURL(audio);
  const element = new Audio(url);
  element.playbackRate = rate;
  element.preservesPitch = true;
  let finish = () => {};
  let fail = (_reason: unknown) => {};
  const ended = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  }).finally(() => URL.revokeObjectURL(url));
  element.onended = () => finish();
  element.onerror = () => fail(new Error('the browser cannot play this audio'));
  element.play().catch(fail);
  return {
    ended,
    stop: () => {
      element.pause();
      element.removeAttribute('src');
      URL.revokeObjectURL(url);
    },
  };
}
