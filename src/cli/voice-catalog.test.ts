import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { loadAdapter, Synthesizer } from '../server/adapter.js';
import { readConfig, writeVoiceConfig } from '../server/state.js';
import {
  findVoice,
  type InstallTools,
  installVoice,
  isInstalled,
  readCatalog,
  removeVoice,
} from './voice-catalog.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const catalog = join(root, 'voices');
const testCatalog = join(root, 'test', 'fixtures', 'catalog');

/** An installer that writes a marker for npm and a model folder with one top folder inside. */
function fakeTools() {
  const calls: string[] = [];
  const tools: InstallTools = {
    async installDependencies(dir) {
      calls.push('npm');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      const { dependencies, overrides } = pkg;
      writeFileSync(
        join(dir, 'node_modules', 'installed.json'),
        JSON.stringify({ dependencies, overrides }),
      );
    },
    async download(url, into) {
      calls.push(`download ${url}`);
      mkdirSync(join(into, 'fake-model'), { recursive: true });
      writeFileSync(join(into, 'fake-model', 'voice.txt'), 'weights');
    },
  };
  return { tools, calls };
}

describe('the voice catalog', () => {
  it('lists the voices shipped, and refuses an unknown name with the list', () => {
    const voices = readCatalog(catalog);
    expect(voices.map((voice) => voice.name)).toEqual(['kokoro']);
    expect(voices[0]).toMatchObject({
      languages: expect.arrayContaining(['es', 'en']),
      dependencies: { 'sherpa-onnx-node': expect.stringMatching(/^\d+\.\d+\.\d+$/) },
    });
    expect(() => findVoice(voices, 'nope')).toThrow(
      'There is no voice named "nope" to install. Installable voices: kokoro.',
    );
  });

  it('ships adapters that follow the contract, named like their folder', async () => {
    for (const voice of readCatalog(catalog)) {
      expect((await loadAdapter(join(voice.dir, 'adapter.mjs'))).name).toBe(voice.name);
    }
  });
});

describe('installing a voice', () => {
  it('installs the engine, the adapter and the model, tries it and chooses it; again, it repairs', async () => {
    const home = tempDir();
    const voice = findVoice(readCatalog(testCatalog), 'fake');
    const { tools, calls } = fakeTools();
    const progress: string[] = [];
    const installed = await installVoice(voice, {
      home,
      options: { voice: 'x' },
      tools,
      progress: (line) => progress.push(line),
    });

    const dir = join(home, 'voices', 'fake');
    expect(installed).toEqual({ dir, provider: join(dir, 'adapter.mjs') });
    expect(JSON.parse(readFileSync(join(dir, 'node_modules', 'installed.json'), 'utf8'))).toEqual({
      dependencies: { 'fake-engine': '1.0.0' },
      overrides: { 'fake-native': '1.0.0' },
    });
    expect(readFileSync(join(dir, 'model', 'voice.txt'), 'utf8')).toBe('weights');
    expect(readConfig(home).voice).toEqual({
      provider: join(dir, 'adapter.mjs'),
      options: { voice: 'x' },
    });
    expect(progress).toEqual([
      `Step 1 of 5: installing the engine in ${dir} (npm install fake-engine@1.0.0)...`,
      'Step 2 of 5: copying the adapter...',
      'Step 3 of 5: downloading the model (about 1 MB)...',
      'Step 4 of 5: trying a sentence...',
      'Step 5 of 5: choosing the voice...',
    ]);

    // A second run installs the engine and the adapter again, and keeps the model it has; a run
    // with a model from another URL downloads it.
    await installVoice(voice, { home, options: {}, tools, progress: () => {} });
    const update = { ...voice, model: 'https://example.invalid/fake-model-2.tar.bz2' };
    await installVoice(update, { home, options: {}, tools, progress: () => {} });
    expect(calls).toEqual([
      'npm',
      'download https://example.invalid/fake-model.tar.bz2',
      'npm',
      'npm',
      'download https://example.invalid/fake-model-2.tar.bz2',
    ]);
    expect(readConfig(home).voice?.options).toEqual({});
  });

  it('stops at the step that fails, says how to retry, and leaves the voice in use alone', async () => {
    const home = tempDir();
    const voice = findVoice(readCatalog(testCatalog), 'fake');
    const { tools } = fakeTools();
    await installVoice(voice, { home, options: {}, tools, progress: () => {} });
    const inUse = readConfig(home).voice;
    tools.download = async () => {
      throw new Error('the download answered 404');
    };

    const update = { ...voice, model: 'https://example.invalid/fake-model-2.tar.bz2' };
    await expect(
      installVoice(update, { home, options: { voice: 'x' }, tools, progress: () => {} }),
    ).rejects.toThrow(
      'Step 3 of 5 failed (downloading the model): the download answered 404. The voice in use has not changed. Run prwalk voice install fake --option voice=x to try again.',
    );
    expect(readConfig(home).voice).toEqual(inUse);
    expect(isInstalled(home, 'fake')).toBe(true);
    expect(readdirSync(join(home, 'voices'))).toEqual(['fake']);
    const adapter = await loadAdapter(join(home, 'voices', 'fake', 'adapter.mjs'));
    await expect(new Synthesizer(adapter, {}).synthesize('Hola.', 'es')).resolves.toMatchObject({
      mimeType: 'audio/wav',
    });
  });
});

describe('removing a voice', () => {
  it('deletes its folder, and goes back to the browser voice only if it was the one in use', async () => {
    const home = tempDir();
    const voice = findVoice(readCatalog(testCatalog), 'fake');
    const install = () =>
      installVoice(voice, { home, options: {}, tools: fakeTools().tools, progress: () => {} });
    await install();
    expect(() => removeVoice(home, '..')).toThrow('The voice ".." is not installed.');
    expect(existsSync(join(home, 'voices', 'fake'))).toBe(true);

    const chosen = { provider: '/elsewhere/adapter.mjs', options: {} };
    writeVoiceConfig(home, chosen);
    expect(removeVoice(home, 'fake')).toEqual({ wasInUse: false });
    expect(existsSync(join(home, 'voices', 'fake'))).toBe(false);
    expect(readConfig(home).voice).toEqual(chosen);

    await install();
    expect(removeVoice(home, 'fake')).toEqual({ wasInUse: true });
    expect(readConfig(home).voice).toEqual({ provider: 'browser', options: {} });
    expect(() => removeVoice(home, 'fake')).toThrow('The voice "fake" is not installed.');
  });
});

describe('the kokoro adapter', () => {
  it('picks a voice by the language of the sentence, falls back to English, and obeys --option voice', async () => {
    const { pickVoice } = (await import(join(catalog, 'kokoro', 'adapter.mjs'))) as {
      pickVoice(lang: string, options: Record<string, string>): unknown;
    };
    expect(pickVoice('es-ES', {})).toEqual({ voice: 'ef_dora', speaker: 28, phonemes: 'es' });
    expect(pickVoice('en-GB', {})).toEqual({ voice: 'af_heart', speaker: 3, phonemes: 'en-us' });
    expect(pickVoice('de', {})).toEqual({ voice: 'af_heart', speaker: 3, phonemes: 'en-us' });
    expect(pickVoice('es', { voice: 'em_alex' })).toEqual({
      voice: 'em_alex',
      speaker: 29,
      phonemes: 'es',
    });
    expect(() => pickVoice('es', { voice: 'nope' })).toThrow(/^Unknown voice "nope"; pick one of /);
  });
});
