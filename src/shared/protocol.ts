import { z } from 'zod';
import type { PlaybackEvent } from './events.js';
import type { PlaybackState } from './playback.js';
import { focusSchema, type Script } from './script.js';

/**
 * What the daemon and the viewer say to each other on `/ws`. The CLI drives the daemon over
 * HTTP; the viewer only reports where its playback is.
 */

/** A focus as the viewer receives it: the side is always explicit. */
export type ViewerFocus = { file: string; side: 'new' | 'old'; lines: [number, number] };

/**
 * An answer to say aside from the script (`prwalk say`): the question as the agent understood
 * it, an optional range of the diff to show while it is said, and whether the script resumes on
 * its own afterwards.
 */
export type AsideAnswer = {
  text: string;
  question?: string;
  focus?: ViewerFocus;
  resume: boolean;
};

/** An order from the agent, applied by the viewer like its own buttons. `step` is an index. */
export type TransportCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'goto'; step: number };

/**
 * Who speaks in the viewer: the browser's own voice, or a voice adapter the daemon runs. The
 * viewer asks for each sentence's audio with `POST /api/tts` and `token`, which is good for
 * nothing else.
 */
export type ViewerVoice = { kind: 'browser' } | { kind: 'remote'; name: string; token: string };

/** A newer prwalk has been released: `current` is the one installed. */
export type ViewerUpdate = { current: string; latest: string };

/** Daemon to viewer, over the WebSocket. */
export type ServerMessage =
  /** A new session is open: fetch `/api/session` and `/api/diff` again. */
  | { type: 'session' }
  /** Show this range of the diff, or nothing in particular when null. */
  | { type: 'focus'; focus: ViewerFocus | null }
  /**
   * Play this script, starting paused at `position` (the last one reported, or the start of a
   * script just loaded). A null script means it was unloaded.
   */
  | { type: 'script'; script: Script | null; position: PlaybackState | null }
  /** Another viewer has connected and plays the script from now on: stop playing. */
  | { type: 'superseded' }
  /** Apply this order and report the position that results, even if nothing changed. */
  | { type: 'command'; command: TransportCommand }
  /** Say this answer aside from the script (queued behind any being said). */
  | { type: 'say'; answer: AsideAnswer }
  /** The script's steps from `from` on have been replaced: keep the history, play this one. */
  | { type: 'replace'; script: Script; from: number }
  /**
   * Speak with this voice from the next sentence on. Sent when a viewer connects only for a
   * remote voice (without one, the viewer speaks with the browser's), and to all on a change.
   */
  | { type: 'voice'; voice: ViewerVoice }
  /**
   * A newer prwalk has been released. Sent when the daemon finds out (it checks when it starts
   * and on every new session) and to each viewer that connects after.
   */
  | { type: 'update'; update: ViewerUpdate };

/**
 * Viewer to daemon: where its playback is, sent every time it changes. `cause` says who changed
 * it (a report without one counts as `auto`), `aside` the answer being said, if any.
 */
export const viewerMessageSchema = z.strictObject({
  type: z.literal('position'),
  status: z.enum(['idle', 'playing', 'paused', 'finished']),
  step: z.int().min(0),
  sentence: z.int().min(0),
  cause: z.enum(['user', 'agent', 'auto']).optional(),
  aside: z
    .strictObject({ status: z.enum(['playing', 'paused']), answers: z.int().min(1) })
    .nullable()
    .optional(),
});

export type ViewerMessage = z.infer<typeof viewerMessageSchema>;

/** Answer of `PUT /api/script`. */
export type ScriptReply = { steps: number; viewers: number };

/** Body of `POST /api/focus`. A missing or null focus clears it. */
export const focusRequestSchema = z.strictObject({ focus: focusSchema.nullable().optional() });

/** Answer of `POST /api/focus`. */
export type FocusReply = { focus: ViewerFocus | null; viewers: number };

/** Body of `POST /api/command`: `step` is a step id or a number counted from 1. */
export const commandRequestSchema = z.strictObject({
  type: z.enum(['pause', 'resume', 'goto']),
  step: z.string().optional(),
});

/**
 * Answer of `POST /api/command`: the first position the viewer reported after the order, or the
 * last one known when it did not answer in time.
 */
export type CommandReply = { answered: boolean; position: PlaybackState };

const nonEmpty = z.string().refine((value) => value.trim() !== '', { error: 'must not be empty' });

/** Body of `POST /api/say`. */
export const sayRequestSchema = z.strictObject({
  text: nonEmpty,
  question: nonEmpty.optional(),
  focus: focusSchema.optional(),
  resume: z.boolean().optional(),
});

/**
 * Answer of `POST /api/say`: the script's last known position, or null without a script. The
 * answer itself is said later, by the viewer.
 */
export type SayReply = { ok: true; position: PlaybackState | null };

/** Body of `POST /api/replace`: `steps` is validated with the script it ends up in. */
export const replaceRequestSchema = z.strictObject({ from: z.string(), steps: z.unknown() });

/** Answer of `POST /api/replace`: how many steps the script has now. */
export type ReplaceReply = { steps: number; viewers: number };

/** Answer of `POST /api/events`: the events not handed out before, now marked as seen. */
export type EventsReply = { events: PlaybackEvent[] };

/** Answer of `GET /api/wait`: whether an event worth waking the agent for arrived in time. */
export type WaitReply = { woke: boolean };

/** The longest sentence `POST /api/tts` synthesizes. */
export const MAX_TTS_TEXT = 2000;

/** Body of `POST /api/tts`: one sentence and its BCP-47 language. */
export const ttsRequestSchema = z.strictObject({
  text: nonEmpty.pipe(z.string().max(MAX_TTS_TEXT)),
  lang: z.string().min(1).max(35),
});

/**
 * Answer of `GET /api/voice` and `POST /api/voice`: the voice in use, and the last failure of
 * its adapter (cleared by the next sentence it synthesizes) or of loading it.
 */
export type VoiceReply = {
  provider: { kind: 'browser' } | { kind: 'adapter'; name: string; path: string };
  failure: string | null;
};
