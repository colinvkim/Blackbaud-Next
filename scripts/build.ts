import { copyFile, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { watch: { type: 'boolean' }, 'out-dir': { type: 'string' } } });
const output = resolve(root, values['out-dir'] ?? 'chrome');
const watching = values.watch === true;
await mkdir(resolve(output, 'dist'), { recursive: true });
if (!watching) {
  for (const name of await readdir(resolve(output, 'dist'))) {
    await rm(resolve(output, 'dist', name), { recursive: true, force: true });
  }
}
await copyFile(resolve(root, 'extension/manifest.json'), resolve(output, 'manifest.json'));
await copyFile(resolve(root, 'src/popup/index.html'), resolve(output, 'popup.html'));
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });

const headerStylesPath = resolve(root, 'src/features/header-styles.ts');
let headerStylesRevision = 0;

for (const entry of ['appearance', 'lms', 'auth', 'popup', 'directory-page']) {
  await build({
    configFile: false,
    root,
    plugins: entry === 'appearance' ? [{
      name: 'preload-header-styles',
      buildStart() {
        // These styles are intentionally outside the JS bundle. Keep edits
        // visible to the ordinary Vite watcher as well as dev:browser.
        this.addWatchFile(headerStylesPath);
      },
      async generateBundle() {
        const stylesUrl = pathToFileURL(headerStylesPath);
        stylesUrl.searchParams.set('revision', String(++headerStylesRevision));
        const { HEADER_STYLES } = await import(stylesUrl.href);
        this.emitFile({ type: 'asset', fileName: 'appearance.css', source: HEADER_STYLES });
      },
    }] : [],
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
    ...manifest.content_scripts.flatMap((script: { js?: string[]; css?: string[] }) => [
      ...(script.js ?? []), ...(script.css ?? []),
    ]),
    ...manifest.web_accessible_resources.flatMap((resource: { resources: string[] }) => resource.resources),
    'dist/popup.css',
    'dist/popup.js',
  ];
  for (const path of paths) await readFile(resolve(output, path as string));
  console.log('Extension ready: load chrome/ in chrome://extensions.');
}
