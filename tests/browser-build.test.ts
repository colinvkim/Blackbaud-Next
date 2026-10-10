import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { BuildQueue, watchProjectSources } from '../scripts/browser-build.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function microtasks() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

test('source changes debounce into one complete build followed by one reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work: string[] = [];
  const queue = new BuildQueue({
    build: async () => { work.push('build'); },
    onSuccess: () => { work.push('reload'); },
    onError: (error) => { throw error; },
    debounceMs: 100,
  });
  try {
    queue.requestBuild();
    t.mock.timers.tick(80);
    queue.requestBuild();
    t.mock.timers.tick(99);
    assert.deepEqual(work, []);
    t.mock.timers.tick(1);
    await queue.idle();
    assert.deepEqual(work, ['build', 'reload']);
  } finally { await queue.dispose(); }
});

test('changes during a build skip the obsolete reload and serialize the replacement build', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred();
  const work: string[] = [];
  let builds = 0;
  const queue = new BuildQueue({
    build: async () => {
      work.push(`build ${++builds}`);
      if (builds === 1) await first.promise;
    },
    onSuccess: () => { work.push('reload'); },
    onError: (error) => { throw error; },
    debounceMs: 100,
  });
  try {
    const initial = queue.buildNow();
    queue.requestBuild();
    t.mock.timers.tick(100);
    assert.deepEqual(work, ['build 1']);
    first.resolve();
    await initial;
    await queue.idle();
    assert.deepEqual(work, ['build 1', 'build 2', 'reload']);
  } finally { first.resolve(); await queue.dispose(); }
});

test('a pending replacement still waits for the most recent edit to settle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred();
  const work: string[] = [];
  let builds = 0;
  const queue = new BuildQueue({
    build: async () => { work.push('build'); if (++builds === 1) await first.promise; },
    onSuccess: () => { work.push('reload'); },
    onError: (error) => { throw error; },
    debounceMs: 100,
  });
  try {
    const initial = queue.buildNow();
    queue.requestBuild();
    t.mock.timers.tick(70);
    queue.requestBuild();
    first.resolve();
    await microtasks();
    t.mock.timers.tick(99);
    assert.deepEqual(work, ['build']);
    t.mock.timers.tick(1);
    await initial;
    await queue.idle();
    assert.deepEqual(work, ['build', 'build', 'reload']);
  } finally { first.resolve(); await queue.dispose(); }
});

test('reloads finish before another build can write extension output', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reload = deferred();
  const work: string[] = [];
  let reloads = 0;
  const queue = new BuildQueue({
    build: async () => { work.push('build'); },
    onSuccess: async () => {
      work.push('reload start');
      if (++reloads === 1) await reload.promise;
      work.push('reload end');
    },
    onError: (error) => { throw error; },
    debounceMs: 100,
  });
  try {
    const initial = queue.buildNow();
    await microtasks();
    queue.requestBuild();
    t.mock.timers.tick(100);
    assert.deepEqual(work, ['build', 'reload start']);
    reload.resolve();
    await initial;
    await queue.idle();
    assert.deepEqual(work, ['build', 'reload start', 'reload end', 'build', 'reload start', 'reload end']);
  } finally { reload.resolve(); await queue.dispose(); }
});

test('a failed initial build rejects startup, skips reload, and recovers after another edit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failure = new Error('TypeScript build failed');
  const errors: unknown[] = [];
  let builds = 0;
  let reloads = 0;
  const queue = new BuildQueue({
    build: async () => { if (++builds === 1) throw failure; },
    onSuccess: () => { reloads++; },
    onError: (error) => { errors.push(error); },
    debounceMs: 100,
  });
  try {
    await assert.rejects(queue.buildNow(), failure);
    await queue.idle();
    assert.deepEqual(errors, [failure]);
    assert.equal(reloads, 0);
    queue.requestBuild();
    t.mock.timers.tick(100);
    await queue.idle();
    assert.equal(builds, 2);
    assert.equal(reloads, 1);
  } finally { await queue.dispose(); }
});

test('a reload failure is reported without preventing the next build', async () => {
  const failure = new Error('Browser closed');
  const errors: unknown[] = [];
  let reloads = 0;
  const queue = new BuildQueue({
    build: async () => {},
    onSuccess: () => { if (++reloads === 1) throw failure; },
    onError: (error) => { errors.push(error); },
  });
  try {
    await assert.rejects(queue.buildNow(), failure);
    await queue.idle();
    await queue.buildNow();
    await queue.idle();
    assert.deepEqual(errors, [failure]);
    assert.equal(reloads, 2);
  } finally { await queue.dispose(); }
});

test('shutdown aborts an active build and prevents late reloads or future builds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const build = deferred();
  let signal: AbortSignal | undefined;
  let reloads = 0;
  const errors: unknown[] = [];
  const queue = new BuildQueue({
    build: async (buildSignal) => { signal = buildSignal; await build.promise; },
    onSuccess: () => { reloads++; },
    onError: (error) => { errors.push(error); },
  });
  const initial = assert.rejects(queue.buildNow(), { name: 'AbortError' });
  queue.requestBuild();
  const closing = queue.dispose();
  assert.equal(signal?.aborted, true);
  await initial;
  build.resolve();
  await closing;
  queue.requestBuild();
  t.mock.timers.tick(1000);
  await queue.idle();
  await assert.rejects(queue.buildNow(), { name: 'AbortError' });
  assert.equal(reloads, 0);
  assert.deepEqual(errors, []);
  await queue.dispose();
});

test('shutdown cancels a build that has only been scheduled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let builds = 0;
  const queue = new BuildQueue({
    build: async () => { builds++; },
    onSuccess: () => {},
    onError: (error) => { throw error; },
  });
  queue.requestBuild();
  const idle = queue.idle();
  await queue.dispose();
  await idle;
  t.mock.timers.tick(1000);
  assert.equal(builds, 0);
});

test('source watcher covers newly nested source files, popup HTML, manifest, assets, and build inputs', async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'blackbaud-browser-watch-')));
  for (const directory of ['src/popup', 'extension', 'assets', 'scripts']) {
    await mkdir(resolve(root, directory), { recursive: true });
  }
  const seen = new Set<string>();
  const errors: unknown[] = [];
  const close = watchProjectSources(root, (path) => seen.add(path), (error) => { errors.push(error); });
  async function eventually(path: string) {
    for (let attempt = 0; attempt < 100 && !seen.has(path); attempt++) await delay(10);
    assert.ok(seen.has(path), `Did not observe source change: ${path}; observed ${[...seen].join(', ')}`);
  }
  try {
    await mkdir(resolve(root, 'src/new/deep'), { recursive: true });
    // Let recursive watchers register a freshly created directory before writing.
    await delay(50);
    for (const input of ['src/new/deep/feature.ts', 'src/popup/index.html', 'extension/manifest.json', 'assets/icon.svg', 'scripts/build.ts']) {
      const path = resolve(root, input);
      await writeFile(path, 'fixture');
      await eventually(path);
    }
    close();
    close();
    seen.clear();
    await writeFile(resolve(root, 'src/popup/index.html'), 'after shutdown');
    await delay(30);
    assert.equal(seen.size, 0);
    assert.deepEqual(errors, []);
  } finally { close(); await rm(root, { recursive: true, force: true }); }
});

test('an incomplete source tree closes any watchers already installed', async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'blackbaud-browser-watch-')));
  await mkdir(resolve(root, 'src'));
  try {
    assert.throws(() => watchProjectSources(root, () => {}), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
