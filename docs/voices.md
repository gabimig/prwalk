# Voices in PRWalk

[Back to the README](../README.md)

The page speaks with the browser's voices that run on your machine, leaving a short silence after each sentence and a longer one between steps. Use a browser with speech voices installed on the machine (Chrome, Edge or Safari); without one the page shows the narration as subtitles only. On macOS, the "Enhanced" and "Premium" voices from System Settings › Accessibility › Spoken Content sound much better.

## The recommended local voice

PRWalk can install a better voice that runs on your machine, in Spanish and English:

```sh
prwalk voice list             # the voices it can install, their size and licences
prwalk voice install kokoro   # installs it and chooses it
prwalk voice remove kokoro    # deletes it and goes back to the browser's voices
```

`kokoro` is the [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M) model on the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) engine. `prwalk voice install kokoro` creates `~/.prwalk/voices/kokoro/`, installs the engine there with `npm install` (`sherpa-onnx-node`, about 35 MB), downloads the model from the sherpa-onnx releases on GitHub (about 350 MB), says a test sentence and chooses the voice. It is not one of PRWalk's dependencies: installing PRWalk does not bring it. It picks a Spanish voice (`ef_dora`) or an English one (`af_heart`) by the language of each sentence; `--option voice=em_alex` fixes another Kokoro voice. On a laptop without a GPU it says a sentence in a fraction of the time it takes to hear it. If a step fails, it says which and how to retry, and the voice in use does not change; running it again repairs or updates the install.

Licences: the model and its voices, Apache-2.0; `sherpa-onnx-node`, Apache-2.0, with onnxruntime (MIT) inside; espeak-ng, which turns the text into phonemes and is built into the engine with its data in the model folder, GPL-3.0-or-later. That is why it is installed apart, only when you ask, and is not part of prwalk.

## Your own voice adapter

To use another engine (a local model, a command-line program or a cloud service), plug in a **voice adapter**: one small JavaScript file the daemon loads, usually written with your agent's help.

```sh
prwalk voice guide                                     # how to write one, with two examples
prwalk voice use ./my-voice.mjs --option voice=nova    # check it and choose it
prwalk voice test "Hola, esto es una prueba." --lang es --out /tmp/test.wav
prwalk voice use browser                               # back to the browser's voices
```

The choice is saved in `~/.prwalk/config.json`; an open viewer switches from the next sentence. Loading an adapter runs its code with your permissions. The guide is [skill/VOICES.md](../skill/VOICES.md), and the examples are in [examples/voices](../examples/voices).
