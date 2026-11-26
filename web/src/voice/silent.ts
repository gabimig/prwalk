import type { VoiceProvider } from './voice.js';

/**
 * Says nothing: waits about as long as reading the sentence takes. The fallback when speech is
 * unavailable, and what the tests use (`?voice=silent&speed=<n>` makes it n times faster).
 */
export class SilentVoice implements VoiceProvider {
  readonly name: string;
  readonly speed: number;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(name: string, speed = 1) {
    this.name = name;
    this.speed = speed;
  }

  speak(text: string, _lang: string, onEnd: () => void): void {
    this.cancel();
    this.#timer = setTimeout(onEnd, (900 + text.length * 55) / this.speed);
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
