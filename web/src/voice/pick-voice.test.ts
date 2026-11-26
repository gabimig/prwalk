import { describe, expect, it } from 'vitest';
import { pickVoice } from './pick-voice.js';

const voices = [
  { name: 'Mónica', lang: 'es-ES', localService: true },
  { name: 'Paulina', lang: 'es-MX', localService: true },
  { name: 'Paulina (Enhanced)', lang: 'es-MX', localService: true },
  { name: 'Google español (Premium)', lang: 'es-ES', localService: false },
  { name: 'Daniel', lang: 'en_GB', localService: true },
  { name: 'Samantha', lang: 'en-US', localService: true },
  { name: 'Thomas', lang: 'fr-FR', localService: true },
];

describe('pickVoice', () => {
  it('prefers an enhanced local voice, then the exact region, then any of the language', () => {
    expect(pickVoice(voices, 'es-ES')?.name).toBe('Paulina (Enhanced)');
    expect(pickVoice(voices, 'en-GB')?.name).toBe('Daniel');
    expect(pickVoice(voices, 'fr-CA')?.name).toBe('Thomas');
    expect(pickVoice(voices, 'de')).toBeUndefined();
  });

  it('leaves the low-quality and novelty voices last, even in the exact region', () => {
    const macVoices = [
      { name: 'Eddy (Spanish (Spain))', lang: 'es-ES', localService: true },
      { name: 'Bad News', lang: 'es-ES', localService: true },
      { name: 'Paulina', lang: 'es-MX', localService: true },
    ];
    expect(pickVoice(macVoices, 'es-ES')?.name).toBe('Paulina');
    expect(pickVoice(macVoices.slice(0, 2), 'es-ES')?.name).toBe('Eddy (Spanish (Spain))');
  });
});
