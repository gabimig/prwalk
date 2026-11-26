import type { Script } from './script.js';

/**
 * Playback rules shared by the viewer and the tests: a pure reducer over the position in the
 * script. Timers, speech and rendering live elsewhere and only dispatch these actions.
 */

export type PlaybackState = {
  status: 'idle' | 'playing' | 'paused' | 'finished';
  /** Index in script.steps. */
  step: number;
  /** Index in script.steps[step].say. */
  sentence: number;
};

export type PlaybackAction =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle' }
  | { type: 'sentenceEnded' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'restartStep' }
  | { type: 'restartAll' }
  | { type: 'goto'; step: number };

export const initialPlayback: PlaybackState = { status: 'idle', step: 0, sentence: 0 };

export function reduce(
  state: PlaybackState,
  action: PlaybackAction,
  script: Script,
): PlaybackState {
  const lastStep = script.steps.length - 1;
  const playStep = (step: number): PlaybackState => ({ status: 'playing', step, sentence: 0 });

  switch (action.type) {
    case 'start':
    case 'resume':
      return { ...state, status: 'playing' };
    case 'pause':
      return { ...state, status: 'paused' };
    case 'toggle':
      return { ...state, status: state.status === 'playing' ? 'paused' : 'playing' };
    case 'sentenceEnded': {
      if (state.status !== 'playing') return state;
      const sentences = script.steps[state.step]?.say.length ?? 0;
      if (state.sentence < sentences - 1) return { ...state, sentence: state.sentence + 1 };
      if (state.step < lastStep) return playStep(state.step + 1);
      return { ...state, status: 'finished' };
    }
    case 'next':
      return playStep(Math.min(state.step + 1, lastStep));
    case 'prev':
      return playStep(Math.max(state.step - 1, 0));
    case 'restartStep':
      return playStep(state.step);
    case 'restartAll':
      return playStep(0);
    case 'goto':
      if (!Number.isInteger(action.step) || action.step < 0 || action.step > lastStep) return state;
      return playStep(action.step);
  }
}
