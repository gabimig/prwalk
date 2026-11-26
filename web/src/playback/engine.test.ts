import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Cause, deriveEvents } from '../../../src/shared/events.js';
import type { PlaybackState } from '../../../src/shared/playback.js';
import type { VoiceProvider } from '../voice/voice.js';
import { asideReport, type EngineSnapshot, PlaybackEngine } from './engine.js';
import { exampleScript } from './test-script.js';

const script = exampleScript();

/** A voice that records what it was asked to say; the test decides when a sentence ends. */
function fakeVoice() {
  const said: { text: string; end: () => void }[] = [];
  let cancels = 0;
  const voice: VoiceProvider = {
    name: 'fake',
    speak: (text, _lang, onEnd) => said.push({ text, end: onEnd }),
    cancel: () => {
      cancels++;
    },
  };
  return {
    voice,
    said,
    last: () => said.at(-1),
    cancels: () => cancels,
  };
}

function engineAt(initial: PlaybackState = { status: 'idle', step: 0, sentence: 0 }) {
  const fake = fakeVoice();
  const engine = new PlaybackEngine(script, fake.voice, initial, () => {});
  return { engine, ...fake };
}

describe('playback engine', () => {
  it('moves on to the next sentence and says it when one ends', () => {
    const { engine, said, last } = engineAt();
    engine.dispatch({ type: 'start' });
    expect(said.map(({ text }) => text)).toEqual(['Esta PR añade un límite de intentos al login.']);

    last()?.end();

    expect(engine.state).toEqual({ status: 'playing', step: 0, sentence: 1 });
    expect(last()?.text).toMatch(/^Son cuatro ficheros/);
  });

  it('cancels the voice on pause and ignores the late end of the cancelled sentence', () => {
    const { engine, last, cancels } = engineAt();
    engine.dispatch({ type: 'start' });
    const cancelled = last();
    const cancelsBefore = cancels();

    engine.dispatch({ type: 'pause' });
    expect(cancels()).toBeGreaterThan(cancelsBefore);
    cancelled?.end();

    expect(engine.state).toEqual({ status: 'paused', step: 0, sentence: 0 });
  });

  it('says the whole sentence again on resume', () => {
    const { engine, said } = engineAt({ status: 'paused', step: 1, sentence: 1 });
    engine.dispatch({ type: 'toggle' });
    expect(said.map(({ text }) => text)).toEqual([
      'Recibe un almacén clave-valor y expone tres operaciones.',
    ]);
  });

  it('cancels the sentence on a jump and starts the new step', () => {
    const { engine, said, last, cancels } = engineAt();
    engine.dispatch({ type: 'start' });
    const restarted = cancels();
    // Restarting the step that is playing, on its first sentence, says that sentence again.
    engine.dispatch({ type: 'restartStep' });
    expect(cancels()).toBeGreaterThan(restarted);
    expect(said.map(({ text }) => text)).toEqual([said[0]?.text, said[0]?.text]);

    const before = last();
    const cancelsBefore = cancels();

    engine.dispatch({ type: 'goto', step: 3 });
    before?.end();

    expect(cancels()).toBeGreaterThan(cancelsBefore);
    expect(engine.state).toEqual({ status: 'playing', step: 3, sentence: 0 });
    expect(last()?.text).toBe('Ahora el controlador.');
  });

  it('stays on the last step when it finishes, and play says the last sentence again', () => {
    const lastStep = script.steps.length - 1;
    const { engine, said, last } = engineAt({ status: 'paused', step: lastStep, sentence: 0 });
    engine.dispatch({ type: 'resume' });
    last()?.end();
    expect(engine.state).toEqual({ status: 'finished', step: lastStep, sentence: 0 });

    engine.dispatch({ type: 'toggle' });
    expect(said).toHaveLength(2);
    expect(said[1]?.text).toBe(said[0]?.text);
  });
});

describe('answers (prwalk say)', () => {
  const answer = (text: string, extra: { resume?: boolean } = {}) => ({
    text,
    resume: extra.resume ?? false,
  });
  /** Playing step 2, sentence 2, with the voice in the middle of that sentence. */
  function playing() {
    const setup = engineAt({ status: 'paused', step: 1, sentence: 1 });
    setup.engine.dispatch({ type: 'resume' });
    return setup;
  }

  it('pauses the script where it was and says the answer sentence by sentence', () => {
    const { engine, said, last } = playing();
    const interrupted = last();

    engine.say(answer('Sí. Porque el almacén falla.'));
    interrupted?.end();

    expect(engine.state).toEqual({ status: 'paused', step: 1, sentence: 1 });
    expect(said.slice(1).map(({ text }) => text)).toEqual(['Sí.']);
    last()?.end();
    expect(last()?.text).toBe('Porque el almacén falla.');
    expect(engine.aside).toMatchObject({ status: 'playing', sentence: 1, answers: 1 });
  });

  it('stays paused on the step when the answer ends', () => {
    const { engine, said, last } = playing();
    engine.say(answer('Sí.'));
    last()?.end();

    expect(engine.aside).toBeNull();
    expect(engine.state).toEqual({ status: 'paused', step: 1, sentence: 1 });
    expect(said).toHaveLength(2);
  });

  it('resumes the script on its own after an answer sent with resume', () => {
    const { engine, last } = playing();
    const interrupted = last()?.text;
    engine.say(answer('Sí.', { resume: true }));
    last()?.end();

    expect(engine.state).toEqual({ status: 'playing', step: 1, sentence: 1 });
    expect(last()?.text).toBe(interrupted);
  });

  it('drops the answer on a jump and makes the jump; the next answer starts afresh', () => {
    const { engine, last } = playing();
    engine.say(answer('Sí. Y además.'));
    last()?.end();
    const cancelled = last();

    engine.dispatch({ type: 'next' });
    cancelled?.end();

    expect(engine.aside).toBeNull();
    expect(engine.state).toEqual({ status: 'playing', step: 2, sentence: 0 });
    expect(last()?.text).toBe('Aquí está la lógica central.');

    engine.say(answer('Otra. Y más.'));
    expect(last()?.text).toBe('Otra.');
  });

  it('before Start says nothing: an order only moves where it starts, an answer waits for it', () => {
    const { engine, said, last } = engineAt();
    engine.dispatch({ type: 'goto', step: 3 }, 'agent');
    engine.dispatch({ type: 'resume' }, 'agent');
    engine.say(answer('Sí.'));
    expect(said).toEqual([]);
    expect(engine.state).toEqual({ status: 'idle', step: 3, sentence: 0 });

    engine.dispatch({ type: 'start' });

    expect(last()?.text).toBe('Sí.');
    expect(engine.state).toEqual({ status: 'paused', step: 3, sentence: 0 });
  });

  it('queues a second answer and says it after the first', () => {
    const { engine, said, last } = playing();
    engine.say(answer('Primera.'));
    engine.say(answer('Segunda.'));
    expect(engine.aside?.answers).toBe(2);

    last()?.end();
    expect(engine.aside?.answers).toBe(1);
    last()?.end();

    expect(said.slice(1).map(({ text }) => text)).toEqual(['Primera.', 'Segunda.']);
    expect(engine.aside).toBeNull();
  });

  it('pauses and resumes the answer, not the script, on toggle', () => {
    const { engine, said, last, cancels } = playing();
    engine.say(answer('Sí.'));
    const cancelsBefore = cancels();

    engine.dispatch({ type: 'toggle' });
    expect(cancels()).toBeGreaterThan(cancelsBefore);
    expect(engine.aside?.status).toBe('paused');
    engine.dispatch({ type: 'toggle' });

    expect(engine.aside?.status).toBe('playing');
    expect(engine.state.status).toBe('paused');
    expect(said.slice(1).map(({ text }) => text)).toEqual(['Sí.', 'Sí.']);
    last()?.end();
    expect(engine.aside).toBeNull();
  });
});

describe('pauses between sentences', () => {
  const pauses = { sentence: 600, step: 1500 };
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** An engine with pauses, its voice saying sentences at `speed`. */
  function pausedEngine(initial: PlaybackState, speed = 1) {
    const fake = fakeVoice();
    const voice = { ...fake.voice, speed };
    const reports: { snapshot: EngineSnapshot; cause: Cause }[] = [];
    const engine = new PlaybackEngine(
      script,
      voice,
      initial,
      (snapshot, cause) => reports.push({ snapshot, cause }),
      { pauses },
    );
    /** The kinds of the events the daemon derives from the reports since `from`. */
    const eventsSince = (from: number) =>
      reports.slice(from).flatMap(({ snapshot, cause }, index) => {
        const before = reports[from + index - 1]?.snapshot ?? { state: initial, aside: null };
        const report = (s: EngineSnapshot) => ({ ...s.state, aside: asideReport(s.aside) });
        return deriveEvents(report(before), report(snapshot), cause).map(({ kind }) => kind);
      });
    return { engine, reports, eventsSince, ...fake };
  }

  it('waits after a sentence, longer after a step and not after the last, staying on the sentence meanwhile', () => {
    const { engine, said, last } = pausedEngine({ status: 'paused', step: 0, sentence: 1 });
    engine.dispatch({ type: 'resume' });

    last()?.end();
    vi.advanceTimersByTime(599);
    expect(engine.state).toEqual({ status: 'playing', step: 0, sentence: 1 });
    expect(said).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(last()?.text).toBe('Vamos a verlos en ese orden.');

    last()?.end();
    vi.advanceTimersByTime(1499);
    expect(engine.state).toEqual({ status: 'playing', step: 0, sentence: 2 });
    vi.advanceTimersByTime(1);
    expect(engine.state).toEqual({ status: 'playing', step: 1, sentence: 0 });

    // None after the last sentence of the script: it finishes at once.
    const lastStep = script.steps.length - 1;
    const end = pausedEngine({ status: 'paused', step: lastStep, sentence: 0 });
    end.engine.dispatch({ type: 'resume' });
    end.last()?.end();
    expect(end.engine.state).toEqual({ status: 'finished', step: lastStep, sentence: 0 });
  });

  it('divides the pauses by the speed of the voice', () => {
    const { engine, said, last } = pausedEngine({ status: 'paused', step: 0, sentence: 0 }, 2);
    engine.dispatch({ type: 'resume' });
    last()?.end();
    vi.advanceTimersByTime(299);
    expect(said).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(said).toHaveLength(2);
  });

  it('pausing during the silence resumes with the next sentence, without repeating', () => {
    const { engine, said, last, reports, eventsSince } = pausedEngine({
      status: 'paused',
      step: 0,
      sentence: 0,
    });
    engine.dispatch({ type: 'resume' });
    last()?.end();
    const from = reports.length;
    engine.dispatch({ type: 'pause' });
    vi.advanceTimersByTime(5000);
    expect(said).toHaveLength(1);

    engine.dispatch({ type: 'resume' });

    expect(engine.state).toEqual({ status: 'playing', step: 0, sentence: 1 });
    expect(said).toHaveLength(2);
    expect(last()?.text).toMatch(/^Son cuatro ficheros/);
    // The daemon reads a pause and a resume, not a jump.
    expect(eventsSince(from)).toEqual(['paused', 'resumed']);
  });

  it('a jump during the silence cancels it', () => {
    const { engine, said, last } = pausedEngine({ status: 'paused', step: 0, sentence: 0 });
    engine.dispatch({ type: 'resume' });
    last()?.end();
    engine.dispatch({ type: 'goto', step: 3 });
    vi.advanceTimersByTime(5000);

    expect(engine.state).toEqual({ status: 'playing', step: 3, sentence: 0 });
    expect(said.map(({ text }) => text).slice(1)).toEqual(['Ahora el controlador.']);

    // Paused during the silence, a jump still starts the new step from its first sentence.
    last()?.end();
    engine.dispatch({ type: 'pause' });
    engine.dispatch({ type: 'goto', step: 1 });
    expect(engine.state).toEqual({ status: 'playing', step: 1, sentence: 0 });
    expect(last()?.text).toBe('Empezamos por la clase nueva, LoginRateLimiter.');
  });

  it('waits between the sentences of an answer too', () => {
    const { engine, said, last } = pausedEngine({ status: 'paused', step: 1, sentence: 1 });
    engine.say({ text: 'Sí. Porque el almacén falla.', resume: false });
    last()?.end();
    vi.advanceTimersByTime(599);
    expect(said).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(last()?.text).toBe('Porque el almacén falla.');
  });
});

describe('preparing the next sentence', () => {
  it('asks the voice to prepare the sentence after the one it starts, across steps, and keeps it', () => {
    const prepared: string[] = [];
    const fake = fakeVoice();
    const voice: VoiceProvider = { ...fake.voice, prepare: (text) => prepared.push(text) };
    const engine = new PlaybackEngine(
      script,
      voice,
      { status: 'paused', step: 0, sentence: 1 },
      () => {},
    );
    engine.dispatch({ type: 'resume' });
    expect(prepared).toEqual(['Vamos a verlos en ese orden.']);

    // Moving on when a sentence ends does not cancel the voice, which would drop what it prepared.
    const cancels = fake.cancels();
    fake.last()?.end();
    expect(fake.cancels()).toBe(cancels);
    expect(fake.last()?.text).toBe('Vamos a verlos en ese orden.');
    // At the end of a step, the first sentence of the next one.
    expect(prepared).toEqual([
      'Vamos a verlos en ese orden.',
      'Empezamos por la clase nueva, LoginRateLimiter.',
    ]);
  });
});
