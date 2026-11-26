import type { AsideAnswer } from '../../../src/shared/protocol.js';
import type { VoiceProvider } from '../voice/voice.js';
import { splitSentences } from './sentences.js';

/** The answer being said: which one, its sentences, the one being said, and how many are left. */
export type AsideView = {
  status: 'playing' | 'paused';
  answer: AsideAnswer;
  sentences: string[];
  sentence: number;
  /** Answers still to say, this one included. */
  answers: number;
};

/**
 * Answers said aside from the script, in the order they arrive. Toggling pauses and resumes the
 * answer, saying its sentence again; cancelling drops them all. Like the engine, every sentence
 * carries a token, so the end of a cancelled one cannot move on.
 */
export class AsideQueue {
  #queue: { answer: AsideAnswer; sentences: string[] }[] = [];
  #sentence = 0;
  #status: 'playing' | 'paused' = 'playing';
  #token = 0;
  /** The sentence being said has been said whole; a silence runs before the next one. */
  #said = false;
  #silence: ReturnType<typeof setTimeout> | undefined;
  readonly #pause: () => number;
  readonly #voice: VoiceProvider;
  readonly #lang: () => string;
  readonly #onChange: (ended: AsideAnswer | undefined) => void;
  readonly #held: () => boolean;

  /**
   * `onChange` runs whenever the view changes on its own (a sentence or an answer ended); when
   * the last answer has been said it gets that answer. While `held` says so (the page may not
   * speak yet), a first answer waits paused for `toggle` instead of starting. `pause` is the
   * silence between two sentences of an answer, in ms; toggling during it resumes with the next.
   */
  constructor(
    voice: VoiceProvider,
    lang: () => string,
    onChange: (ended: AsideAnswer | undefined) => void,
    held: () => boolean = () => false,
    pause: () => number = () => 0,
  ) {
    this.#pause = pause;
    this.#voice = voice;
    this.#lang = lang;
    this.#onChange = onChange;
    this.#held = held;
  }

  get view(): AsideView | null {
    const current = this.#queue[0];
    if (current === undefined) return null;
    return {
      status: this.#status,
      answer: current.answer,
      sentences: current.sentences,
      sentence: this.#sentence,
      answers: this.#queue.length,
    };
  }

  /**
   * Queues an answer; the first one starts at once, unless held. An answer with no words is
   * ignored.
   */
  add(answer: AsideAnswer): void {
    const sentences = splitSentences(answer.text);
    if (sentences.length === 0) return;
    this.#queue.push({ answer, sentences });
    if (this.#queue.length === 1) {
      this.#sentence = 0;
      this.#status = this.#held() ? 'paused' : 'playing';
      if (this.#status === 'playing') this.#speak();
    }
  }

  toggle(): void {
    if (this.#queue.length === 0) return;
    if (this.#status === 'playing') {
      this.#status = 'paused';
      this.#stop();
    } else {
      this.#status = 'playing';
      if (this.#said) this.#sentenceEnded();
      else this.#speak();
    }
  }

  /** Drops every answer and stops the voice if it was saying one. */
  cancel(): void {
    if (this.#queue.length === 0) return;
    this.#queue = [];
    this.#said = false;
    this.#stop();
  }

  #speak(): void {
    this.#stop();
    const token = this.#token;
    const text = this.#queue[0]?.sentences[this.#sentence];
    if (text === undefined) return;
    this.#voice.speak(text, this.#lang(), () => {
      if (token !== this.#token) return;
      const more = this.#sentence < (this.#queue[0]?.sentences.length ?? 0) - 1;
      const silence = more ? this.#pause() : 0;
      if (silence <= 0) {
        this.#sentenceEnded();
        return;
      }
      this.#said = true;
      this.#silence = setTimeout(() => {
        if (token === this.#token) this.#sentenceEnded();
      }, silence);
    });
  }

  #stop(): void {
    this.#token++;
    clearTimeout(this.#silence);
    this.#voice.cancel();
  }

  #sentenceEnded(): void {
    this.#said = false;
    const current = this.#queue[0];
    if (current === undefined) return;
    if (this.#sentence < current.sentences.length - 1) {
      this.#sentence++;
    } else {
      this.#queue.shift();
      this.#sentence = 0;
      if (this.#queue.length === 0) {
        this.#token++;
        this.#onChange(current.answer);
        return;
      }
    }
    this.#speak();
    this.#onChange(undefined);
  }
}
