import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHome, preferencesPath, prwalkHome } from '../server/state.js';
import { UserError } from './errors.js';
import { type JsonOption, print } from './session-commands.js';

/** The skill folder ships with the package, next to dist/. */
const skillFile = (name: string) => fileURLToPath(new URL(`../../skill/${name}`, import.meta.url));

const defaultPreferences = () => readFileSync(skillFile('PREFERENCES.md'), 'utf8');

/** Writes the default preferences, readable by their owner only, like config.json. */
function writeDefaults(home: string, path: string): string {
  const text = defaultPreferences();
  ensureHome(home);
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  return text;
}

/** The user's preferences; a missing file is created with the defaults. An existing one is never changed. */
export function readPreferences(home: string): { path: string; text: string; created: boolean } {
  const path = preferencesPath(home);
  try {
    return { path, text: readFileSync(path, 'utf8'), created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { path, text: writeDefaults(home, path), created: true };
}

/** Puts the defaults back, keeping the previous file, if there was one, next to it as `.bak`. */
export function resetPreferences(home: string): { path: string; backup?: string } {
  const path = preferencesPath(home);
  const backup = `${path}.bak`;
  let saved = true;
  try {
    copyFileSync(path, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    saved = false;
  }
  writeDefaults(home, path);
  return saved ? { path, backup } : { path };
}

function cannotUse(home: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Cannot read or create ${preferencesPath(home)}: ${reason}.`;
}

/**
 * The guide, then the user's preferences and where they come from. If the file cannot be read or
 * created, the defaults of the package instead, and a warning: the guide is always given.
 */
export function guideWithPreferences(home: string): { text: string; warning?: string } {
  const guide = readFileSync(skillFile('GUIDE.md'), 'utf8');
  try {
    const { path, text } = readPreferences(home);
    const intro = `The user's preferences follow, from ${path}. Follow them: they override the defaults in this guide (see "Preferences").`;
    return { text: `${guide}\n---\n\n${intro}\n\n${text}` };
  } catch (error) {
    const intro = `The user's preferences could not be read from ${preferencesPath(home)}; these are the defaults.`;
    return {
      text: `${guide}\n---\n\n${intro}\n\n${defaultPreferences()}`,
      warning: `${cannotUse(home, error)} The guide is printed with the default preferences.`,
    };
  }
}

/** `prwalk skill`: prints the full agent guide followed by the user's preferences. */
export function printGuide(): void {
  const { text, warning } = guideWithPreferences(prwalkHome());
  process.stdout.write(text);
  if (warning !== undefined) process.stderr.write(`${warning}\n`);
}

/** `prwalk preferences [--path | --reset]` */
export function preferencesCommand(
  options: JsonOption & { path?: boolean; reset?: boolean },
): void {
  const home = prwalkHome();
  if (options.path) {
    const path = preferencesPath(home);
    print(options, { path }, path);
    return;
  }
  try {
    if (options.reset) {
      const { path, backup } = resetPreferences(home);
      const kept = backup === undefined ? '' : ` The previous version is in ${backup}`;
      print(options, { path, backup }, `Reset ${path} to the defaults.${kept}`);
      return;
    }
    const { path, text, created } = readPreferences(home);
    if (options.json) print(options, { path, created, text }, '');
    else {
      const note = created ? ' (created with the defaults)' : '';
      process.stdout.write(`Preferences: ${path}${note}\n\n${text}`);
    }
  } catch (error) {
    throw new UserError(
      `${cannotUse(home, error)} Check the permissions of that folder, or set PRWALK_HOME to another one.`,
    );
  }
}

/** `prwalk skill install [--dir <folder>]`: copies the stub to `<folder>/prwalk/SKILL.md`. */
export function installSkill(options: { dir?: string }): void {
  const dir = resolve(options.dir ?? join(homedir(), '.claude', 'skills'));
  const target = join(dir, 'prwalk', 'SKILL.md');
  const stub = readFileSync(skillFile('SKILL.md'), 'utf8');
  try {
    mkdirSync(join(dir, 'prwalk'), { recursive: true });
    writeFileSync(target, stub);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UserError(
      `Cannot install the skill in ${dir}: ${reason}. Choose another folder with --dir.`,
    );
  }
  process.stdout.write(`Installed the prwalk skill at ${target}\n`);
}
