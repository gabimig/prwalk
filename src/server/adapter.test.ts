import { describe, expect, it } from 'vitest';
import { type Adapter, adapterFrom, audioFrom, Synthesizer } from './adapter.js';

const synthesize = async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' });

describe('voice adapters', () => {
  it('takes the default export, named after its file unless it says otherwise', () => {
    expect(adapterFrom({ default: { synthesize } }, '/voices/my-voice.mjs').name).toBe('my-voice');
    expect(adapterFrom({ default: { name: 'nova', synthesize } }, '/v/a.mjs').name).toBe('nova');
  });

  it('rejects a module that does not follow the contract, and audio it cannot play', () => {
    expect(() => adapterFrom({}, '/v/a.mjs')).toThrow(/default export/);
    expect(() => adapterFrom({ default: { name: 'x' } }, '/v/a.mjs')).toThrow(/synthesize/);
    expect(() => adapterFrom({ default: { name: 3, synthesize } }, '/v/a.mjs')).toThrow(/name/);

    expect(audioFrom({ audio: Buffer.from('abc'), mimeType: 'audio/mpeg' })).toEqual({
      audio: new Uint8Array(Buffer.from('abc')),
      mimeType: 'audio/mpeg',
    });
    expect(() => audioFrom(undefined)).toThrow(/audio, mimeType/);
    expect(() => audioFrom({ audio: 'abc', mimeType: 'audio/wav' })).toThrow(/Uint8Array/);
    expect(() => audioFrom({ audio: new Uint8Array(), mimeType: 'audio/wav' })).toThrow(/empty/);
    expect(() => audioFrom({ audio: new Uint8Array([1]), mimeType: 'audio/flac' })).toThrow(
      /audio\/wav, audio\/mpeg or audio\/ogg/,
    );
    expect(() =>
      audioFrom({ audio: new Uint8Array(20 * 1024 * 1024 + 1), mimeType: 'audio/wav' }),
    ).toThrow(/20 MB/);
  });
});

describe('synthesizer', () => {
  /** An adapter whose syntheses the test settles by hand. */
  function manualAdapter() {
    const calls: { text: string; resolve: (audio: unknown) => void; reject: (e: Error) => void }[] =
      [];
    const adapter: Adapter = {
      name: 'manual',
      synthesize: ({ text }) =>
        new Promise((resolve, reject) => calls.push({ text, resolve, reject })),
    };
    return { adapter, texts: () => calls.map(({ text }) => text), calls };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const wav = { audio: new Uint8Array([1]), mimeType: 'audio/wav' };

  it('synthesizes one sentence at a time, even after one times out, and again one that failed', async () => {
    const { adapter, calls, texts } = manualAdapter();
    const synthesizer = new Synthesizer(adapter, {}, { timeoutMs: 10 });
    const first = synthesizer.synthesize('Una.', 'es');
    const second = synthesizer.synthesize('Dos.', 'es');
    await flush();
    expect(texts()).toEqual(['Una.']);

    // One that takes too long fails, but the next waits until the adapter is really done.
    await expect(first).rejects.toThrow(/longer than/);
    await flush();
    expect(texts()).toEqual(['Una.']);
    calls[0]?.reject(new Error('no'));
    await flush();
    expect(texts()).toEqual(['Una.', 'Dos.']);
    calls[1]?.resolve(wav);
    await expect(second).resolves.toMatchObject({ mimeType: 'audio/wav' });

    // A sentence that failed is not remembered: asking again synthesizes it again.
    const again = synthesizer.synthesize('Una.', 'es');
    await flush();
    expect(texts()).toEqual(['Una.', 'Dos.', 'Una.']);
    calls[2]?.resolve(wav);
    await expect(again).resolves.toMatchObject({ mimeType: 'audio/wav' });
  });
});
