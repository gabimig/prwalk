import { z } from 'zod';
import type { DiffIndex } from './diff.js';
import type { AsideReport } from './events.js';
import type { PlaybackState } from './playback.js';

/** Where a walkthrough's diff came from. A patch file has no branches: both refs are empty. */
export const sessionMetaSchema = z.strictObject({
  kind: z.enum(['github', 'local', 'patch']),
  title: z.string(),
  number: z.int().positive().optional(),
  url: z.string().optional(),
  headRef: z.string(),
  baseRef: z.string(),
});

export type SessionMeta = z.infer<typeof sessionMetaSchema>;

/** What the CLI hands the daemon to open a session: `PUT /api/session`. */
export const sessionInputSchema = z.strictObject({
  meta: sessionMetaSchema,
  patch: z.string(),
});

export type SessionInput = z.infer<typeof sessionInputSchema>;

/** What the daemon answers on `GET /api/session`. */
export type SessionView = { meta: SessionMeta; index: DiffIndex };

/**
 * `GET /api/session` also says how many viewers are connected and, only while a script is
 * loaded, the last playback position the active viewer reported and the answer it is saying.
 */
export type SessionReply = SessionView & {
  viewers: number;
  playback?: PlaybackState;
  aside?: AsideReport | null;
};
