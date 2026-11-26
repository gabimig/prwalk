import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.js';

/** The skill folder ships with the package, next to dist/. */
const skillFile = (name: string) => fileURLToPath(new URL(`../../skill/${name}`, import.meta.url));

/** `prwalk skill`: prints the full agent guide, as it is. */
export function printGuide(): void {
  process.stdout.write(readFileSync(skillFile('GUIDE.md'), 'utf8'));
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
