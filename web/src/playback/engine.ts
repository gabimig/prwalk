import type { AsideReport, Cause } from '../../../src/shared/events.js';
import { type PlaybackAction, type PlaybackState, reduce } from '../../../src/shared/playback.js';
import type { AsideAnswer } from '../../../src/shared/protocol.js';
import { positionAfterReplace } from '../../../src/shared/replace.js';
import type { Script } from '../../../src/shared/script.js';
import type { VoiceProvider } from '../voice/voice.js';
import { AsideQueue, type AsideView } from './aside.js';
import { sentenceText } from './focus.js';

/** Actions that start a step from its first sentence even if it is the one playing. */
const JUMPS = new Set<PlaybackAction['type']>([
  'next',
  'prev',
  'goto',
  'restartStep',
  'restartAll',
]);

/** Whether `type` starts a step over, so the view brings the step's range back into sight. */
export function isJump(type: PlaybackAction['type']): boolean {
  return JUMPS.has(type);
}

/** Silences, in ms at normal speed: after a sentence, and after the last sentence of a step. */
export type Pauses = { sentence: number; step: number };

/** The silences the viewer leaves, so the listener has time to take each idea in. */
export const PAUSES: Pauses = { sentence: 600, step: 1500 };

const NO_PAUSES: Pauses = { sentence: 0, step: 0 };

/** What the engine reports on every change: the script's position and the answer, if any. */
export type EngineSnapshot = { state: PlaybackState; aside: AsideView | null };

/** The answer as the viewer reports it to the daemon. */
export function asideReport(aside: AsideView | null): AsideReport | null {
  return aside === null ? null : { status: aside.status, answers: aside.answers };
}

/**
 * Plays a script with a voice, outside React: applies each action with the shared reducer and
 * runs its effects. Playing says the current sentence from its start; a sentence that ends moves
 * on; pausing or jumping cancels the voice. Every sentence carries a token, so the end of one
 * that was cancelled (which some voices still report) cannot move playback on.
 *
 * It also says the agent's answers (`say`) aside from the script, which waits paused meanwhile:
 * toggling pauses the answer, any jump drops it, and once said the script stays paused unless
 * the last answer asked to resume.
 *
 * With `pauses`, a sentence that ends is followed by a silence (divided by the voice's speed)
 * before the next one, with the position still on the sentence just said. Pausing during the
 * silence resumes with the next sentence; a jump cancels it. While a sentence is said, the voice
 * is asked to prepare the next one.
 */
export class PlaybackEngine {
  #state: PlaybackState;
  #token = 0;
  #script: Script;
  /** The sentence at the position has been said whole: what comes next is the one after it. */
  #said = false;
  #silence: ReturnType<typeof setTimeout> | undefined;
  readonly #pauses: Pauses;
  readonly #voice: VoiceProvider;
  readonly #aside: AsideQueue;
  readonly #onChange: (snapshot: EngineSnapshot, cause: Cause) => void;

  constructor(
    script: Script,
    voice: VoiceProvider,
    initial: PlaybackState,
    onChange: (snapshot: EngineSnapshot, cause: Cause) => void,
    options: { pauses?: Pauses } = {},
  ) {
    this.#script = script;
    this.#voice = voice;
    this.#pauses = options.pauses ?? NO_PAUSES;
    this.#state = initial;
    this.#onChange = onChange;
    this.#aside = new AsideQueue(
      voice,
      () => this.#script.lang,
      (ended) => {
        if (ended?.resume && this.#state.status === 'paused') {
          this.#state = this.#afterSaid(reduce(this.#state, { type: 'resume' }, this.#script));
          this.#speak();
        }
        this.#notify('auto');
      },
      () => this.#state.status === 'idle',
      () => this.#scaled(this.#pauses.sentence),
    );
  }

  get state(): PlaybackState {
    return this.#state;
  }

  get aside(): AsideView | null {
    return this.#aside.view;
  }

  get script(): Script {
    return this.#script;
  }

  /** Applies an action from the page (`user`, the default), the agent, or the voice (`auto`). */
  dispatch(action: PlaybackAction, cause: Cause = 'user'): void {
    if (this.#state.status === 'idle' && action.type !== 'start') {
      this.#dispatchBeforeStart(action, cause);
      return;
    }
    if (this.#state.status === 'idle' && this.#aside.view !== null) {
      // Started with answers held: say them first, the script paused where it starts.
      this.#state = { ...this.#state, status: 'paused' };
      this.#aside.toggle();
      this.#notify(cause);
      return;
    }
    if (this.#aside.view !== null) {
      if (action.type === 'toggle' || action.type === 'pause' || action.type === 'resume') {
        const playing = this.#aside.view.status === 'playing';
        if ((action.type === 'pause' && !playing) || (action.type === 'resume' && playing)) return;
        this.#aside.toggle();
        this.#notify(cause);
        return;
      }
      if (!JUMPS.has(action.type)) return;
      this.#aside.cancel();
    }
    const previous = this.#state;
    const next = reduce(previous, action, this.#script);
    if (JUMPS.has(action.type)) this.#said = false;
    else if (this.#said && next.status === 'playing' && previous.status !== 'playing') {
      // Resumed during the silence: report the resume on the sentence said, then move on as
      // the voice would have, so neither reads as a jump.
      this.#said = false;
      this.#state = next;
      this.#notify(cause);
      this.dispatch({ type: 'sentenceEnded' }, 'auto');
      return;
    }
    const moved = next.step !== previous.step || next.sentence !== previous.sentence;
    if (!moved && next.status === previous.status && !JUMPS.has(action.type)) return;
    this.#state = next;

    const wasPlaying = previous.status === 'playing';
    if (next.status === 'playing' && (!wasPlaying || moved || JUMPS.has(action.type))) {
      // A sentence that ended has nothing left to cut, and cancelling would drop what the voice
      // prepared for the one coming.
      if (action.type !== 'sentenceEnded') this.#cancel();
      this.#speak();
    } else if (next.status !== 'playing' && wasPlaying) {
      this.#cancel();
    }
    this.#notify(cause);
  }

  /**
   * Says an answer aside, pausing the script where it is; queued behind one being said. Before
   * Start it waits, held, for Start.
   */
  say(answer: AsideAnswer): void {
    const idle = this.#aside.view === null;
    if (idle && this.#state.status === 'playing') {
      this.#cancel();
      this.#state = reduce(this.#state, { type: 'pause' }, this.#script);
    }
    this.#aside.add(answer);
    this.#notify('agent');
  }

  /**
   * Plays `script` from now on, its steps from `from` on being new. Before them nothing is
   * interrupted; on or after them playback goes where positionAfterReplace says, paused.
   */
  replace(script: Script, from: number): void {
    this.#script = script;
    const next = positionAfterReplace(this.#state, from, script);
    if (next === this.#state) {
      this.#notify('agent');
      return;
    }
    if (this.#state.status === 'playing') this.#cancel();
    this.#said = false;
    this.#state = next;
    this.#notify('agent');
  }

  /** Stops speaking for good: nothing said before can move playback on afterwards. */
  dispose(): void {
    this.#aside.cancel();
    this.#cancel();
  }

  /**
   * The browser lets the page speak only after a click, so before Start nothing speaks: a jump
   * only moves where Start begins (dropping held answers, like any jump), and the rest waits.
   */
  #dispatchBeforeStart(action: PlaybackAction, cause: Cause): void {
    if (action.type !== 'goto') return;
    const next = reduce(this.#state, action, this.#script);
    if (next === this.#state) return;
    this.#aside.cancel();
    this.#state = { ...next, status: 'idle' };
    this.#notify(cause);
  }

  #notify(cause: Cause): void {
    this.#onChange({ state: this.#state, aside: this.#aside.view }, cause);
  }

  #speak(): void {
    const token = ++this.#token;
    const { step, sentence } = this.#state;
    const said = this.#script.steps[step]?.say[sentence];
    if (said === undefined) return;
    const { lang } = this.#script;
    this.#voice.speak(sentenceText(said), lang, () => {
      if (token !== this.#token) return;
      const silence = this.#silenceAfter(step, sentence);
      if (silence <= 0) {
        this.dispatch({ type: 'sentenceEnded' }, 'auto');
        return;
      }
      this.#said = true;
      this.#silence = setTimeout(() => {
        if (token !== this.#token) return;
        this.#said = false;
        this.dispatch({ type: 'sentenceEnded' }, 'auto');
      }, silence);
    });
    const coming = this.#sentenceAfter(step, sentence);
    if (coming !== undefined) this.#voice.prepare?.(coming, lang);
  }

  /** `state`, moved past the sentence already said whole, if it was. */
  #afterSaid(state: PlaybackState): PlaybackState {
    if (!this.#said) return state;
    this.#said = false;
    return reduce(state, { type: 'sentenceEnded' }, this.#script);
  }

  /** The silence after a sentence: none after the last one of the script. */
  #silenceAfter(step: number, sentence: number): number {
    const { steps } = this.#script;
    const lastOfStep = sentence >= (steps[step]?.say.length ?? 0) - 1;
    if (!lastOfStep) return this.#scaled(this.#pauses.sentence);
    return step < steps.length - 1 ? this.#scaled(this.#pauses.step) : 0;
  }

  #scaled(ms: number): number {
    return ms / (this.#voice.speed ?? 1);
  }

  /** The text of the sentence that follows, in this step or the next one. */
  #sentenceAfter(step: number, sentence: number): string | undefined {
    const { steps } = this.#script;
    const following = steps[step]?.say[sentence + 1] ?? steps[step + 1]?.say[0];
    return following === undefined ? undefined : sentenceText(following);
  }

  #cancel(): void {
    this.#token++;
    clearTimeout(this.#silence);
    this.#voice.cancel();
  }
}
