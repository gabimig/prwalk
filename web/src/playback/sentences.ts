/** Words that end in a full stop without ending the sentence, in Spanish and English. */
const ABBREVIATIONS = new Set([
  'ej',
  'etc',
  'e.g',
  'i.e',
  'vs',
  'sr',
  'sra',
  'dr',
  'dra',
  'núm',
  'pág',
  'aprox',
  'approx',
  'mr',
  'mrs',
]);

const ENDS_SENTENCE = /[.!?…]["'»”)\]]*$/;

/**
 * Splits an answer into the sentences the voice says one by one: after `.`, `!`, `?` or `…`
 * followed by a space, and at every line break. A full stop after a single letter or a common
 * abbreviation ("p. ej.", "etc.", "e.g.") does not end a sentence.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const line of text.split(/\n+/)) {
    let current: string[] = [];
    const words = line.split(/\s+/).filter((word) => word !== '');
    words.forEach((word, index) => {
      current.push(word);
      const last = index === words.length - 1;
      if (last || (ENDS_SENTENCE.test(word) && !isAbbreviation(word))) {
        sentences.push(current.join(' '));
        current = [];
      }
    });
  }
  return sentences;
}

function isAbbreviation(word: string): boolean {
  if (!word.endsWith('.')) return false;
  const bare = word.slice(0, -1).toLowerCase();
  return /^\p{L}$/u.test(bare) || ABBREVIATIONS.has(bare);
}
