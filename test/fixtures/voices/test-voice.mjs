// A voice adapter for the tests: a short silent wav, with the number of the synthesis written
// into its first sample so a test can tell a cached answer from a new one. It throws for any
// sentence that contains `options.failOn`.
let calls = 0;

export default {
  name: 'test-voice',
  async synthesize({ text, options }) {
    if (options.failOn !== undefined && text.includes(options.failOn)) {
      throw new Error(`refused "${text}"`);
    }
    calls++;
    return { audio: silentWav(0.2, calls % 256), mimeType: 'audio/wav' };
  },
};

/** `seconds` of 8 kHz, 8-bit mono silence; the first sample is `mark`. */
function silentWav(seconds, mark) {
  const samples = Math.round(8000 * seconds);
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + samples, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(samples, 40);
  wav[44] = mark;
  return wav;
}
