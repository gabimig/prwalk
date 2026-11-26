/** The parts of a SpeechSynthesisVoice the choice looks at. */
export type VoiceInfo = { name: string; lang: string; localService: boolean };

/** How the systems mark their better voices: "(Enhanced)", "(Premium)", "(mejorada)"... */
const ENHANCED = /\b(enhanced|premium|mejorada|améliorée|verbessert|migliorata|melhorada)\b/i;

/**
 * macOS voices that sound poor for narration: the low-quality ones and the novelty ones. Their
 * names may carry the language in brackets, like "Eddy (Spanish (Spain))".
 */
const LOW_QUALITY = new Set(
  [
    'Eddy',
    'Flo',
    'Grandma',
    'Grandpa',
    'Reed',
    'Rocko',
    'Sandy',
    'Shelley',
    'Albert',
    'Bad News',
    'Bahh',
    'Bells',
    'Boing',
    'Bubbles',
    'Cellos',
    'Good News',
    'Jester',
    'Organ',
    'Superstar',
    'Trinoids',
    'Whisper',
    'Wobble',
    'Zarvox',
  ].map((name) => name.toLowerCase()),
);

/**
 * The voices that can speak `lang`, best first: only voices that run on this machine (narration
 * must not leave it), of the same language. Enhanced ones first, then those of the exact region,
 * then any other; the low-quality and novelty voices last.
 */
export function rankVoices<V extends VoiceInfo>(voices: readonly V[], lang: string): V[] {
  const wanted = normalise(lang);
  const language = wanted.split('-')[0];
  const scored: { voice: V; score: number }[] = [];
  for (const voice of voices) {
    const tag = normalise(voice.lang);
    if (!voice.localService || tag.split('-')[0] !== language) continue;
    const region = tag === wanted ? 1 : 0;
    const score = isLowQuality(voice.name)
      ? region
      : 2 + (ENHANCED.test(voice.name) ? 2 : 0) + region;
    scored.push({ voice, score });
  }
  // A stable sort: among equals, the browser's own order.
  return scored.sort((a, b) => b.score - a.score).map(({ voice }) => voice);
}

/** The best voice to speak `lang` with (see rankVoices), or undefined if there is none. */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[], lang: string): V | undefined {
  return rankVoices(voices, lang)[0];
}

function isLowQuality(name: string): boolean {
  return LOW_QUALITY.has(
    name
      .replace(/\s*\(.*$/, '')
      .trim()
      .toLowerCase(),
  );
}

function normalise(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}
