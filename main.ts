// Emberline: hands the game in. Node 22, standard library only.
// Copies game/ and screenshots/ from beside this file to /output (or
// MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json
// with buildDossier from the vendored make.fun library. Deterministic: two
// runs write identical bytes (fixed file order, no timestamps in output).
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_GAME_FILES = 993;
const MAX_GAME_BYTES = 48 * 1024 * 1024;

function countTree(dir) {
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      const sub = countTree(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (st.isFile()) {
      files += 1;
      bytes += st.size;
    }
  }
  return { files, bytes };
}

const gameDir = join(here, 'game');
const gameCount = countTree(gameDir);
if (gameCount.files > MAX_GAME_FILES) {
  throw new Error(`game/ holds ${gameCount.files} files, over the ${MAX_GAME_FILES} cap`);
}
if (gameCount.bytes > MAX_GAME_BYTES) {
  throw new Error(`game/ is ${gameCount.bytes} bytes, over the ${MAX_GAME_BYTES} cap`);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
const shotsDir = join(here, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: MAX_GAME_FILES,
    game_max_bytes: MAX_GAME_BYTES,
  }),
);
