import { describe, expect, it } from 'vitest';
import { type DerivedEvent, deriveEvents, type ViewerReport, wakesAgent } from './events.js';

const at = (
  status: ViewerReport['status'],
  step: number,
  sentence: number,
  aside: ViewerReport['aside'] = null,
): ViewerReport => ({ status, step, sentence, aside });

const speaking = { status: 'playing', answers: 1 } as const;

describe('deriveEvents', () => {
  it('reports a pause with its cause and where it happened', () => {
    expect(deriveEvents(at('playing', 2, 1), at('paused', 2, 1), 'user')).toEqual([
      { kind: 'paused', cause: 'user', step: 2, sentence: 1 },
    ]);
  });

  it('reports playing again as resumed, but not an answer starting over a paused walkthrough', () => {
    expect(deriveEvents(at('paused', 2, 1), at('playing', 2, 1), 'agent')).toEqual([
      { kind: 'resumed', cause: 'agent', step: 2, sentence: 1 },
    ]);
    expect(deriveEvents(at('paused', 2, 1), at('paused', 2, 1, speaking), 'agent')).toEqual([]);
  });

  it('reports a move by the user or the agent as a jump, and not the next sentence', () => {
    expect(deriveEvents(at('paused', 2, 1), at('playing', 5, 0), 'user')).toEqual([
      { kind: 'jumped', cause: 'user', step: 5, sentence: 0, from: 2 },
    ]);
    expect(deriveEvents(at('playing', 2, 2), at('playing', 3, 0), 'auto')).toEqual([]);
  });

  it('reports the end of the walkthrough', () => {
    expect(deriveEvents(at('playing', 7, 0), at('finished', 7, 0), 'auto')).toEqual([
      { kind: 'finished', cause: 'auto', step: 7, sentence: 0 },
    ]);
    expect(deriveEvents(at('finished', 7, 0), at('finished', 7, 0, speaking), 'agent')).toEqual([]);
  });

  it('reports the end of an answer, without a separate pause', () => {
    expect(deriveEvents(at('paused', 2, 1, speaking), at('paused', 2, 1), 'auto')).toEqual([
      { kind: 'aside-ended', cause: 'auto', step: 2, sentence: 1 },
    ]);
  });
});

describe('wakesAgent', () => {
  it('wakes the agent for anything the user did, the end and an answer said, not its own orders', () => {
    const event = (kind: DerivedEvent['kind'], cause: DerivedEvent['cause']) =>
      wakesAgent({ kind, cause, step: 0, sentence: 0 });
    expect(event('finished', 'auto')).toBe(true);
    expect(event('aside-ended', 'auto')).toBe(true);
    expect(event('paused', 'user')).toBe(true);
    expect(event('paused', 'agent')).toBe(false);
  });
});
