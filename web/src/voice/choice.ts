import { pickVoice, rankVoices, type VoiceInfo } from './pick-voice.js';

/** The speeds offered in the header, as speech rates. */
export const SPEEDS = { normal: 1, faster: 1.2, fast: 1.4 } as const;
export type Speed = keyof typeof SPEEDS;

/** The voice and speed the person picked for a language; a null voice is the usual pick. */
export type VoiceChoice = { voice: string | null; speed: Speed };

/** The part of `localStorage` used here. */
export type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_CHOICE: VoiceChoice = { voice: null, speed: 'normal' };

/**
 * The choice remembered for `lang` (its language, any region), or the default. `storage` is a
 * getter because merely reading `localStorage` throws where the browser blocks it.
 */
export function loadChoice(storage: () => ChoiceStorage, lang: string): VoiceChoice {
  try {
    const saved: unknown = JSON.parse(storage().getItem(keyOf(lang)) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return DEFAULT_CHOICE;
    const { voice, speed } = saved as Record<string, unknown>;
    return {
      voice: typeof voice === 'string' ? voice : null,
      speed: typeof speed === 'string' && speed in SPEEDS ? (speed as Speed) : 'normal',
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

/** Remembers the choice for `lang`'s language; without storage it is simply not remembered. */
export function saveChoice(storage: () => ChoiceStorage, lang: string, choice: VoiceChoice): void {
  try {
    storage().setItem(keyOf(lang), JSON.stringify(choice));
  } catch {}
}

/** The voice to speak `lang` with: the chosen one while it is still offered, else the usual pick. */
export function chosenVoice<V extends VoiceInfo>(
  voices: readonly V[],
  lang: string,
  chosen: string | null,
): V | undefined {
  const offered =
    chosen === null ? undefined : rankVoices(voices, lang).find((voice) => voice.name === chosen);
  return offered ?? pickVoice(voices, lang);
}

function keyOf(lang: string): string {
  return `prwalk.voice.${lang.replace(/_/g, '-').toLowerCase().split('-')[0]}`;
}
