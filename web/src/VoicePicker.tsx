import { useEffect, useState } from 'react';
import { useTexts } from './i18n.js';
import { loadChoice, SPEEDS, type Speed, saveChoice, type VoiceChoice } from './voice/choice.js';
import type { RemoteVoice } from './voice/remote.js';
import type { WebSpeechVoice } from './voice/web-speech.js';

/** Where the choice is remembered; reading `localStorage` itself throws where it is blocked. */
export const choiceStorage = () => window.localStorage;

/** Applies the choice remembered for `lang` to a voice about to speak it. */
export function applySavedChoice(voice: WebSpeechVoice, lang: string): void {
  const { voice: name, speed } = loadChoice(choiceStorage, lang);
  voice.choose(name, SPEEDS[speed]);
}

/** Applies the speed remembered for `lang` to a remote voice about to speak it. */
export function applySavedSpeed(voice: RemoteVoice, lang: string): void {
  voice.choose(SPEEDS[loadChoice(choiceStorage, lang).speed]);
}

/**
 * With a voice adapter: its name, and the speed menu. The speed is remembered for the language,
 * like with the browser's voices.
 */
export function SpeedPicker({
  voice,
  lang,
  name,
}: {
  voice: RemoteVoice;
  lang: string;
  name: string;
}) {
  const t = useTexts();
  const [choice, setChoice] = useState<VoiceChoice>(() => loadChoice(choiceStorage, lang));
  return (
    <span className="badge picker">
      <span>{t.voice(name)}</span>
      <SpeedSelect
        speed={choice.speed}
        onChange={(speed) => {
          const next = { ...choice, speed };
          setChoice(next);
          saveChoice(choiceStorage, lang, next);
          voice.choose(SPEEDS[speed]);
        }}
      />
    </span>
  );
}

function SpeedSelect({ speed, onChange }: { speed: Speed; onChange: (speed: Speed) => void }) {
  const t = useTexts();
  return (
    <select
      aria-label={t.speedLabel}
      value={speed}
      onChange={(event) => onChange(event.target.value as Speed)}
    >
      {(Object.keys(SPEEDS) as Speed[]).map((option) => (
        <option key={option} value={option}>
          {t.speeds[option]}
        </option>
      ))}
    </select>
  );
}

/**
 * The header's voice and speed menus, in place of the voice's name: the local voices for the
 * script's language, best first, and three speeds. A change applies from the next sentence and
 * is remembered for the language. Shows just the name until the browser has listed its voices.
 */
export function VoicePicker({
  voice,
  lang,
  name,
}: {
  voice: WebSpeechVoice;
  lang: string;
  name: string;
}) {
  const t = useTexts();
  const [choice, setChoice] = useState<VoiceChoice>(() => loadChoice(choiceStorage, lang));
  const [names, setNames] = useState(() => voice.voiceNames(lang));
  useEffect(() => {
    setNames(voice.voiceNames(lang));
    return voice.onVoicesChanged(() => setNames(voice.voiceNames(lang)));
  }, [voice, lang]);

  if (names.length === 0) return <span className="badge">{t.voice(name)}</span>;
  const shown = choice.voice !== null && names.includes(choice.voice) ? choice.voice : names[0];
  const change = (next: VoiceChoice) => {
    setChoice(next);
    saveChoice(choiceStorage, lang, next);
    voice.choose(next.voice, SPEEDS[next.speed]);
  };
  return (
    <span className="badge picker">
      <select
        aria-label={t.voiceLabel}
        value={shown}
        onChange={(event) => change({ ...choice, voice: event.target.value })}
      >
        {names.map((option) => (
          <option key={option} value={option}>
            {t.voice(option)}
          </option>
        ))}
      </select>
      <SpeedSelect speed={choice.speed} onChange={(speed) => change({ ...choice, speed })} />
    </span>
  );
}
