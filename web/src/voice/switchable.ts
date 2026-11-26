import type { VoiceProvider } from './voice.js';

/**
 * The voice the engine holds while the voice in use can change underneath: a new one says the
 * sentences from the next one on, and the sentence being said is left to finish (or to be
 * cancelled) by the voice saying it.
 */
export class SwitchableVoice implements VoiceProvider {
  #current: VoiceProvider;
  #speaking: VoiceProvider | undefined;

  constructor(voice: VoiceProvider) {
    this.#current = voice;
  }

  get current(): VoiceProvider {
    return this.#current;
  }

  get name(): string {
    return this.#current.name;
  }

  get speed(): number {
    return this.#current.speed ?? 1;
  }

  use(voice: VoiceProvider): void {
    this.#current = voice;
  }

  speak(text: string, lang: string, onEnd: () => void): void {
    if (this.#speaking !== undefined && this.#speaking !== this.#current) this.#speaking.cancel();
    this.#speaking = this.#current;
    this.#current.speak(text, lang, onEnd);
  }

  cancel(): void {
    this.#speaking?.cancel();
    if (this.#speaking !== this.#current) this.#current.cancel();
  }

  prepare(text: string, lang: string): void {
    this.#current.prepare?.(text, lang);
  }
}
