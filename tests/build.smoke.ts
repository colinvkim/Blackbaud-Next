import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('watch mode rebuilds preloaded header CSS without bundling it into appearance JavaScript', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-next-build-'));
  let child: ChildProcess | undefined;
  let exited = Promise.resolve();
  let spawnError: Error | undefined;
  let output = '';
  try {
    for (const name of ['src', 'assets', 'extension']) {
      await cp(resolve(root, name), resolve(fixture, name), { recursive: true });
    }
    await mkdir(resolve(fixture, 'scripts'));
    await cp(resolve(root, 'scripts/build.ts'), resolve(fixture, 'scripts/build.ts'));
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
    child = spawn(process.execPath, ['scripts/build.ts', '--watch', '--out-dir', 'output'], {
      cwd: fixture,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = new Promise((done) => {
      child!.once('exit', () => { done(); });
      child!.once('error', (error) => { spawnError = error; done(); });
    });
    const record = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-6_000); };
    child.stdout?.on('data', record);
    child.stderr?.on('data', record);
    const waitForFile = async (path: string, matches: (content: string) => boolean): Promise<string> => {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        if (spawnError || child!.exitCode !== null || child!.signalCode !== null) {
          throw new Error(`Build watcher stopped: ${spawnError?.message ?? output}`);
        }
        try {
          const content = await readFile(path, 'utf8');
          if (matches(content)) return content;
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
        await new Promise((done) => setTimeout(done, 50));
      }
      throw new Error(`Build watcher did not update ${path}.\n${output}`);
    };
    const cssPath = resolve(fixture, 'output/dist/appearance.css');
    const jsPath = resolve(fixture, 'output/dist/appearance.js');
    const original = '--bn-primary-menu-gap: 6px;';
    const updated = '--bn-primary-menu-gap: 7px;';
    const initialCss = await waitForFile(cssPath, (content) => content.includes(original));
    const initialJs = await waitForFile(jsPath, (content) => content.length > 0);
    assert.equal(initialJs.includes('--bn-primary-menu-gap'), false);
    const sourcePath = resolve(fixture, 'src/features/header-styles.ts');
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(source.split(original).length, 2, 'fixture change must target one existing CSS value');
    await writeFile(sourcePath, source.replace(original, updated));
    const updatedCss = await waitForFile(cssPath, (content) => content.includes(updated));
    assert.equal(updatedCss.includes(original), false);
    assert.equal(updatedCss, initialCss.replace(original, updated));
    const updatedJs = await readFile(jsPath, 'utf8');
    assert.equal(updatedJs.includes('--bn-primary-menu-gap'), false);
    assert.equal(updatedJs, initialJs, 'a header-only CSS change must leave appearance JavaScript unchanged');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const force = setTimeout(() => { child?.kill('SIGKILL'); }, 3_000);
      try { await exited; } finally { clearTimeout(force); }
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
