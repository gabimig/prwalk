import type { ViewerVoice } from '../../../src/shared/protocol.js';
import { RemoteVoice } from './remote.js';
import { SilentVoice } from './silent.js';
import type { VoiceProvider } from './voice.js';
import { WebSpeechVoice } from './web-speech.js';

export type VoiceLabels = {
  silent: string;
  browser: string;
  unavailable: string;
  failing: (name: string, fallback: string) => string;
};

/** Whether the URL asks for the silent voice, which wins over any other (for tests). */
function forcesSilent(search: string): boolean {
  return new URLSearchParams(search).get('voice') === 'silent';
}

/**
 * The voice for this page: the browser's speech, or the silent one when the browser has none or
 * the URL asks for it with `?voice=silent` (`&speed=<n>` speeds it up, for tests).
 */
export function createVoice(
  search: string,
  labels: VoiceLabels,
  onNameChange: (name: string) => void,
): VoiceProvider {
  const params = new URLSearchParams(search);
  const speed = Number(params.get('speed'));
  const rate = speed > 0 ? speed : 1;
  if (forcesSilent(search)) return new SilentVoice(labels.silent, rate);
  const fallback = new SilentVoice(labels.unavailable, rate);
  if (!('speechSynthesis' in window)) return fallback;
  return new WebSpeechVoice(window.speechSynthesis, fallback, labels, onNameChange);
}

/**
 * The voice the daemon says to use: a remote one (the user's adapter) that falls back on the
 * page's own `base`, or `base` itself. `?voice=silent` keeps the silent voice.
 */
export function voiceFor(
  voice: ViewerVoice,
  base: VoiceProvider,
  search: string,
  labels: VoiceLabels,
  onNameChange: (name: string) => void,
): VoiceProvider {
  if (voice.kind === 'browser' || forcesSilent(search)) return base;
  return new RemoteVoice({
    name: voice.name,
    token: voice.token,
    fallback: base,
    labels,
    onNameChange,
    ...(base instanceof WebSpeechVoice && { setFallbackSpeed: (rate) => base.chooseSpeed(rate) }),
  });
}
