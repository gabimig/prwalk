/**
 * Something that can say a sentence out loud. The playback engine only talks to this, so the
 * browser's speech, the silent fallback and a voice the daemon synthesizes are interchangeable.
 */
export type VoiceProvider = {
  /** What to show in the header, like "Mónica" or "silent". */
  readonly name: string;
  /**
   * How much faster than normal it speaks (1 when missing). The pauses between sentences are
   * divided by it.
   */
  readonly speed?: number;
  /** Says `text` in the BCP-47 language `lang` and calls `onEnd` once it has been said. */
  speak(text: string, lang: string, onEnd: () => void): void;
  /** Stops the sentence being said; its `onEnd` may still arrive and must be ignored. */
  cancel(): void;
  /**
   * A hint that `text` is likely the next sentence, so a voice that takes time to get ready (one
   * synthesized by the daemon) can start now and leave no gap.
   */
  prepare?(text: string, lang: string): void;
};
