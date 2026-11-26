---
name: prwalk
description: Give the user a spoken, guided walkthrough of a pull request or of local changes, in a web viewer that highlights the code while a voice explains it. Use when the user asks for a walkthrough, tour or spoken explanation of a PR, branch or diff ("walk me through this PR", "explain PR 482 out loud", "hazme un walkthrough de esta PR", "explícame esta PR con voz"), at any level of detail.
---

# prwalk

Run `prwalk skill` and follow the guide it prints. It is the full procedure: opening the session, writing the script, playing it, and answering the user while it plays.

If the command is missing, `prwalk` is not installed. Tell the user it installs with this command (Node.js 22 or later), and run it if they agree:

```sh
npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz
```
