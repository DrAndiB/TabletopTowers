// Copies the web game from the repository root into app/www, the folder Capacitor packs into the app.
// The game has no build step, so this is a plain copy of what the website serves.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'www');
const ITEMS = ['index.html', 'css', 'js', 'fonts', 'vendor'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ITEMS) {
  const src = join(root, item);
  if (!existsSync(src)) throw new Error(`missing ${item} in the repository root`);
  cpSync(src, join(out, item), { recursive: true });
}
console.log(`www: copied ${ITEMS.join(', ')}`);
