// Packs prwalk, installs the tarball the way the README tells a user to (`npm install -g`, here
// under a temporary prefix) and runs the installed binary from outside the repository, following
// the README: version, skill, voices, the quick start with the example that ships in the
// package, and prwalk update --check. Nothing asks GitHub for the latest version. Run it with `pnpm test:pack`, which builds first.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { version } = manifest;
const work = mkdtempSync(join(tmpdir(), 'prwalk-pack-'));
const home = join(work, 'home');
const prefix = join(work, 'prefix');
const bin = join(prefix, 'bin', 'prwalk');
const installed = join(prefix, 'lib', 'node_modules', 'prwalk');
const example = (name) => join(installed, 'test', 'fixtures', name);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Runs the installed prwalk from the temporary folder and returns what it printed. The check for
 * a newer version is off, unless `env` turns it on.
 */
function prwalk(...args) {
  return prwalkWith({}, ...args);
}

function prwalkWith(env, ...args) {
  const run = spawnSync(bin, args, {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PRWALK_HOME: home, PRWALK_PORT: '0', PRWALK_UPDATE_CHECK: '0', ...env },
  });
  check(run.status === 0, `prwalk ${args.join(' ')} failed (${run.status}): ${run.stderr}`);
  return run.stdout;
}

try {
  execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: root, stdio: 'ignore' });
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
  check(tarball !== undefined, 'pnpm pack wrote no tarball');
  execFileSync('npm', ['install', '--global', '--prefix', prefix, join(work, tarball)], {
    cwd: work,
    stdio: 'ignore',
  });

  check(existsSync(join(installed, 'LICENSE')), 'the package does not include LICENSE');
  const development = Object.keys(manifest.devDependencies).filter((name) =>
    existsSync(join(installed, 'node_modules', name)),
  );
  check(
    development.length === 0,
    `the installed package brings development dependencies: ${development.join(', ')}`,
  );

  check(prwalk('--version').trim() === version, `--version does not print ${version}`);
  const defaults = readFileSync(join(root, 'skill', 'PREFERENCES.md'), 'utf8');
  const guide = prwalk('skill');
  check(
    guide.startsWith(readFileSync(join(root, 'skill', 'GUIDE.md'), 'utf8')) &&
      guide.endsWith(defaults),
    'prwalk skill does not print skill/GUIDE.md followed by skill/PREFERENCES.md',
  );
  check(
    prwalk('preferences', '--path').trim() === join(home, 'preferences.md') &&
      readFileSync(join(home, 'preferences.md'), 'utf8') === defaults,
    'prwalk preferences does not find the preferences created from skill/PREFERENCES.md',
  );
  const skills = join(work, 'skills');
  prwalk('skill', 'install', '--dir', skills);
  check(
    readFileSync(join(skills, 'prwalk', 'SKILL.md'), 'utf8') ===
      readFileSync(join(root, 'skill', 'SKILL.md'), 'utf8'),
    'prwalk skill install does not install skill/SKILL.md',
  );
  prwalk('validate', example('example-script.json'));
  const examples = /ship with prwalk, in `([^`]+)`/.exec(prwalk('voice', 'guide'))?.[1];
  check(
    examples !== undefined && existsSync(join(examples, 'macos-say.mjs')),
    'prwalk voice guide does not point at the installed example adapters',
  );

  check(
    /^kokoro \(not installed\): /.test(prwalk('voice', 'list')),
    'prwalk voice list does not list the kokoro voice from the installed catalog',
  );

  const url = /Viewer: (\S+)/.exec(prwalk('open', '--patch', example('example.diff')))?.[1];
  try {
    const page = await fetch(url);
    check(page.status === 200, `the installed daemon serves the viewer with ${page.status}`);
    prwalk('play', example('example-script.json'));
  } finally {
    prwalk('stop');
  }
  // A check saved a moment ago: prwalk update --check answers from it, without asking GitHub.
  writeFileSync(
    join(home, 'update-check.json'),
    JSON.stringify({ checkedAt: Date.now(), latest: '99.0.0' }),
  );
  check(
    prwalkWith({ PRWALK_UPDATE_CHECK: '1' }, 'update', '--check').trim() ===
      `prwalk 99.0.0 is available (installed: ${version}). Run prwalk update to install it.`,
    'prwalk update --check does not tell about the newer version saved in update-check.json',
  );

  console.log(`The packed prwalk ${version} installs and runs.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
