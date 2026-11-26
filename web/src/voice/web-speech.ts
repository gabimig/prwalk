import { chosenVoice } from './choice.js';
import { rankVoices } from './pick-voice.js';
import type { VoiceProvider } from './voice.js';

/** How long a sentence may take to start before the browser's speech is given up on. */
const START_TIMEOUT_MS = 2500;
/** How long to wait for the voice list when the browser has not loaded it yet. */
const VOICES_TIMEOUT_MS = 1000;

export type WebSpeechLabels = { browser: string; unavailable: string };

/**
 * The browser's Web Speech API, with only voices that run on this machine. If no such voice
 * speaks the script's language, or a sentence does not start within 2.5 s, it hands over to the
 * fallback for good and reports its new name.
 *
 * The person may choose another of those voices, and a speed; each sentence is said with the
 * choice made by the time it starts.
 *
 * Pausing is cancelling: the native pause fails with some voices.
 */
export class WebSpeechVoice implements VoiceProvider {
  #name: string;
  #failed = false;
  /** Identifies the sentence being said; events of older ones are ignored. */
  #current = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #choice: { voice: string | null; rate: number } = { voice: null, rate: 1 };
  readonly #synth: SpeechSynthesis;
  readonly #fallback: VoiceProvider;
  readonly #labels: WebSpeechLabels;
  readonly #onNameChange: (name: string) => void;

  constructor(
    synth: SpeechSynthesis,
    fallback: VoiceProvider,
    labels: WebSpeechLabels,
    onNameChange: (name: string) => void,
  ) {
    this.#synth = synth;
    this.#fallback = fallback;
    this.#labels = labels;
    this.#onNameChange = onNameChange;
    this.#name = labels.browser;
  }

  get name(): string {
    return this.#name;
  }

  /** The rate chosen; the fallback's speed once it has handed over. */
  get speed(): number {
    return this.#failed ? (this.#fallback.speed ?? 1) : this.#choice.rate;
  }

  /** Whether it has handed over to the fallback for good. */
  get failed(): boolean {
    return this.#failed;
  }

  /** From the next sentence on, say them with this voice (null: the usual pick) and rate. */
  choose(voice: string | null, rate: number): void {
    this.#choice = { voice, rate };
  }

  /** From the next sentence on, say them at this rate, with the voice chosen. */
  chooseSpeed(rate: number): void {
    this.#choice = { ...this.#choice, rate };
  }

  /** The names of the voices that can speak `lang`, best first; empty until the list loads. */
  voiceNames(lang: string): string[] {
    return rankVoices(this.#synth.getVoices(), lang).map((voice) => voice.name);
  }

  /** Calls `listener` whenever the browser's voice list changes; returns how to stop. */
  onVoicesChanged(listener: () => void): () => void {
    this.#synth.addEventListener('voiceschanged', listener);
    return () => this.#synth.removeEventListener('voiceschanged', listener);
  }

  speak(text: string, lang: string, onEnd: () => void): void {
    if (this.#failed) {
      this.#fallback.speak(text, lang, onEnd);
      return;
    }
    const id = ++this.#current;
    this.#whenVoicesLoaded(() => {
      if (id !== this.#current) return;
      const voice = chosenVoice(this.#synth.getVoices(), lang, this.#choice.voice);
      if (voice === undefined) {
        this.#giveUp(text, lang, onEnd);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = this.#choice.rate;
      let started = false;
      utterance.onstart = () => {
        if (id !== this.#current) return;
        started = true;
        clearTimeout(this.#timer);
        this.#rename(voice.name);
      };
      utterance.onend = () => {
        if (id === this.#current) onEnd();
      };
      utterance.onerror = () => {
        if (id !== this.#current) return;
        // A voice that breaks before starting is replaced; one that breaks mid-sentence moves on.
        if (started) onEnd();
        else this.#giveUp(text, lang, onEnd);
      };
      this.#synth.speak(utterance);
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        if (id === this.#current && !started) this.#giveUp(text, lang, onEnd);
      }, START_TIMEOUT_MS);
    });
  }

  cancel(): void {
    this.#current++;
    clearTimeout(this.#timer);
    if (this.#failed) this.#fallback.cancel();
    else this.#synth.cancel();
  }

  #giveUp(text: string, lang: string, onEnd: () => void): void {
    clearTimeout(this.#timer);
    this.#synth.cancel();
    this.#failed = true;
    this.#rename(this.#labels.unavailable);
    this.#fallback.speak(text, lang, onEnd);
  }

  #rename(name: string): void {
    if (name === this.#name) return;
    this.#name = name;
    this.#onNameChange(name);
  }

  /** Some browsers load the voice list after the page: wait for it, but not forever. */
  #whenVoicesLoaded(run: () => void): void {
    if (this.#synth.getVoices().length > 0) {
      run();
      return;
    }
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      this.#synth.removeEventListener('voiceschanged', once);
      run();
    };
    this.#synth.addEventListener('voiceschanged', once);
    setTimeout(once, VOICES_TIMEOUT_MS);
  }
}
