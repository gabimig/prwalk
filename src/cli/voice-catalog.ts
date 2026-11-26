import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadAdapter, Synthesizer } from '../server/adapter.js';
import { readConfig, writeVoiceConfig } from '../server/state.js';
import { UserError } from './errors.js';

/**
 * The voices prwalk can install: one folder each in the package's `voices/`, with a `voice.json`
 * and the `adapter.mjs` it copies. Their engines and models are not prwalk's dependencies: they
 * are installed apart, into `<PRWALK_HOME>/voices/<name>/`, when the user asks.
 */
export type CatalogVoice = z.infer<typeof voiceSchema> & { name: string; dir: string };

const exactVersion = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be an exact version, like 1.2.3');

const voiceSchema = z.strictObject({
  description: z.string().min(1),
  /** BCP-47 primary languages it speaks well. */
  languages: z.array(z.string().min(1)).min(1),
  /** About how much it downloads: the engine and the model. */
  downloadMB: z.number().positive(),
  /** Every part it installs, with its licence. */
  licenses: z.array(z.strictObject({ part: z.string().min(1), license: z.string().min(1) })).min(1),
  /** npm packages of the engine, at exact versions; `overrides` pins their own dependencies. */
  dependencies: z.record(z.string(), exactVersion),
  overrides: z.record(z.string(), exactVersion).optional(),
  /** A .tar.bz2 with the model, unpacked into `model/`. */
  model: z.url(),
  /** The sentence tried once it is installed. */
  test: z.strictObject({ text: z.string().min(1), lang: z.string().min(1) }),
});

/** The voices in a catalog folder, by name. */
export function readCatalog(dir: string): CatalogVoice[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = join(dir, name, 'voice.json');
      const parsed = voiceSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (!parsed.success) throw new Error(`${path} is not valid: ${parsed.error.message}`);
      return { ...parsed.data, name, dir: join(dir, name) };
    });
}

/** The catalog voice called `name`, or a UserError listing the ones there are. */
export function findVoice(catalog: CatalogVoice[], name: string): CatalogVoice {
  const voice = catalog.find((candidate) => candidate.name === name);
  if (voice === undefined) {
    const names = catalog.map((candidate) => candidate.name).join(', ');
    throw new UserError(
      `There is no voice named "${name}" to install. Installable voices: ${names}.`,
    );
  }
  return voice;
}

/** `<home>/voices`: one folder per installed voice. */
export function voicesHome(home: string): string {
  return join(home, 'voices');
}

/** Written last by an install that got through every step. */
const INSTALLED = 'installed.json';
/** Inside `model/`: the URL it was downloaded from, so a new install can keep it. */
const MODEL_SOURCE = '.prwalk-source';

/** Whether `name` is installed and finished installing. */
export function isInstalled(home: string, name: string): boolean {
  return existsSync(join(voicesHome(home), name, INSTALLED));
}

/** What the installer does outside the process; the tests give fake ones. */
export type InstallTools = {
  /** Runs `npm install` in `dir`, which has a package.json. */
  installDependencies(dir: string): Promise<void>;
  /** Downloads the archive at `url` and unpacks it into the folder `into`. */
  download(url: string, into: string): Promise<void>;
};

export type InstallRequest = {
  home: string;
  options: Record<string, string>;
  tools: InstallTools;
  /** Told where the install is, one line per step. */
  progress(line: string): void;
};

/**
 * Installs a catalog voice into `<home>/voices/<name>/`: the engine with npm, the adapter, the
 * model; tries a sentence and only then chooses it in config.json. Every step works in a folder
 * apart, `<name>.new`, which takes the place of the installed one only once the sentence was
 * spoken, so a step that fails stops the install with a UserError naming it and the voice in use,
 * this one included, stays as it was. Running it again repairs or updates the install, keeping a
 * model that was downloaded from the same URL.
 */
export async function installVoice(
  voice: CatalogVoice,
  { home, options, tools, progress }: InstallRequest,
): Promise<{ dir: string; provider: string }> {
  const dir = join(voicesHome(home), voice.name);
  const provider = join(dir, 'adapter.mjs');
  const staging = `${dir}.new`;
  const model = join(dir, 'model');
  const stagedModel = join(staging, 'model');
  /** Set while the installed model sits in the new folder, to give it back if a step fails. */
  let borrowedModel = false;
  const packages = Object.entries(voice.dependencies).map(
    ([name, version]) => `${name}@${version}`,
  );
  const steps: [string, string, () => Promise<void>][] = [
    [
      `installing the engine in ${dir} (npm install ${packages.join(' ')})`,
      'installing the engine',
      async () => {
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(staging, { recursive: true });
        const pkg = {
          name: `prwalk-voice-${voice.name}`,
          private: true,
          description: `The ${voice.name} voice of prwalk, installed by prwalk voice install.`,
          dependencies: voice.dependencies,
          ...(voice.overrides !== undefined && { overrides: voice.overrides }),
        };
        writeFileSync(join(staging, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
        await tools.installDependencies(staging);
      },
    ],
    [
      'copying the adapter',
      'copying the adapter',
      async () => copyFileSync(join(voice.dir, 'adapter.mjs'), join(staging, 'adapter.mjs')),
    ],
    [
      `downloading the model (about ${voice.downloadMB} MB)`,
      'downloading the model',
      async () => {
        if (readText(join(model, MODEL_SOURCE)) === voice.model) {
          renameSync(model, stagedModel);
          borrowedModel = true;
          return;
        }
        const partial = `${stagedModel}.partial`;
        try {
          await tools.download(voice.model, partial);
          const unpacked = singleFolderIn(partial);
          writeFileSync(join(unpacked, MODEL_SOURCE), voice.model);
          renameSync(unpacked, stagedModel);
        } finally {
          rmSync(partial, { recursive: true, force: true });
        }
      },
    ],
    [
      'trying a sentence',
      'trying a sentence',
      async () => {
        const adapter = await loadAdapter(join(staging, 'adapter.mjs'));
        await new Synthesizer(adapter, options).synthesize(voice.test.text, voice.test.lang);
      },
    ],
    [
      'choosing the voice',
      'choosing the voice',
      async () => {
        writeFileSync(join(staging, INSTALLED), `${JSON.stringify({ model: voice.model })}\n`);
        const old = `${dir}.old`;
        rmSync(old, { recursive: true, force: true });
        if (existsSync(dir)) renameSync(dir, old);
        try {
          renameSync(staging, dir);
        } catch (error) {
          if (existsSync(old)) renameSync(old, dir);
          throw error;
        }
        borrowedModel = false;
        rmSync(old, { recursive: true, force: true });
        writeVoiceConfig(home, { provider, options });
      },
    ],
  ];
  for (const [index, [doing, failed, step]] of steps.entries()) {
    progress(`Step ${index + 1} of ${steps.length}: ${doing}...`);
    try {
      await step();
    } catch (error) {
      if (borrowedModel) renameSync(stagedModel, model);
      rmSync(staging, { recursive: true, force: true });
      const given = Object.entries(options).map(([key, value]) => ` --option ${key}=${value}`);
      throw new UserError(
        `Step ${index + 1} of ${steps.length} failed (${failed}): ${messageOf(error)}. The voice in use has not changed. Run prwalk voice install ${voice.name}${given.join('')} to try again.`,
      );
    }
  }
  return { dir, provider };
}

/**
 * Deletes an installed voice. If it was the voice in use, the browser's is chosen instead.
 */
export function removeVoice(home: string, name: string): { wasInUse: boolean } {
  const dir = join(voicesHome(home), name);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !existsSync(dir)) {
    throw new UserError(`The voice "${name}" is not installed.`);
  }
  const wasInUse = readConfig(home).voice?.provider === join(dir, 'adapter.mjs');
  rmSync(dir, { recursive: true, force: true });
  if (wasInUse) writeVoiceConfig(home, { provider: 'browser', options: {} });
  return { wasInUse };
}

/** The archive's own top folder when it has only that, else the folder itself. */
function singleFolderIn(dir: string): string {
  const entries = readdirSync(dir, { withFileTypes: true });
  const only = entries[0];
  return entries.length === 1 && only?.isDirectory() ? join(dir, only.name) : dir;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');
}
