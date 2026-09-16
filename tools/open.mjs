/**
 * Open a document in redline from the terminal:
 *
 *   node tools/open.mjs <file.md>
 *
 * Starts the dev server if nothing answers on the port, then opens the
 * document's deep link in the default browser. This is how an agent hands
 * Martin a document to review without him hunting for the path.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT) || 4173;
const base = `http://localhost:${port}`;

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/open.mjs <file.md>');
  process.exit(2);
}
const target = resolve(file);
try {
  await access(target);
} catch {
  console.error(`not found: ${target}`);
  process.exit(1);
}

async function serverUp() {
  try {
    const res = await fetch(`${base}/roots`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

if (!(await serverUp())) {
  const serve = join(dirname(fileURLToPath(import.meta.url)), 'serve.js');
  spawn(process.execPath, [serve], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 50 && !(await serverUp()); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!(await serverUp())) {
    console.error(`dev server did not come up on ${base}`);
    process.exit(1);
  }
}

const url = `${base}/?open=${encodeURIComponent(target)}`;
const [cmd, args] =
  process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
  : process.platform === 'darwin' ? ['open', [url]]
  : ['xdg-open', [url]];
spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
console.log(url);
