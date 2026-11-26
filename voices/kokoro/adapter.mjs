// The kokoro voice of prwalk: Kokoro-82M v1.0 on the sherpa-onnx engine, local, on the CPU.
//
// `prwalk voice install kokoro` copies this file into <PRWALK_HOME>/voices/kokoro/, next to the
// engine (node_modules/sherpa-onnx-node) and the model (model/) it installs there.
//
// Options: `voice`, a Kokoro voice id (see VOICES below) used for every sentence. Without it, the
// voice follows the sentence's language: ef_dora for Spanish, af_heart for English and for any
// language without a voice here. The words are always read with the sentence's language rules.
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

/** The voices of the model, in the order of its speaker ids. */
const VOICES = [
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_heart',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
  'ef_dora',
  'em_alex',
  'ff_siwis',
  'hf_alpha',
  'hf_beta',
  'hm_omega',
  'hm_psi',
  'if_sara',
  'im_nicola',
  'jf_alpha',
  'jf_gongitsune',
  'jf_nezumi',
  'jf_tebukuro',
  'jm_kumo',
  'pf_dora',
  'pm_alex',
  'pm_santa',
  'zf_xiaobei',
  'zf_xiaoni',
  'zf_xiaoxiao',
  'zf_xiaoyi',
  'zm_yunjian',
  'zm_yunxi',
  'zm_yunxia',
  'zm_yunyang',
  'em_santa',
];

/** Per language: the voice by default and the espeak-ng language that turns text into phonemes. */
const LANGUAGES = {
  es: { voice: 'ef_dora', phonemes: 'es' },
  en: { voice: 'af_heart', phonemes: 'en-us' },
};

/**
 * The voice and the phoneme language for a sentence in `lang` (BCP-47). Languages other than
 * Spanish and English are read as English.
 */
export function pickVoice(lang, options) {
  const primary = String(lang).toLowerCase().split('-')[0];
  const language = LANGUAGES[primary] ?? LANGUAGES.en;
  const voice = options.voice || language.voice;
  const speaker = VOICES.indexOf(voice);
  if (speaker < 0) {
    throw new Error(`Unknown voice "${voice}"; pick one of ${VOICES.join(', ')}`);
  }
  return { voice, speaker, phonemes: language.phonemes };
}

let engine;

/** The engine with the model loaded, created on the first sentence. */
function loadEngine() {
  engine ??= (async () => {
    const { default: sherpa } = await import('sherpa-onnx-node');
    const model = (file) => fileURLToPath(new URL(`./model/${file}`, import.meta.url));
    const tts = await sherpa.OfflineTts.createAsync({
      model: {
        kokoro: {
          model: model('model.onnx'),
          voices: model('voices.bin'),
          tokens: model('tokens.txt'),
          dataDir: model('espeak-ng-data'),
          lang: 'en-us',
        },
        numThreads: Math.min(4, availableParallelism()),
        provider: 'cpu',
      },
      maxNumSentences: 1,
    });
    return { sherpa, tts };
  })();
  engine.catch(() => {
    engine = undefined;
  });
  return engine;
}

export default {
  name: 'kokoro',
  async synthesize({ text, lang, options }) {
    const { speaker, phonemes } = pickVoice(lang, options);
    const { sherpa, tts } = await loadEngine();
    const { samples, sampleRate } = await tts.generateAsync({
      text,
      sid: speaker,
      speed: 1,
      generationConfig: new sherpa.GenerationConfig({
        sid: speaker,
        speed: 1,
        extra: { lang: phonemes },
      }),
    });
    if (samples.length === 0) throw new Error('the engine returned no audio');
    return { audio: wav(samples, sampleRate), mimeType: 'audio/wav' };
  },
};

/** 16-bit mono PCM wav of float samples in [-1, 1]. */
function wav(samples, sampleRate) {
  const bytes = samples.length * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return out;
}
