import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapter, Synthesizer } from '../server/adapter.js';
import { prwalkHome, readConfig, type VoiceConfig, writeVoiceConfig } from '../server/state.js';
import { callDaemon, type Daemon, findDaemon, unexpectedReply } from './daemon-client.js';
import { UserError } from './errors.js';
import { type JsonOption, print } from './session-commands.js';
import {
  type CatalogVoice,
  findVoice,
  installVoice,
  isInstalled,
  readCatalog,
  removeVoice,
} from './voice-catalog.js';
import { realTools } from './voice-download.js';

const DEFAULT_TEXT = 'This is a test of the prwalk voice.';

/** The configured voice; a broken config.json is the user's to fix. */
function configuredVoice(): VoiceConfig | undefined {
  try {
    return readConfig(prwalkHome()).voice;
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
}

/** An adapter, loaded and checked, or a UserError saying what is wrong with it. */
async function adapterAt(path: string) {
  try {
    return await loadAdapter(path);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
}

/** `prwalk voice` */
export function voiceCommand(options: JsonOption): void {
  const voice = configuredVoice();
  const json = {
    chosen: voice !== undefined,
    provider: voice?.provider ?? 'browser',
    options: voice?.options ?? {},
  };
  if (voice === undefined) {
    print(
      options,
      json,
      'Voice: browser (the default). The user has not chosen a voice yet: keep it with prwalk voice use browser, or plug in another one (prwalk voice guide).',
    );
  } else if (voice.provider === 'browser') {
    print(options, json, 'Voice: browser.');
  } else {
    const given = Object.entries(voice.options).map(([key, value]) => `${key}=${value}`);
    const extra = given.length === 0 ? '' : ` with ${given.join(', ')}`;
    print(options, json, `Voice: adapter ${voice.provider}${extra}.`);
  }
}

/** `prwalk voice use browser` or `prwalk voice use <adapter> [--option key=value]...` */
export async function voiceUseCommand(
  provider: string,
  options: JsonOption & { option?: string[] },
): Promise<void> {
  const given = parseOptions(options.option ?? []);
  let voice: VoiceConfig;
  let name = 'browser';
  if (provider === 'browser') {
    if (Object.keys(given).length > 0) {
      throw new UserError('--option only applies to an adapter, not to the browser voice.');
    }
    voice = { provider, options: {} };
  } else {
    const path = resolve(provider);
    name = `${(await adapterAt(path)).name} (${path})`;
    voice = { provider: path, options: given };
  }
  writeVoiceConfig(prwalkHome(), voice);
  const daemon = await reloadVoice();
  print(options, { ok: true, ...voice, daemon }, `Voice: ${name}.${switches(daemon)}`);
}

/** Tells a running daemon to read config.json again; false when none is running. */
async function reloadVoice(): Promise<boolean> {
  const daemon: Daemon | undefined = await findDaemon(prwalkHome());
  if (daemon === undefined) return false;
  const reply = await callDaemon(daemon, 'POST', '/api/voice');
  if (reply.status !== 200) throw unexpectedReply(reply);
  return true;
}

function switches(daemon: boolean): string {
  return daemon ? ' The viewer switches to it from the next sentence.' : '';
}

/** The voices shipped with prwalk that `prwalk voice install` can install. */
function catalog(): CatalogVoice[] {
  return readCatalog(fileURLToPath(new URL('../../voices', import.meta.url)));
}

/** `prwalk voice list` */
export function voiceListCommand(options: JsonOption): void {
  const home = prwalkHome();
  const voice = configuredVoice();
  const voices = catalog().map(({ dir: _, test: __, ...entry }) => ({
    ...entry,
    installed: isInstalled(home, entry.name),
  }));
  const lines = voices.map((entry) => {
    const licences = entry.licenses.map(({ part, license }) => `${part}: ${license}`);
    return [
      `${entry.name} (${entry.installed ? 'installed' : 'not installed'}): ${entry.description} Speaks ${entry.languages.join(', ')}. Downloads about ${entry.downloadMB} MB.`,
      `  Licences: ${licences.join('; ')}.`,
    ].join('\n');
  });
  const inUse =
    voice === undefined
      ? 'browser (not chosen yet)'
      : voice.provider === 'browser'
        ? 'browser'
        : `adapter ${voice.provider}`;
  lines.push(`Voice in use: ${inUse}. Install one with prwalk voice install <name>.`);
  print(
    options,
    {
      voices,
      voice: {
        chosen: voice !== undefined,
        provider: voice?.provider ?? 'browser',
        options: voice?.options ?? {},
      },
    },
    lines.join('\n'),
  );
}

/** `prwalk voice install <name> [--option key=value]...`: tells how it goes on stderr. */
export async function voiceInstallCommand(
  name: string,
  options: JsonOption & { option?: string[] },
): Promise<void> {
  const given = parseOptions(options.option ?? []);
  const voice = findVoice(catalog(), name);
  const home = prwalkHome();
  configuredVoice(); // A broken config.json stops it before anything is downloaded.
  const { provider } = await installVoice(voice, {
    home,
    options: given,
    tools: realTools,
    progress: (line) => process.stderr.write(`${line}\n`),
  });
  const daemon = await reloadVoice();
  print(
    options,
    { ok: true, name, provider, options: given, daemon },
    `Voice: ${name} is installed and chosen (${provider}).${switches(daemon)} Try it with prwalk voice test.`,
  );
}

/** `prwalk voice remove <name>` */
export async function voiceRemoveCommand(name: string, options: JsonOption): Promise<void> {
  const { wasInUse } = removeVoice(prwalkHome(), name);
  const daemon = wasInUse && (await reloadVoice());
  const back = wasInUse
    ? ` It was the voice in use: back to the browser voice.${switches(daemon)}`
    : '';
  print(options, { ok: true, name, wasInUse, daemon }, `Removed the voice ${name}.${back}`);
}

/** `prwalk voice test [text] [--lang <lang>] [--out <file>]` */
export async function voiceTestCommand(
  text: string | undefined,
  options: JsonOption & { lang?: string; out?: string },
): Promise<void> {
  const voice = configuredVoice();
  if (voice === undefined || voice.provider === 'browser') {
    print(
      options,
      { ok: true, provider: 'browser', audio: null },
      'The browser voice can only be heard in the viewer.',
    );
    return;
  }
  const adapter = await adapterAt(voice.provider);
  const started = performance.now();
  let audio: Awaited<ReturnType<Synthesizer['synthesize']>>;
  try {
    audio = await new Synthesizer(adapter, voice.options).synthesize(
      text ?? DEFAULT_TEXT,
      options.lang ?? 'en',
    );
  } catch (error) {
    throw new UserError(
      `The voice adapter failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const ms = Math.round(performance.now() - started);
  const out = options.out === undefined ? undefined : resolve(options.out);
  if (out !== undefined) {
    try {
      writeFileSync(out, audio.audio);
    } catch (error) {
      throw new UserError(
        `Cannot save the audio to ${out}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const bytes = audio.audio.length;
  print(
    options,
    {
      ok: true,
      provider: voice.provider,
      name: adapter.name,
      mimeType: audio.mimeType,
      bytes,
      ms,
      out: out ?? null,
    },
    `Synthesized ${bytes} bytes of ${audio.mimeType} in ${ms} ms with ${adapter.name}.${out === undefined ? '' : ` Saved to ${out}.`}`,
  );
}

/** `prwalk voice guide`: how to write an adapter, with where the examples are. */
export function printVoiceGuide(): void {
  const guide = fileURLToPath(new URL('../../skill/VOICES.md', import.meta.url));
  const examples = fileURLToPath(new URL('../../examples/voices', import.meta.url));
  process.stdout.write(readFileSync(guide, 'utf8').replaceAll('{{examples}}', examples));
}

/** `--option key=value`, repeated. */
function parseOptions(raw: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (const pair of raw) {
    const at = pair.indexOf('=');
    if (at < 1) throw new UserError(`--option must look like key=value, got "${pair}".`);
    options[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return options;
}
