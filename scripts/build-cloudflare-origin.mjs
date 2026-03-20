import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await runCommand('npm', ['run', 'build:server']);
await runCommand('npm', ['--prefix', 'testApp', 'run', 'build']);

console.log('[cloudflare-origin] Build complete.');
console.log('[cloudflare-origin] Next: PUBLIC_ORIGIN=https://discoverlab.app npm run cloudflare:origin:start');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: repoRoot
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}.`));
    });
    child.on('error', reject);
  });
}
