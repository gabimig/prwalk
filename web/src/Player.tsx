import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cause } from '../../src/shared/events.js';
import type { PlaybackAction, PlaybackState } from '../../src/shared/playback.js';
import type { ViewerVoice } from '../../src/shared/protocol.js';
import type { Card, Script } from '../../src/shared/script.js';
import { buildFileTree } from '../../src/shared/tree.js';
import type { LiveMessage, LoadedSession, PositionReport } from './connection.js';
import { FileTree, TreeToggle, useTreeOpen } from './FileTree.js';
import { FileView } from './FileView.js';
import { useTexts, voiceLabels } from './i18n.js';
import { hasInteracted } from './interaction.js';
import type { AsideView } from './playback/aside.js';
import {
  asideReport,
  type EngineSnapshot,
  isJump,
  PAUSES,
  PlaybackEngine,
} from './playback/engine.js';
import { cardPaths, pointsAtPaths, sentenceFocus } from './playback/focus.js';
import { recordAnswer, recordSentence, type TranscriptBlock } from './playback/transcript.js';
import { applySavedChoice, applySavedSpeed, SpeedPicker, VoicePicker } from './VoicePicker.js';
import { createVoice, voiceFor } from './voice/create.js';
import { RemoteVoice } from './voice/remote.js';
import { SwitchableVoice } from './voice/switchable.js';
import type { VoiceProvider } from './voice/voice.js';
import { WebSpeechVoice } from './voice/web-speech.js';

type Props = {
  session: LoadedSession;
  script: Script;
  /** Where to start: the last position the daemon knows of. */
  initial: PlaybackState;
  onPosition: (report: PositionReport) => void;
  /** Listens to the agent's orders, answers and replaced steps. */
  subscribe: (listener: (message: LiveMessage) => void) => () => void;
  /**
   * Renders the page header, given what to show of the voice (its name, or its menus) and the
   * button that shows and hides the file tree.
   */
  header: (voice: ReactNode, treeToggle: ReactNode) => ReactNode;
  /** The voice the daemon says to use; a change applies from the next sentence. */
  voice: ViewerVoice;
};

/**
 * Plays a script: the step strip, the code or card of the current step, the controls and the
 * history of what has been said. The engine owns the playback; this only renders its state and
 * hands it the agent's orders, answers and replaced steps.
 */
export function Player({
  session,
  script: loaded,
  initial,
  onPosition,
  subscribe,
  header,
  voice: viewerVoice,
}: Props) {
  const t = useTexts();
  const [script, setScript] = useState(loaded);
  const [{ state, aside }, setSnapshot] = useState<EngineSnapshot>({ state: initial, aside: null });
  const [history, setHistory] = useState<TranscriptBlock[]>(() =>
    initial.status === 'idle' ? [] : recordSentence([], loaded, initial),
  );
  const [voiceName, setVoiceName] = useState('');
  const [voice, setVoice] = useState<VoiceProvider | undefined>(undefined);
  /** The page's own voice and the one the engine speaks with, which can switch to another. */
  const [voices, setVoices] = useState<{ base: VoiceProvider; switchable: SwitchableVoice }>();
  const engine = useRef<PlaybackEngine | undefined>(undefined);
  /** Counts the reports, so an order that changed nothing can still be answered. */
  const reports = useRef(0);
  const latestOnPosition = useRef(onPosition);
  latestOnPosition.current = onPosition;

  useEffect(() => {
    const base: VoiceProvider = createVoice(location.search, voiceLabels(t), (name) => {
      if (switchable.current === base) setVoiceName(name);
    });
    if (base instanceof WebSpeechVoice) applySavedChoice(base, loaded.lang);
    const switchable = new SwitchableVoice(base);
    setVoices({ base, switchable });
    let lastAnswer: AsideView['answer'] | undefined;
    const report = (snapshot: EngineSnapshot, cause: Cause) => {
      reports.current++;
      latestOnPosition.current({
        state: snapshot.state,
        aside: asideReport(snapshot.aside),
        cause,
      });
    };
    const onChange = (next: EngineSnapshot, cause: Cause) => {
      const playing = current.script;
      setScript(playing);
      setSnapshot(next);
      // Only what is said: a position reached paused (after a replace) is not, yet.
      if (next.state.status === 'playing') {
        setHistory((blocks) => recordSentence(blocks, playing, next.state));
      }
      const answer = next.aside?.answer;
      if (answer !== undefined && answer !== lastAnswer) {
        setHistory((blocks) => recordAnswer(blocks, playing, next.state.step, answer));
      }
      lastAnswer = answer;
      report(next, cause);
    };
    const current: PlaybackEngine = new PlaybackEngine(loaded, switchable, initial, onChange, {
      pauses: PAUSES,
    });
    engine.current = current;
    const unsubscribe = subscribe((message) => {
      if (message.type === 'say') {
        current.say(message.answer);
      } else if (message.type === 'replace') {
        current.replace(message.script, message.from);
      } else {
        const { command } = message;
        const before = reports.current;
        if (command.type === 'goto') setJumps((count) => count + 1);
        current.dispatch(command, 'agent');
        // The daemon waits for an answer to every order, even one that changed nothing.
        if (reports.current === before) {
          report({ state: current.state, aside: current.aside }, 'agent');
        }
      }
    });
    // A page the person has already used may speak at once: no need for the Start card.
    if (initial.status === 'idle' && hasInteracted()) current.dispatch({ type: 'start' });
    return () => {
      unsubscribe();
      current.dispose();
    };
  }, [loaded, initial, subscribe, t]);

  // The voice the daemon names takes over from the next sentence.
  useEffect(() => {
    if (voices === undefined) return;
    const { base, switchable } = voices;
    const next = voiceFor(viewerVoice, base, location.search, voiceLabels(t), (name) => {
      if (switchable.current === next) setVoiceName(name);
    });
    if (next instanceof RemoteVoice) applySavedSpeed(next, loaded.lang);
    switchable.use(next);
    setVoice(next);
    setVoiceName(next.name);
  }, [voices, viewerVoice, loaded.lang, t]);

  // Counts the jumps, so restarting the step (or going to the one shown) centres its range again.
  const [jumps, setJumps] = useState(0);
  const dispatch = useCallback((action: PlaybackAction) => {
    if (isJump(action.type)) setJumps((count) => count + 1);
    engine.current?.dispatch(action);
  }, []);
  const waiting = state.status === 'idle';

  useEffect(() => {
    if (waiting) return;
    const keys: Record<string, PlaybackAction['type']> = {
      Space: 'toggle',
      ArrowLeft: 'prev',
      ArrowRight: 'next',
      KeyR: 'restartStep',
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The voice and speed menus, and the file tree, use the arrows and Space themselves.
      if (event.target instanceof HTMLSelectElement) return;
      if (event.target instanceof Element && event.target.closest('[role="tree"]')) return;
      const type = keys[event.code];
      if (type === undefined) return;
      event.preventDefault();
      dispatch({ type } as PlaybackAction);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [waiting, dispatch]);

  const step = script.steps[state.step];
  const answerFocus = aside?.answer.focus;
  const focusKey = JSON.stringify(
    answerFocus ?? (step === undefined ? undefined : sentenceFocus(step, state.sentence)),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new focus only when the range, the step, a jump or the answer changes, so the view scrolls once per change.
  const focus = useMemo(
    () => answerFocus ?? (step === undefined ? undefined : sentenceFocus(step, state.sentence)),
    [focusKey, state.step, jumps, aside?.answer, script],
  );
  const playing = (aside?.status ?? state.status) === 'playing';
  const showsAnswer = answerFocus !== undefined;

  // A file the person opened from the tree: shown until playback moves on or plays again.
  const [opened, setOpened] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers that close it.
  useEffect(() => setOpened(null), [state.step, jumps, aside?.answer, script]);
  useEffect(() => {
    if (playing) setOpened(null);
  }, [playing]);
  const openFile = (path: string) => {
    if (playing) dispatch({ type: 'pause' });
    setOpened(path);
  };

  const shownPath = opened ?? focus?.file;
  const shown = session.files.find(({ file }) => file.path === shownPath);
  const showsCard = step?.card !== undefined && !showsAnswer && opened === null;
  const nodes = useMemo(() => buildFileTree(session.files.map(({ file }) => file)), [session]);
  const light = showsCard && step !== undefined ? cardPaths(step, state.sentence) : undefined;

  // The tree as the person left it, except that a step pointing at paths opens it while it lasts.
  const [treeOpen, setTreeOpen] = useTreeOpen();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const forced = step !== undefined && pointsAtPaths(step) && dismissed !== state.step;
  const treeShown = treeOpen || forced;
  const toggleTree = () => {
    if (!treeShown) return setTreeOpen(true);
    if (treeOpen) setTreeOpen(false);
    if (forced) setDismissed(state.step);
  };

  return (
    <div className={`player${playing ? '' : ' paused'}`}>
      {header(
        voice instanceof RemoteVoice ? (
          <SpeedPicker voice={voice} lang={script.lang} name={voiceName} />
        ) : voice instanceof WebSpeechVoice && !voice.failed ? (
          <VoicePicker voice={voice} lang={script.lang} name={voiceName} />
        ) : (
          <span className="badge">{t.voice(voiceName)}</span>
        ),
        <TreeToggle open={treeShown} onToggle={toggleTree} />,
      )}
      <StepStrip
        script={script}
        current={state.step}
        onGo={(to) => dispatch({ type: 'goto', step: to })}
      />
      <div className="body">
        {treeShown && (
          <FileTree nodes={nodes} current={shown?.file.path} light={light} onOpen={openFile} />
        )}
        <main>
          {showsCard && step?.card !== undefined ? (
            <CardView
              key={state.step}
              card={step.card}
              lit={light?.sentence ? light.paths[0] : undefined}
            />
          ) : (
            shown && (
              <FileView
                key={shown.file.path}
                file={shown.file}
                metadata={shown.metadata}
                focus={opened === null ? focus : undefined}
                note={showsAnswer || opened !== null ? undefined : step?.note}
                label={showsAnswer && opened === null ? t.answer : undefined}
              />
            )
          )}
        </main>
      </div>
      <footer>
        <div className="progress">
          <i style={{ width: `${((state.step + 1) / script.steps.length) * 100}%` }} />
        </div>
        <div className="bar">
          <Transport playing={playing} onAction={dispatch} />
          <div className="subtitle">
            <div className="who">
              <span className="eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>{whoText(state, aside, script, t)}</span>
            </div>
            <History history={history} paused={!playing} answering={aside !== null} />
          </div>
          <div className="hint">
            <kbd>{t.space}</kbd> {t.pauseHint}
          </div>
        </div>
      </footer>
      {waiting && (
        <StartCard steps={script.steps.length} onStart={() => dispatch({ type: 'start' })} />
      )}
    </div>
  );
}

function whoText(
  state: PlaybackState,
  aside: AsideView | null,
  script: Script,
  t: ReturnType<typeof useTexts>,
): string {
  if (aside !== null) return t.aside(aside.status === 'playing', state.step + 1);
  if (state.status === 'finished') return t.finished;
  const sentences = script.steps[state.step]?.say.length ?? 0;
  if (state.status === 'playing') {
    return t.playing(state.step + 1, script.steps.length, state.sentence + 1, sentences);
  }
  return t.paused(state.step + 1, state.sentence + 1);
}

function StepStrip({
  script,
  current,
  onGo,
}: {
  script: Script;
  current: number;
  onGo: (step: number) => void;
}) {
  const t = useTexts();
  const strip = useRef<HTMLElement>(null);
  const currentButton = useRef<HTMLButtonElement>(null);
  const scrolled = useRef(false);
  // Centre the current step by scrolling the strip itself. On the first render it jumps there:
  // a smooth scroll started while the page is still laying out gets lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever the step changes.
  useEffect(() => {
    const nav = strip.current;
    const button = currentButton.current;
    if (nav === null || button === null) return;
    const offset = button.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    const left = nav.scrollLeft + offset + button.offsetWidth / 2 - nav.clientWidth / 2;
    nav.scrollTo({ left, behavior: scrolled.current ? 'smooth' : 'instant' });
    scrolled.current = true;
  }, [current]);
  return (
    <nav ref={strip} aria-label={t.stepsLabel}>
      <ol className="steps">
        {script.steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              ref={index === current ? currentButton : undefined}
              className={`step${index < current ? ' done' : ''}${index === current ? ' current' : ''}`}
              aria-current={index === current ? 'step' : undefined}
              title={t.goToStep}
              onClick={(event) => {
                event.currentTarget.blur();
                onGo(index);
              }}
            >
              <span className="dot" aria-hidden="true" />
              {index + 1}. {step.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A card step; `lit` is the path the sentence being said points at, to mark its item. */
function CardView({ card, lit }: { card: Card; lit?: string | undefined }) {
  return (
    <div className="card">
      <h2>{card.heading}</h2>
      {card.lead !== undefined && <p className="lead">{card.lead}</p>}
      <ul>
        {card.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items have no id and never reorder.
          <li key={index} className={lit !== undefined && item.path === lit ? 'lit' : undefined}>
            <b>
              <code>{item.title}</code>
            </b>
            {item.text !== undefined && <span>{item.text}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ICONS = {
  restartAll: <path d="M2 2.5h1.8v11H2zM9.5 3v10l-5-5zM15 3v10l-5-5z" />,
  prev: <path d="M3 2.5h2v11H3zM13.5 2.5v11L6 8z" />,
  restartStep: (
    <>
      <path
        d="M3.6 8.6a4.5 4.5 0 1 0 1.3-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M2.4 2v4.2h4.2z" />
    </>
  ),
  play: <path d="M4 2.5v11l9-5.5z" />,
  pause: <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" />,
  next: <path d="M11 2.5h2v11h-2zM2.5 2.5v11L10 8z" />,
};

function Transport({
  playing,
  onAction,
}: {
  playing: boolean;
  onAction: (action: PlaybackAction) => void;
}) {
  const t = useTexts();
  const buttons: { type: PlaybackAction['type']; label: string; key?: string; icon: ReactNode }[] =
    [
      { type: 'restartAll', label: t.restartAll, icon: ICONS.restartAll },
      { type: 'prev', label: t.previous, key: '←', icon: ICONS.prev },
      { type: 'restartStep', label: t.restartStep, key: 'R', icon: ICONS.restartStep },
      {
        type: 'toggle',
        label: playing ? t.pause : t.play,
        key: t.space,
        icon: playing ? ICONS.pause : ICONS.play,
      },
      { type: 'next', label: t.next, key: '→', icon: ICONS.next },
    ];
  return (
    <div className="transport">
      {buttons.map(({ type, label, key, icon }) => (
        <button
          key={type}
          type="button"
          className={type === 'toggle' ? 'toggle' : undefined}
          aria-label={label}
          title={key === undefined ? label : `${label} (${key})`}
          onClick={(event) => {
            // Leave the keyboard to the shortcuts: Space must not click this button again.
            event.currentTarget.blur();
            onAction({ type } as PlaybackAction);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {icon}
          </svg>
        </button>
      ))}
    </div>
  );
}

function History({
  history,
  paused,
  answering,
}: {
  history: TranscriptBlock[];
  paused: boolean;
  /** Whether the last answer is being said, rather than the last sentence. */
  answering: boolean;
}) {
  const t = useTexts();
  const log = useRef<HTMLDivElement>(null);
  // Keep the latest sentence in view, also when pausing changes the panel's height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: both are triggers, not inputs.
  useEffect(() => {
    const element = log.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [history, paused]);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the history scrolls, so the keyboard must reach it.
    <div className="log" ref={log} tabIndex={0} role="log" aria-label={t.historyLabel}>
      {history.map((block, blockIndex) => {
        // The line being said: the answer while there is one, else the last sentence, which
        // is also the one playing says again once an answer has ended.
        const nowIndex =
          blockIndex !== history.length - 1
            ? -1
            : answering
              ? block.lines.length - 1
              : block.lines.findLastIndex((line) => line.kind === 'sentence');
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are only ever appended.
          <section key={blockIndex}>
            <h3>{t.stepHeading(block.step + 1, block.title)}</h3>
            {block.lines.map((line, index) => {
              const now = index === nowIndex;
              return line.kind === 'sentence' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended.
                <p key={index} className={now ? 'now' : undefined}>
                  {line.text}
                </p>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended.
                <div key={index} className={`answer${now ? ' now' : ''}`}>
                  {line.question !== undefined && <p className="question">{line.question}</p>}
                  <p className="reply">{line.text}</p>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function StartCard({ steps, onStart }: { steps: number; onStart: () => void }) {
  const t = useTexts();
  return (
    <div className="overlay">
      <div className="box" role="dialog" aria-modal="true" aria-labelledby="start-title">
        <h2 id="start-title">{t.startTitle}</h2>
        <p>{t.startText(steps)}</p>
        {/* biome-ignore lint/a11y/noAutofocus: the only thing to do on this card is press Start. */}
        <button type="button" autoFocus onClick={onStart}>
          {t.start}
        </button>
      </div>
    </div>
  );
}
