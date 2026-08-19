/**
 * Build the shippable artifact.
 *
 * The product's defining constraint is a single file you can double-click from
 * disk with no server and no network. So the build bundles the modules, inlines
 * them together with the stylesheet, and writes one self-contained HTML file.
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

const escapeForScript = (js) => js.replace(/<\/script/gi, '<\\/script');

async function main() {
  const minify = !process.argv.includes('--no-minify');

  const bundled = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify,
    write: false,
    legalComments: 'none',
  });
  const js = bundled.outputFiles[0].text;

  const css = await readFile(join(root, 'src/styles.css'), 'utf8');
  const shell = await readFile(join(root, 'index.html'), 'utf8');

  const html = shell
    .replace('<link rel="stylesheet" href="./src/styles.css">', `<style>\n${css.trim()}\n</style>`)
    .replace('<script type="module" src="./src/main.js"></script>', `<script>\n${escapeForScript(js).trim()}\n</script>`);

  if (html.includes('src="./src/')) throw new Error('build left an external reference behind');
  if (/<link[^>]+href=|<script[^>]+src=/i.test(html)) throw new Error('build left an external asset behind');

  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'index.html'), html);

  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`dist/index.html  ${kb} kB  (self-contained${minify ? ', minified' : ''})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
