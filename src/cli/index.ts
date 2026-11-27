#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runDaemon } from '../server/daemon.js';
import { prwalkHome } from '../server/state.js';
import { UserError } from './errors.js';
import { replaceCommand, sayCommand, transportCommand, waitCommand } from './live-commands.js';
import {
  diffCommand,
  focusCommand,
  openCommand,
  playCommand,
  resolvePort,
  statusCommand,
  stopCommand,
} from './session-commands.js';
import { installSkill, preferencesCommand, printGuide } from './skill-commands.js';
import { validateCommand } from './validate.js';
import {
  printVoiceGuide,
  voiceCommand,
  voiceInstallCommand,
  voiceListCommand,
  voiceRemoveCommand,
  voiceTestCommand,
  voiceUseCommand,
} from './voice-commands.js';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * Runs a command; any error is printed as one message with exit code 1 and no trace: on stderr,
 * or with --json as `{ "ok": false, "error": "..." }` on stdout.
 */
function action<Args extends unknown[]>(run: (...args: Args) => Promise<void>) {
  return async (...args: Args) => {
    try {
      await run(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Commander passes the command itself as the last argument.
      const command = args.at(-1);
      if (command instanceof Command && command.opts().json) {
        const errors = error instanceof UserError ? error.errors : undefined;
        const body = { ok: false, error: message, ...(errors !== undefined && { errors }) };
        process.stdout.write(`${JSON.stringify(body)}\n`);
      } else {
        process.stderr.write(`${message}\n`);
      }
      process.exitCode = 1;
    }
  };
}

const program = new Command()
  .name('prwalk')
  .description('Spoken, guided walkthroughs of pull requests, driven by a coding agent.')
  .version(version)
  // Options after a command are that command's: `voice test --json` is not `voice --json`.
  .enablePositionalOptions();

program
  .command('validate')
  .description('Check a walkthrough script without loading it.')
  .argument('<file>', 'path to the script JSON, or - to read it from stdin')
  .option('--json', 'print the result as JSON')
  .action((file: string, options: { json?: boolean }) => {
    process.exitCode = validateCommand(file, options);
  });

program
  .command('open')
  .description('Open a walkthrough session on a GitHub PR, or on local changes without a PR.')
  .argument('[pr]', 'PR number (in the current repository) or URL; omit it for local changes')
  .option(
    '--base <ref>',
    "local changes: branch to compare with (default: the remote's default branch, else main)",
  )
  .option('--patch <file>', 'open a unified git diff saved in a file instead (for demos and tests)')
  .option('--title <text>', 'with --patch: the title to show (default: the file name)')
  .option('--port <n>', 'port for the daemon if it has to start (default: PRWALK_PORT or 4517)')
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nWithout a PR, the diff goes from the fork point with --base to the working tree,\nuncommitted changes included. Files git does not track are left out.',
  )
  .action(action(openCommand));

program
  .command('play')
  .description('Load a walkthrough script into the viewer, or unload it with --clear.')
  .argument('[file]', 'path to the script JSON, or - to read it from stdin')
  .option('--clear', 'unload the script')
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nThe script is checked against the open diff; every problem is printed, one per line.',
  )
  .action(action(playCommand));

program
  .command('diff')
  .description('Print the files and hunks of the open session, or one file with line numbers.')
  .option('--file <path>', "print this file's lines with their old and new line numbers")
  .option('--json', 'print the result as JSON')
  .action(action(diffCommand));

program
  .command('focus')
  .description('Show a range of the diff in the viewer: open the file, scroll to it, highlight it.')
  .argument('[file]', 'a file in the diff, as prwalk diff prints it')
  .option('--lines <range>', 'lines to highlight, like 12-18, or 12 for one line')
  .option('--side <side>', 'which line numbers --lines uses: new (default) or old')
  .option('--clear', 'remove the focus')
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nThe range must fall inside one hunk of the diff; prwalk diff --file <path> shows them.',
  )
  .action(action(focusCommand));

program
  .command('status')
  .description(
    'Say whether the daemon is running, which session it holds, where the playback is, and what happened since the last look.',
  )
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nEvents (pauses, jumps, the end, an answer said) are listed once: the next status or wait\nonly shows newer ones.',
  )
  .action(action(statusCommand));

program
  .command('wait')
  .description(
    'Wait until the user does something in the viewer, the walkthrough ends or an answer has been said; then print the status.',
  )
  .option('--timeout <seconds>', 'give up after this long and print the status anyway', '300')
  .option('--json', 'print the result as JSON')
  .action(action(waitCommand));

for (const [name, description] of [
  ['pause', 'Pause the walkthrough in the viewer.'],
  ['resume', 'Resume the walkthrough in the viewer, saying the current sentence again.'],
] as const) {
  program
    .command(name)
    .description(description)
    .option('--json', 'print the result as JSON')
    .action(action((options: { json?: boolean }) => transportCommand({ type: name }, options)));
}

program
  .command('goto')
  .description('Jump to a step of the walkthrough and play it.')
  .argument('<step>', 'the step id, or its number counted from 1')
  .option('--json', 'print the result as JSON')
  .action(
    action((step: string, options: { json?: boolean }) =>
      transportCommand({ type: 'goto', step }, options),
    ),
  );

program
  .command('say')
  .description(
    'Answer a question out loud, aside from the script: the walkthrough waits paused, then stays paused (or resumes with --resume).',
  )
  .argument('<text>', 'the answer, or - to read it from stdin')
  .option('--question <text>', "the user's question as you understood it, shown above the answer")
  .option('--file <path>', 'show this file of the diff while answering (needs --lines)')
  .option('--lines <range>', 'lines to highlight, like 12-18, or 12 for one line')
  .option('--side <side>', 'which line numbers --lines uses: new (default) or old')
  .option('--resume', 'resume the walkthrough once the answer has been said')
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nSeveral answers in a row are said in order. With a script loaded, prwalk wait returns once\nthey have all been said; without one, they are said on their own and wait does not see them.',
  )
  .action(action(sayCommand));

program
  .command('replace')
  .description('Replace the steps of the loaded script from one step to the end.')
  .argument('<file>', 'a JSON array of steps, like "steps" in a script, or - to read it from stdin')
  .requiredOption(
    '--from <step>',
    'the first step to replace: its id, or its number counted from 1',
  )
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nAn empty array shortens the script. The whole result is checked like prwalk play; on any\nerror nothing changes. The history in the viewer is kept.',
  )
  .action(action(replaceCommand));

const skill = program
  .command('skill')
  .description(
    "Print the full guide for agents: how to give a walkthrough with prwalk, then the user's preferences.",
  )
  .action(action(printGuide));

skill
  .command('install')
  .description('Install the prwalk skill stub, for agents that load skills from a folder.')
  .option(
    '--dir <folder>',
    "skills folder; the stub goes in <folder>/prwalk/SKILL.md (default: Claude Code's ~/.claude/skills)",
  )
  .action(action(async (options: { dir?: string }) => installSkill(options)));

program
  .command('preferences')
  .description(
    "Print the user's preferences for walkthroughs and the file they are in, creating it with the defaults if needed.",
  )
  .option('--path', 'print only the path of the file')
  .option('--reset', 'go back to the defaults, keeping the previous file as preferences.md.bak')
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nThe file is <PRWALK_HOME>/preferences.md, plain Markdown for the agent to follow: edit it by\nhand or ask your agent to. Nothing overwrites it but --reset.',
  )
  .action(
    action(async (options: { path?: boolean; reset?: boolean; json?: boolean }) =>
      preferencesCommand(options),
    ),
  );

const voice = program
  .command('voice')
  .description('Show which voice the viewer speaks with, and whether the user has chosen one.')
  .option('--json', 'print the result as JSON')
  .enablePositionalOptions()
  .action(action(async (options: { json?: boolean }) => voiceCommand(options)));

voice
  .command('use')
  .description("Choose the voice: the browser's own, or a voice adapter module.")
  .argument('<provider>', 'browser, or the path of an adapter (.mjs or .js)')
  .option(
    '--option <key=value>',
    'an option for the adapter; repeat it for several',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nThe adapter is loaded and checked first; on any error nothing changes. The choice is saved\nin config.json, and a running viewer switches from the next sentence. Loading an adapter runs\nits code with your permissions.',
  )
  .action(action(voiceUseCommand));

voice
  .command('test')
  .description('Synthesize a sentence with the chosen voice adapter and say how it went.')
  .argument('[text]', 'the sentence to say (default: a short English one)')
  .option('--lang <lang>', 'its BCP-47 language, like es or en-GB (default: en)')
  .option('--out <file>', 'save the audio to this file')
  .option('--json', 'print the result as JSON')
  .action(action(voiceTestCommand));

voice
  .command('list')
  .description('List the voices prwalk can install, which are installed, and the voice in use.')
  .option('--json', 'print the result as JSON')
  .action(action(async (options: { json?: boolean }) => voiceListCommand(options)));

voice
  .command('install')
  .description('Install a local voice from the list and choose it (prwalk voice list).')
  .argument('<name>', 'the voice, like kokoro')
  .option(
    '--option <key=value>',
    'an option for its adapter; repeat it for several',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .option('--json', 'print the result as JSON')
  .addHelpText(
    'after',
    '\nInstalls the engine with npm and downloads the model into <PRWALK_HOME>/voices/<name>/, tries a\nsentence, then chooses the voice. It takes a while and tells how it goes on stderr. If a step\nfails, the voice in use does not change; run it again to retry, repair or update.',
  )
  .action(action(voiceInstallCommand));

voice
  .command('remove')
  .description('Delete an installed voice; if it was in use, go back to the browser voice.')
  .argument('<name>', 'the voice, like kokoro')
  .option('--json', 'print the result as JSON')
  .action(action(voiceRemoveCommand));

voice
  .command('guide')
  .description('Print the guide to writing a voice adapter.')
  .action(action(async () => printVoiceGuide()));

program
  .command('stop')
  .description('Stop the daemon.')
  .option('--json', 'print the result as JSON')
  .action(action(stopCommand));

program
  .command('daemon')
  .description('(internal) Run the daemon in the foreground.')
  .option('--port <n>', 'port to listen on (default: PRWALK_PORT or 4517)')
  .action(
    action(async (options: { port?: string }) => {
      await runDaemon({ port: resolvePort(options.port), home: prwalkHome() });
    }),
  );

await program.parseAsync();
