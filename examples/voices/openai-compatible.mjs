// A prwalk voice adapter for any service with an OpenAI-style `/v1/audio/speech` endpoint.
//
// WARNING: with this adapter the narration (and the answers) are sent to that service: the text
// leaves your machine. Only use it with a service you are allowed to send the code's
// description to.
//
//   export OPENAI_API_KEY=...
//   prwalk voice use examples/voices/openai-compatible.mjs \
//     --option url=https://api.openai.com/v1/audio/speech --option model=<model> --option voice=<voice>
//
// Options:
//   url      the speech endpoint (required).
//   model    the model to ask for (required).
//   voice    the voice to ask for (required).
//   keyEnv   the environment variable that holds the API key (default OPENAI_API_KEY). The key
//            itself never goes in the options, which are saved in a file. Set it where the
//            prwalk daemon starts (`prwalk stop` and open again after changing it).

export default {
  name: 'openai-compatible',
  async synthesize({ text, options }) {
    for (const required of ['url', 'model', 'voice']) {
      if (!options[required]) throw new Error(`set --option ${required}=...`);
    }
    const keyEnv = options.keyEnv || 'OPENAI_API_KEY';
    const key = process.env[keyEnv];
    if (!key) throw new Error(`the environment variable ${keyEnv} has no API key`);
    const reply = await fetch(options.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        voice: options.voice,
        input: text,
        response_format: 'mp3',
      }),
    });
    if (!reply.ok) {
      const detail = (await reply.text()).slice(0, 200);
      throw new Error(`the service answered ${reply.status}: ${detail}`);
    }
    return { audio: new Uint8Array(await reply.arrayBuffer()), mimeType: 'audio/mpeg' };
  },
};
