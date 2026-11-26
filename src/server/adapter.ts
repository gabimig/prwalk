import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A voice adapter: an ES module whose default export synthesizes one sentence. The daemon loads
 * it from the path in config.json, and the CLI to check it; nothing else can choose it. Loading
 * one runs the user's own code with the user's permissions.
 */
export type Adapter = {
  name: string;
  synthesize(request: SynthesisRequest): Promise<unknown>;
};

export type SynthesisRequest = { text: string; lang: string; options: Record<string, string> };

export type Audio = { audio: Uint8Array; mimeType: AudioType };

const AUDIO_TYPES = ['audio/wav', 'audio/mpeg', 'audio/ogg'] as const;
type AudioType = (typeof AUDIO_TYPES)[number];

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const SYNTHESIS_TIMEOUT_MS = 30_000;
const CACHED_SENTENCES = 200;

/** The adapter a module exports, or an error saying what the module is missing. */
export function adapterFrom(module: unknown, path: string): Adapter {
  const exported = (module as { default?: unknown } | null)?.default;
  if (typeof exported !== 'object' || exported === null) {
    throw new Error('it has no default export: export default { name, async synthesize() {} }');
  }
  const { name, synthesize } = exported as { name?: unknown; synthesize?: unknown };
  if (typeof synthesize !== 'function') {
    throw new Error('its default export has no synthesize function');
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
    throw new Error('its name must be a non-empty string, or left out');
  }
  return {
    name: name ?? basename(path, extname(path)),
    synthesize: (request) => Promise.resolve(synthesize.call(exported, request)),
  };
}

/** What a synthesis returned, checked: bytes the browser can play, and not too many. */
export function audioFrom(result: unknown): Audio {
  if (typeof result !== 'object' || result === null) {
    throw new Error('synthesize must return { audio, mimeType }');
  }
  const { audio, mimeType } = result as { audio?: unknown; mimeType?: unknown };
  if (!(audio instanceof Uint8Array)) {
    throw new Error('audio must be a Uint8Array or a Buffer');
  }
  if (audio.length === 0) throw new Error('audio is empty');
  if (audio.length > MAX_AUDIO_BYTES) throw new Error('audio is larger than 20 MB');
  const type = typeof mimeType === 'string' ? mimeType.split(';')[0]?.trim().toLowerCase() : '';
  if (!AUDIO_TYPES.includes(type as AudioType)) {
    throw new Error(`mimeType must be audio/wav, audio/mpeg or audio/ogg, got ${String(mimeType)}`);
  }
  return {
    audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.length),
    mimeType: type as AudioType,
  };
}

/**
 * Imports the adapter at `path` (absolute) and checks it. A file changed since it was last
 * imported is imported again, so editing an adapter takes effect on the next load.
 */
export async function loadAdapter(path: string): Promise<Adapter> {
  let module: unknown;
  try {
    const { mtimeMs } = await stat(path);
    module = await import(`${pathToFileURL(path).href}?mtime=${mtimeMs}`);
  } catch (error) {
    throw new Error(`Cannot load the voice adapter ${path}: ${messageOf(error)}`);
  }
  try {
    return adapterFrom(module, path);
  } catch (error) {
    throw new Error(`The voice adapter ${path} does not follow the contract: ${messageOf(error)}`);
  }
}

/**
 * Runs an adapter's syntheses one at a time, each for at most 30 s, and remembers the audio of
 * the last 200 sentences (and the ones being synthesized, so asking twice synthesizes once).
 */
export class Synthesizer {
  readonly adapter: Adapter;
  readonly #options: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #cache = new Map<string, Promise<Audio>>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    adapter: Adapter,
    options: Record<string, string>,
    { timeoutMs = SYNTHESIS_TIMEOUT_MS }: { timeoutMs?: number } = {},
  ) {
    this.adapter = adapter;
    this.#options = options;
    this.#timeoutMs = timeoutMs;
  }

  /** The audio for `text`; rejects with a short reason when the adapter fails. */
  synthesize(text: string, lang: string): Promise<Audio> {
    const key = JSON.stringify([lang, text]);
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }
    const previous = this.#queue;
    const call = previous.then(() =>
      this.adapter.synthesize({ text, lang, options: { ...this.#options } }),
    );
    // The next synthesis waits for the adapter itself, even after this one has timed out.
    this.#queue = call.then(
      () => {},
      () => {},
    );
    const audio = previous.then(() => this.#limit(call));
    this.#cache.set(key, audio);
    audio.catch(() => this.#cache.delete(key));
    for (const oldest of this.#cache.keys()) {
      if (this.#cache.size <= CACHED_SENTENCES) break;
      this.#cache.delete(oldest);
    }
    return audio;
  }

  /** The audio `call` gives, or a rejection once it takes longer than the timeout. */
  async #limit(call: Promise<unknown>): Promise<Audio> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`it took longer than ${this.#timeoutMs / 1000} s`)),
        this.#timeoutMs,
      );
    });
    try {
      return audioFrom(await Promise.race([call, timeout]));
    } finally {
      clearTimeout(timer);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
