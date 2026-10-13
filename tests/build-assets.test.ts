import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('a complete build removes obsolete assets and includes its manifest service worker', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-next-build-assets-'));
  try {
    await Promise.all(['src', 'assets', 'extension'].map((name) =>
      cp(resolve(root, name), resolve(fixture, name), { recursive: true }),
    ));
    await mkdir(resolve(fixture, 'scripts'));
    await cp(resolve(root, 'scripts/build.ts'), resolve(fixture, 'scripts/build.ts'));
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
    const output = resolve(fixture, 'output');
    await mkdir(resolve(output, 'assets/obsolete'), { recursive: true });
    await writeFile(resolve(output, 'assets/obsolete/removed.svg'), '<svg/>');
    await writeFile(resolve(output, 'assets/16x16.png'), 'old icon');
    await promisify(execFile)(process.execPath, ['scripts/build.ts', '--out-dir', output], { cwd: fixture, timeout: 45_000 });
    await assert.rejects(readFile(resolve(output, 'assets/obsolete/removed.svg')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(resolve(output, 'assets/16x16.png')), await readFile(resolve(fixture, 'assets/16x16.png')));
    const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
    assert.ok(manifest.background.service_worker);
    assert.ok((await readFile(resolve(output, manifest.background.service_worker))).length > 0);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
