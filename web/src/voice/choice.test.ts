import { describe, expect, it } from 'vitest';
import { chosenVoice, loadChoice, saveChoice } from './choice.js';

const voices = [
  { name: 'Mónica', lang: 'es-ES', localService: true },
  { name: 'Paulina', lang: 'es-MX', localService: true },
  { name: 'Samantha', lang: 'en-US', localService: true },
];

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('voice choice', () => {
  it('is remembered per language, and a voice that is gone falls back to the usual pick', () => {
    const storage = memoryStorage();
    saveChoice(() => storage, 'es-ES', { voice: 'Mónica', speed: 'fast' });

    expect(loadChoice(() => storage, 'es')).toEqual({ voice: 'Mónica', speed: 'fast' });
    expect(loadChoice(() => storage, 'en')).toEqual({ voice: null, speed: 'normal' });
    expect(chosenVoice(voices, 'es', 'Mónica')?.name).toBe('Mónica');
    expect(chosenVoice(voices.slice(1), 'es', 'Mónica')?.name).toBe('Paulina');
    const remote = { name: 'Nube', lang: 'es-ES', localService: false };
    expect(chosenVoice([...voices, remote], 'es', 'Nube')?.name).toBe('Mónica');
    expect(chosenVoice(voices, 'es', 'Samantha')?.name).toBe('Mónica');
  });

  it('works without remembering when the browser storage is blocked or holds something else', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    expect(() => saveChoice(blocked, 'es', { voice: 'Mónica', speed: 'fast' })).not.toThrow();
    expect(loadChoice(blocked, 'es')).toEqual({ voice: null, speed: 'normal' });

    const storage = memoryStorage();
    storage.setItem('prwalk.voice.es', '{"voice": 7, "speed": "warp"}');
    expect(loadChoice(() => storage, 'es')).toEqual({ voice: null, speed: 'normal' });
  });
});
