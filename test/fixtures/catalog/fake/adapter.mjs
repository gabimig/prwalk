// The adapter of the test catalog voice: a short silent wav, once its model is in place.
import { readFile } from 'node:fs/promises';

export default {
  name: 'fake',
  async synthesize() {
    await readFile(new URL('./model/voice.txt', import.meta.url));
    const wav = Buffer.alloc(46, 0);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(38, 4);
    wav.write('WAVEfmt ', 8, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(2, 40);
    return { audio: wav, mimeType: 'audio/wav' };
  },
};
