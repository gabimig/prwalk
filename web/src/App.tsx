import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { ViewerFocus, ViewerVoice } from '../../src/shared/protocol.js';
import { buildFileTree } from '../../src/shared/tree.js';
import {
  type LiveMessage,
  type LoadedSession,
  type SessionState,
  useDaemon,
} from './connection.js';
import { FileTree, TreeToggle, useTreeOpen } from './FileTree.js';
import { FileView } from './FileView.js';
import { TEXTS, type Texts, TextsContext, uiLanguage, useTexts, voiceLabels } from './i18n.js';
import { hasInteracted } from './interaction.js';
import { Player } from './Player.js';
import { AsideQueue, type AsideView } from './playback/aside.js';
import { PAUSES } from './playback/engine.js';
import { createVoice, voiceFor } from './voice/create.js';
import { SwitchableVoice } from './voice/switchable.js';
import type { VoiceProvider } from './voice/voice.js';

export function App() {
  const { connection, session, focus, script, voice, reportPosition, subscribe } = useDaemon();
  const lang = uiLanguage(script?.script.lang, navigator.language);
  const t = TEXTS[lang];
  const loaded = session.status === 'ready' ? session.session : undefined;
  const { aside, toggle } = useLooseAnswers(subscribe, script === null, t, voice);
  const answerFocus = aside?.answer.focus;
  // A file the user opened from the tree, shown over any focus. A new focus from the agent, an
  // answer with a focus of its own, or a new session takes over from it, so it only counts while
  // those are the ones it was opened under.
  const [opened, setOpened] = useState<{
    path: string;
    focus: ViewerFocus | null;
    answerFocus: ViewerFocus | undefined;
    session: SessionState;
  } | null>(null);
  const openedPath =
    opened !== null &&
    opened.focus === focus &&
    opened.session === session &&
    (answerFocus === undefined || answerFocus === opened.answerFocus)
      ? opened.path
      : null;
  const open = (path: string | null) =>
    setOpened(path === null ? null : { path, focus, answerFocus, session });

  const shownFocus = openedPath !== null ? null : (answerFocus ?? focus);
  const shown = loaded?.files.find(({ file }) => file.path === (openedPath ?? shownFocus?.file));
  const nodes = useMemo(() => buildFileTree(loaded?.files.map(({ file }) => file) ?? []), [loaded]);
  const [treeOpen, setTreeOpen] = useTreeOpen();

  let page: ReactNode;
  if (connection === 'superseded') {
    page = <Superseded />;
  } else if (loaded && script) {
    page = (
      <Player
        key={script.id}
        session={loaded}
        script={script.script}
        initial={script.position}
        onPosition={reportPosition}
        subscribe={subscribe}
        voice={voice}
        header={(voiceShown, treeToggle) => (
          <Header
            session={loaded}
            badges={[t.level(script.script.level)]}
            extra={voiceShown}
            toggle={treeToggle}
          />
        )}
      />
    );
  } else {
    page = (
      <>
        {loaded && (
          <Header
            session={loaded}
            toggle={<TreeToggle open={treeOpen} onToggle={() => setTreeOpen(!treeOpen)} />}
          />
        )}
        <div className="body">
          {loaded && treeOpen && (
            <FileTree nodes={nodes} current={shown?.file.path} onOpen={open} />
          )}
          <main>
            {shown ? (
              <FileView
                key={shown.file.path}
                file={shown.file}
                metadata={shown.metadata}
                focus={shownFocus ?? undefined}
                label={openedPath === null && answerFocus !== undefined ? t.answer : undefined}
              />
            ) : loaded ? (
              <p className="notice">{t.pickFile}</p>
            ) : (
              <Notice session={session} />
            )}
          </main>
        </div>
        {aside !== null && (
          <div className="aside-bar" role="status">
            {aside.status === 'paused' && (
              <button type="button" onClick={toggle}>
                {t.play}
              </button>
            )}
            {aside.sentences[aside.sentence]}
          </div>
        )}
      </>
    );
  }

  return (
    <TextsContext value={t}>
      {page}
      {connection === 'reconnecting' && (
        <div className="connection" role="status">
          {t.reconnecting}
        </div>
      )}
    </TextsContext>
  );
}

/**
 * Answers the agent sends while no script is loaded: said one after another, their focus shown
 * like the agent's own. Before the person has clicked or typed in the page (the browser lets it
 * speak only after that) they wait paused; `toggle`, also on Space, plays or pauses them.
 * Returns the current one, or null.
 */
function useLooseAnswers(
  subscribe: (listener: (message: LiveMessage) => void) => () => void,
  enabled: boolean,
  t: Texts,
  viewerVoice: ViewerVoice,
): { aside: AsideView | null; toggle: () => void } {
  const [aside, setAside] = useState<AsideView | null>(null);
  const [toggle, setToggle] = useState(() => () => {});
  const [voices, setVoices] = useState<{ base: VoiceProvider; switchable: SwitchableVoice }>();
  useEffect(() => {
    if (!enabled) return;
    const base = createVoice(location.search, voiceLabels(t), () => {});
    const switchable = new SwitchableVoice(base);
    setVoices({ base, switchable });
    let queue: AsideQueue | undefined;
    const toggleQueue = () => {
      queue?.toggle();
      setAside(queue?.view ?? null);
    };
    setToggle(() => toggleQueue);
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || queue?.view == null) return;
      if (event.target instanceof Element && event.target.closest('[role="tree"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      toggleQueue();
    };
    document.addEventListener('keydown', onKey);
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'say') return;
      if (queue === undefined) {
        const created = new AsideQueue(
          switchable,
          () => navigator.language,
          () => setAside(created.view),
          () => !hasInteracted(),
          () => PAUSES.sentence / switchable.speed,
        );
        queue = created;
      }
      queue.add(message.answer);
      setAside(queue.view);
    });
    return () => {
      unsubscribe();
      document.removeEventListener('keydown', onKey);
      queue?.cancel();
      setAside(null);
    };
  }, [subscribe, enabled, t]);
  // The voice the daemon names says the answers from the next sentence on.
  useEffect(() => {
    if (voices === undefined) return;
    voices.switchable.use(
      voiceFor(viewerVoice, voices.base, location.search, voiceLabels(t), () => {}),
    );
  }, [voices, viewerVoice, t]);
  return { aside, toggle };
}

function Superseded() {
  const t = useTexts();
  return (
    <div className="overlay">
      <div className="box" role="alert">
        <h2>{t.supersededTitle}</h2>
        <p>{t.supersededText}</p>
      </div>
    </div>
  );
}

function Notice({ session }: { session: SessionState }) {
  const t = useTexts();
  if (session.status === 'none') {
    return (
      <p className="notice">
        {t.noSession} <code>prwalk open</code>.
      </p>
    );
  }
  return <p className="notice">{session.status === 'error' ? session.message : t.connecting}</p>;
}

function Header({
  session: { meta, files },
  badges = [],
  extra,
  toggle,
}: {
  session: LoadedSession;
  badges?: string[];
  /** Shown after the badges, like the voice. */
  extra?: ReactNode;
  /** The button that shows and hides the file tree, before the title. */
  toggle?: ReactNode;
}) {
  const t = useTexts();
  let additions = 0;
  let deletions = 0;
  for (const { file } of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return (
    <header>
      <div className="pr-head">
        {toggle}
        <h1 className="pr-title">
          <span>{meta.title}</span>
          {meta.number !== undefined && <span className="num">#{meta.number}</span>}
        </h1>
      </div>
      <div className="pr-meta">
        {meta.kind !== 'patch' && (
          <span>
            <span className="branch">{meta.headRef}</span> →{' '}
            <span className="branch">{meta.baseRef}</span>
          </span>
        )}
        <span>
          {t.files(files.length)} · <span className="plus">+{additions}</span>{' '}
          <span className="minus">−{deletions}</span>
        </span>
        {badges.map((badge) => (
          <span key={badge} className="badge">
            {badge}
          </span>
        ))}
        {extra}
      </div>
    </header>
  );
}
