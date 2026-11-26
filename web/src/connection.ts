import type { FileDiffMetadata } from '@pierre/diffs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type DiffFile, parseDiff } from '../../src/shared/diff.js';
import type { AsideReport, Cause } from '../../src/shared/events.js';
import type { PlaybackState } from '../../src/shared/playback.js';
import type {
  ServerMessage,
  ViewerFocus,
  ViewerMessage,
  ViewerVoice,
} from '../../src/shared/protocol.js';
import type { Script } from '../../src/shared/script.js';
import type { SessionMeta, SessionView } from '../../src/shared/session.js';

export type LoadedSession = {
  meta: SessionMeta;
  files: { file: DiffFile; metadata: FileDiffMetadata }[];
};

export type SessionState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: LoadedSession };

/** A script to play and where to start it; `id` changes with every `script` message. */
export type LoadedScript = { id: number; script: Script; position: PlaybackState };

let scriptMessages = 0;

/** What the agent sends while a walkthrough is live: orders, answers and replaced steps. */
export type LiveMessage = Extract<ServerMessage, { type: 'command' | 'say' | 'replace' }>;

/** What the viewer reports: the script's position, the answer being said, and who caused it. */
export type PositionReport = { state: PlaybackState; aside: AsideReport | null; cause: Cause };

/**
 * 'open' once connected; 'reconnecting' while waiting to try again after a drop; 'superseded'
 * when another tab took over the walkthrough (this one no longer connects).
 */
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'superseded';

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * Keeps the viewer in step with the daemon: the session (fetched again on every connection and
 * every `session` message), the focus and the script pushed over the WebSocket. Reconnects with
 * a growing wait when the connection drops, and reports the playback position back.
 */
export function useDaemon(): {
  connection: ConnectionState;
  session: SessionState;
  focus: ViewerFocus | null;
  script: LoadedScript | null;
  /** The voice the daemon says to speak with. */
  voice: ViewerVoice;
  reportPosition: (report: PositionReport) => void;
  /** Listens to the agent's live messages; returns how to stop listening. */
  subscribe: (listener: (message: LiveMessage) => void) => () => void;
} {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [focus, setFocus] = useState<ViewerFocus | null>(null);
  const [script, setScript] = useState<LoadedScript | null>(null);
  const [voice, setVoice] = useState<ViewerVoice>(BROWSER_VOICE);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const listeners = useRef(new Set<(message: LiveMessage) => void>());

  useEffect(() => {
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let latestLoad = 0;
    let stopped = false;

    const load = async () => {
      const load = ++latestLoad;
      const next = await fetchSession().catch(
        (error: unknown): SessionState => ({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      if (load === latestLoad && !stopped) setSession(next);
    };

    const connect = () => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      const current = new WebSocket(url);
      socket = current;
      socketRef.current = current;
      current.onopen = () => {
        attempt = 0;
        setConnection('open');
        // The daemon only says which voice to use when it is not the browser's.
        setVoice(BROWSER_VOICE);
        void load();
      };
      current.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === 'session') {
          setFocus(null);
          setScript(null);
          void load();
        } else if (message.type === 'focus') {
          setFocus(message.focus);
        } else if (message.type === 'script') {
          setFocus(null);
          setScript(
            message.script === null
              ? null
              : {
                  id: ++scriptMessages,
                  script: message.script,
                  position: resumeAt(message.position),
                },
          );
        } else if (
          message.type === 'command' ||
          message.type === 'say' ||
          message.type === 'replace'
        ) {
          for (const listener of listeners.current) listener(message);
        } else if (message.type === 'voice') {
          setVoice(message.voice);
        } else if (message.type === 'superseded') {
          // The script stays, only so the notice speaks its language.
          stopped = true;
          setConnection('superseded');
          current.close();
        }
      };
      current.onclose = () => {
        if (stopped || socket !== current) return;
        setConnection('reconnecting');
        timer = setTimeout(connect, Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  const reportPosition = useCallback(({ state, aside, cause }: PositionReport) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({ type: 'position', ...state, aside, cause } satisfies ViewerMessage),
    );
  }, []);

  const subscribe = useCallback((listener: (message: LiveMessage) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { connection, session, focus, script, voice, reportPosition, subscribe };
}

const BROWSER_VOICE: ViewerVoice = { kind: 'browser' };

/** Where to pick a script up: its last known position (the daemon pauses it for a new viewer). */
function resumeAt(position: PlaybackState | null): PlaybackState {
  return position ?? { status: 'idle', step: 0, sentence: 0 };
}

async function fetchSession(): Promise<SessionState> {
  const reply = await fetch('/api/session');
  if (reply.status === 404) return { status: 'none' };
  if (!reply.ok) throw new Error(`The daemon answered ${reply.status} for the session.`);
  const view = (await reply.json()) as SessionView;
  const diff = await fetch('/api/diff');
  if (diff.status === 404) return { status: 'none' };
  if (!diff.ok) throw new Error(`The daemon answered ${diff.status} for the diff.`);
  return { status: 'ready', session: { meta: view.meta, files: parseDiff(await diff.text()) } };
}
