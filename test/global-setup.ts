import { execFileSync } from 'node:child_process';

// The CLI tests run the compiled binary, so compile once before any test runs.
export default function setup(): void {
  execFileSync('pnpm', ['run', '--silent', 'build'], { stdio: 'inherit' });
}
