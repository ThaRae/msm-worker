import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = [process.env.WASM_CLANG, '/opt/homebrew/opt/llvm/bin/clang', 'clang'].filter(Boolean);
let clang;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['--print-targets'], { encoding: 'utf8' });
  if (probe.status === 0 && /wasm32/.test(probe.stdout)) { clang = candidate; break; }
}
if (!clang) throw new Error('LLVM clang with wasm32 support required. Set WASM_CLANG to its path.');
const out = join(root, 'public/runtime');
mkdirSync(out, { recursive: true });
const result = spawnSync(clang, [
  '--target=wasm32', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
  '-ffp-contract=off', '-fno-fast-math', '-nostdlib',
  join(root, 'runtime/ae_sampler.c'), '-o', join(out, 'ae-sampler.wasm'),
  '-Wl,--no-entry', '-Wl,--export=ae_abi_version', '-Wl,--export=ae_capacity',
  '-Wl,--export=ae_input', '-Wl,--export=ae_output', '-Wl,--export=ae_sample',
  '-Wl,--initial-memory=327680', '-Wl,--max-memory=327680', '-Wl,--stack-first',
], { stdio: 'inherit' });
if (result.status !== 0 || !existsSync(join(out, 'ae-sampler.wasm'))) process.exit(result.status || 1);
console.log('Built public/runtime/ae-sampler.wasm');
