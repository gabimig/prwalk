# Working on PRWalk

[Back to the README](../README.md)

To work on PRWalk itself, build it from the repository with [pnpm](https://pnpm.io/) and git:

```sh
git clone https://github.com/gabimig/prwalk.git
cd prwalk
pnpm install
pnpm build
pnpm link --global   # puts this build of prwalk on your PATH; run `pnpm setup` first if pnpm asks for it
prwalk --version
```

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (in a browser, with Playwright) and `pnpm test:pack` (installs the packed PRWalk in a temporary folder and runs it) are the checks. How a release is published is in [AGENTS.md](../AGENTS.md).
