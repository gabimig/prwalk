import { describe, expect, it } from 'vitest';
import { initialPlayback, type PlaybackState, reduce } from './playback.js';
import type { Script } from './script.js';

// Three steps with 2, 1 and 2 sentences.
const card = { heading: 'h', items: [] };
const script: Script = {
  version: 1,
  lang: 'en',
  level: 'overview',
  steps: [
    { id: 'a', title: 'A', card, say: ['a0', 'a1'] },
    { id: 'b', title: 'B', card, say: ['b0'] },
    { id: 'c', title: 'C', card, say: ['c0', 'c1'] },
  ],
};

const at = (status: PlaybackState['status'], step: number, sentence: number): PlaybackState => ({
  status,
  step,
  sentence,
});

describe('playback reducer', () => {
  it('starts idle at the first sentence, and start plays from there', () => {
    expect(initialPlayback).toEqual(at('idle', 0, 0));
    expect(reduce(initialPlayback, { type: 'start' }, script)).toEqual(at('playing', 0, 0));
  });

  describe('sentenceEnded', () => {
    it('moves to the next sentence of the step', () => {
      expect(reduce(at('playing', 0, 0), { type: 'sentenceEnded' }, script)).toEqual(
        at('playing', 0, 1),
      );
    });

    it('moves to the first sentence of the next step after the last sentence', () => {
      expect(reduce(at('playing', 0, 1), { type: 'sentenceEnded' }, script)).toEqual(
        at('playing', 1, 0),
      );
    });

    it('finishes without moving after the last sentence of the script', () => {
      expect(reduce(at('playing', 2, 1), { type: 'sentenceEnded' }, script)).toEqual(
        at('finished', 2, 1),
      );
    });

    it('is ignored when not playing, so a sentence cut short by a pause does not advance', () => {
      const paused = at('paused', 0, 0);
      expect(reduce(paused, { type: 'sentenceEnded' }, script)).toBe(paused);
    });
  });

  it('pause keeps the position and resume plays the same sentence again', () => {
    const paused = reduce(at('playing', 2, 1), { type: 'pause' }, script);
    expect(paused).toEqual(at('paused', 2, 1));
    expect(reduce(paused, { type: 'resume' }, script)).toEqual(at('playing', 2, 1));
  });

  it('toggle switches between playing and paused', () => {
    const paused = reduce(at('playing', 1, 0), { type: 'toggle' }, script);
    expect(paused).toEqual(at('paused', 1, 0));
    expect(reduce(paused, { type: 'toggle' }, script)).toEqual(at('playing', 1, 0));
  });

  it('toggle plays from the current position when idle or finished', () => {
    expect(reduce(at('idle', 0, 0), { type: 'toggle' }, script)).toEqual(at('playing', 0, 0));
    expect(reduce(at('finished', 2, 1), { type: 'toggle' }, script)).toEqual(at('playing', 2, 1));
  });

  it('next and prev go to the first sentence of the adjacent step and play', () => {
    expect(reduce(at('paused', 1, 0), { type: 'next' }, script)).toEqual(at('playing', 2, 0));
    expect(reduce(at('paused', 2, 1), { type: 'prev' }, script)).toEqual(at('playing', 1, 0));
  });

  it('next on the last step and prev on the first restart that same step', () => {
    expect(reduce(at('finished', 2, 1), { type: 'next' }, script)).toEqual(at('playing', 2, 0));
    expect(reduce(at('paused', 0, 1), { type: 'prev' }, script)).toEqual(at('playing', 0, 0));
  });

  it('restartStep plays the current step from its first sentence', () => {
    expect(reduce(at('paused', 2, 1), { type: 'restartStep' }, script)).toEqual(
      at('playing', 2, 0),
    );
  });

  it('restartAll plays the whole script from the start', () => {
    expect(reduce(at('finished', 2, 1), { type: 'restartAll' }, script)).toEqual(
      at('playing', 0, 0),
    );
  });

  it('goto plays the first sentence of a valid step', () => {
    expect(reduce(at('paused', 0, 1), { type: 'goto', step: 2 }, script)).toEqual(
      at('playing', 2, 0),
    );
  });

  it('goto with an index out of range changes nothing', () => {
    const paused = at('paused', 0, 1);
    expect(reduce(paused, { type: 'goto', step: 3 }, script)).toBe(paused);
    expect(reduce(paused, { type: 'goto', step: -1 }, script)).toBe(paused);
  });
});
