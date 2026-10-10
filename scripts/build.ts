import { copyFile, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'chrome');
const watching = process.argv.includes('--watch');
await mkdir(resolve(output, 'dist'), { recursive: true });
if (!watching) {
  for (const name of await readdir(resolve(output, 'dist'))) {
    await rm(resolve(output, 'dist', name), { recursive: true, force: true });
  }
}
await copyFile(resolve(root, 'extension/manifest.json'), resolve(output, 'manifest.json'));
await copyFile(resolve(root, 'src/popup/index.html'), resolve(output, 'popup.html'));
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });

for (const entry of ['lms', 'auth', 'popup', 'directory-page']) {
  await build({
    configFile: false,
    root,
    build: {
      outDir: resolve(output, 'dist'),
      emptyOutDir: false,
      sourcemap: false,
      cssCodeSplit: false,
      watch: watching ? {} : null,
      lib: {
        entry: resolve(root, `src/entrypoints/${entry}.ts`),
        formats: ['iife'],
        name: `BlackbaudNext_${entry.replaceAll('-', '_')}`,
        fileName: () => `${entry}.js`,
        cssFileName: entry,
      },
    },
  });
}

if (!watching) {
  // A loadable build must reference only files that were actually emitted.
  const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
  const paths = [
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script: { js: string[] }) => script.js),
    ...manifest.web_accessible_resources.flatMap((resource: { resources: string[] }) => resource.resources),
    'dist/popup.css',
    'dist/popup.js',
  ];
  for (const path of paths) await readFile(resolve(output, path as string));
  console.log('Extension ready: load chrome/ in chrome://extensions.');
}
