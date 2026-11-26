import type { PlaybackState } from './playback.js';

/**
 * What the agent learns about the walkthrough: events derived from the positions the viewer
 * reports, each with who caused it. Pure, so the daemon and the tests share one definition.
 */

/** Who caused a change: the person in the page, an order from the agent, or a sentence ending. */
export type Cause = 'user' | 'agent' | 'auto';

/** An answer in progress (see `prwalk say`): playing or paused, and how many are left to say. */
export type AsideReport = { status: 'playing' | 'paused'; answers: number };

/** Where the viewer is, as it reports it: the script's position plus the answer, if any. */
export type ViewerReport = PlaybackState & { aside: AsideReport | null };

export type EventKind = 'paused' | 'resumed' | 'jumped' | 'finished' | 'aside-ended';

/** `step` and `sentence` are where playback is after the event; `from` is the step a jump left. */
export type DerivedEvent = {
  kind: EventKind;
  cause: Cause;
  step: number;
  sentence: number;
  from?: number;
};

/**
 * The events between two consecutive reports. A move caused by the user or the agent is a jump
 * (the next sentence, caused by the voice, is not). Pauses and resumes follow what is heard: the
 * answer's status while there is one, else the script's. An answer starting is the agent's own
 * doing and says nothing; one ending says `aside-ended` and no pause besides.
 */
export function deriveEvents(
  previous: ViewerReport,
  next: ViewerReport,
  cause: Cause,
): DerivedEvent[] {
  const events: DerivedEvent[] = [];
  const add = (kind: EventKind, extra: { from?: number } = {}) =>
    events.push({ kind, cause, step: next.step, sentence: next.sentence, ...extra });

  const moved = next.step !== previous.step || next.sentence !== previous.sentence;
  const asideChanged = (previous.aside === null) !== (next.aside === null);
  if (cause !== 'auto' && moved) {
    add('jumped', { from: previous.step });
  } else if (!asideChanged) {
    const before = previous.aside?.status ?? previous.status;
    const after = next.aside?.status ?? next.status;
    if (before !== after && after === 'playing') add('resumed');
    if (before === 'playing' && after === 'paused') add('paused');
  }
  if (next.status === 'finished' && previous.status !== 'finished') add('finished');
  if (previous.aside !== null && next.aside === null) add('aside-ended');
  return events;
}

/** An event as the daemon keeps it: numbered, with the ids of the steps it names. */
export type PlaybackEvent = DerivedEvent & { seq: number; id: string; fromId?: string };

/** Whether `prwalk wait` returns for this event: anything the user did, the end, or an answer said. */
export function wakesAgent(event: DerivedEvent): boolean {
  return event.cause === 'user' || event.kind === 'finished' || event.kind === 'aside-ended';
}
