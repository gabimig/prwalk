import { describe, expect, it } from 'vitest';
import { splitSentences } from './sentences.js';

describe('splitSentences', () => {
  it('splits after . ! ? … and line breaks, but not after simple abbreviations', () => {
    expect(
      splitSentences(
        '  Sí, falla. ¿Por qué? Porque el almacén, p. ej. Redis, no responde!\nLo vemos en el\ncódigo, etc. Y ya está…  Vale',
      ),
    ).toEqual([
      'Sí, falla.',
      '¿Por qué?',
      'Porque el almacén, p. ej. Redis, no responde!',
      'Lo vemos en el',
      'código, etc. Y ya está…',
      'Vale',
    ]);
  });
});
