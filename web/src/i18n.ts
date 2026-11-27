import { createContext, useContext } from 'react';
import type { DiffFile } from '../../src/shared/diff.js';
import type { Script } from '../../src/shared/script.js';
import type { Speed } from './voice/choice.js';

/**
 * The few fixed texts of the viewer, in Spanish or English: the script's language, or the
 * browser's while there is no script. Any other language gets English.
 */
export type UiLanguage = 'es' | 'en';

export function uiLanguage(scriptLang: string | undefined, browserLang: string): UiLanguage {
  const lang = (scriptLang ?? browserLang).toLowerCase();
  return lang === 'es' || lang.startsWith('es-') ? 'es' : 'en';
}

const en = {
  connecting: 'Connecting to prwalk…',
  reconnecting: 'Connection to prwalk lost. Reconnecting…',
  noSession: 'No walkthrough is open. Run',
  files: (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`,
  filesLabel: 'Files in the diff',
  allFiles: '← All files',
  from: (path: string) => `from ${path}`,
  binary: 'Binary file: no lines to show.',
  noLineChanges: 'No line changes.',
  lines: (start: number, end: number, old: boolean) =>
    `${old ? 'old ' : ''}${start === end ? `line ${start}` : `lines ${start}-${end}`}`,
  status: {
    added: 'new',
    modified: 'modified',
    deleted: 'deleted',
    renamed: 'renamed',
  } satisfies Record<DiffFile['status'], string>,
  level: (level: Script['level']) =>
    `Level: ${{ overview: 'overview', 'key-files': 'key files', full: 'full' }[level]}`,
  voice: (name: string) => `Voice: ${name}`,
  voiceLabel: 'Voice',
  speedLabel: 'Speed',
  speeds: { normal: 'Normal speed', faster: 'A bit faster', fast: 'Fast' } satisfies Record<
    Speed,
    string
  >,
  voiceSilent: 'silent (subtitles only)',
  voiceBrowser: 'browser',
  voiceUnavailable: 'not available here (subtitles only)',
  voiceFailing: (name: string, fallback: string) => `${name} is failing, using ${fallback}`,
  stepsLabel: 'Walkthrough steps',
  goToStep: 'Go to this step',
  startTitle: 'Walkthrough ready',
  startText: (steps: number) =>
    `The agent has prepared ${steps} ${steps === 1 ? 'step' : 'steps'}. The browser needs a click before the page can speak.`,
  start: 'Start',
  restartAll: 'Restart the walkthrough',
  previous: 'Previous step',
  restartStep: 'Restart this step',
  play: 'Play',
  pause: 'Pause',
  next: 'Next step',
  playing: (step: number, steps: number, sentence: number, sentences: number) =>
    `Step ${step} of ${steps} · sentence ${sentence} of ${sentences}`,
  paused: (step: number, sentence: number) => `Paused · step ${step}, sentence ${sentence}`,
  finished: 'Walkthrough finished',
  answer: 'Answer',
  aside: (playing: boolean, step: number) =>
    `${playing ? 'Answer' : 'Answer paused'} · the walkthrough waits at step ${step}`,
  historyLabel: 'What has been said',
  stepHeading: (step: number, title: string) => `Step ${step} · ${title}`,
  space: 'Space',
  pauseHint: 'pause',
  supersededTitle: 'Open in another tab',
  supersededText: 'This walkthrough has been opened in another tab, which plays it now.',
  updateAvailable: (version: string) => `Version ${version} available`,
  updateHint: 'Tell your agent to update PRWalk',
  updateDismiss: (version: string) => `Hide the notice about version ${version}`,
};

export type Texts = typeof en;

const es: Texts = {
  connecting: 'Conectando con prwalk…',
  reconnecting: 'Se ha perdido la conexión con prwalk. Reconectando…',
  noSession: 'No hay ningún recorrido abierto. Ejecuta',
  files: (count) => `${count} ${count === 1 ? 'fichero' : 'ficheros'}`,
  filesLabel: 'Ficheros del diff',
  allFiles: '← Todos los ficheros',
  from: (path) => `antes ${path}`,
  binary: 'Fichero binario: no hay líneas que mostrar.',
  noLineChanges: 'Sin cambios de líneas.',
  lines: (start, end, old) =>
    `${start === end ? `línea ${start}` : `líneas ${start}-${end}`}${old ? ' (antes)' : ''}`,
  status: { added: 'nuevo', modified: 'modificado', deleted: 'borrado', renamed: 'renombrado' },
  level: (level) =>
    `Nivel: ${{ overview: 'resumen', 'key-files': 'ficheros clave', full: 'completo' }[level]}`,
  voice: (name) => `Voz: ${name}`,
  voiceLabel: 'Voz',
  speedLabel: 'Velocidad',
  speeds: { normal: 'Velocidad normal', faster: 'Algo más rápida', fast: 'Rápida' },
  voiceSilent: 'silenciosa (solo subtítulos)',
  voiceBrowser: 'navegador',
  voiceUnavailable: 'no disponible aquí (solo subtítulos)',
  voiceFailing: (name, fallback) => `${name} falla, se usa ${fallback}`,
  stepsLabel: 'Pasos del recorrido',
  goToStep: 'Ir a este paso',
  startTitle: 'Walkthrough listo',
  startText: (steps) =>
    `El agente ha preparado ${steps} ${steps === 1 ? 'paso' : 'pasos'}. El navegador exige un clic antes de dejar hablar a la página.`,
  start: 'Empezar',
  restartAll: 'Reiniciar el recorrido',
  previous: 'Paso anterior',
  restartStep: 'Reiniciar este paso',
  play: 'Reproducir',
  pause: 'Pausar',
  next: 'Paso siguiente',
  playing: (step, steps, sentence, sentences) =>
    `Paso ${step} de ${steps} · frase ${sentence} de ${sentences}`,
  paused: (step, sentence) => `En pausa · paso ${step}, frase ${sentence}`,
  finished: 'Recorrido terminado',
  answer: 'Respuesta',
  aside: (playing, step) =>
    `${playing ? 'Respuesta' : 'Respuesta en pausa'} · el recorrido espera en el paso ${step}`,
  historyLabel: 'Lo dicho hasta ahora',
  stepHeading: (step, title) => `Paso ${step} · ${title}`,
  space: 'Espacio',
  pauseHint: 'pausa',
  supersededTitle: 'Abierto en otra pestaña',
  supersededText: 'Este recorrido se ha abierto en otra pestaña, que es la que lo reproduce ahora.',
  updateAvailable: (version) => `Versión ${version} disponible`,
  updateHint: 'Dile a tu agente que actualice PRWalk',
  updateDismiss: (version) => `Ocultar el aviso de la versión ${version}`,
};

export const TEXTS: Record<UiLanguage, Texts> = { en, es };

export const TextsContext = createContext<Texts>(en);

/** The texts the voices show in the header. */
export function voiceLabels(t: Texts) {
  return {
    silent: t.voiceSilent,
    browser: t.voiceBrowser,
    unavailable: t.voiceUnavailable,
    failing: t.voiceFailing,
  };
}

export function useTexts(): Texts {
  return useContext(TextsContext);
}
