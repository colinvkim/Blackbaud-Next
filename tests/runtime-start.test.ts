import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { startExtension } from '../src/runtime/start.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup() {
  const dom = new JSDOM('', { url: 'https://example.myschoolapp.com/app#one' });
  const scope = globalThis as typeof globalThis & { chrome?: unknown };
  const previous = { window: globalThis.window, chrome: scope.chrome, warn: console.warn };
  let listener: ((changes: unknown, area: string) => void) | undefined;
  let read: () => Promise<Settings> = async () => ({ ...DEFAULT_SETTINGS });
  let readCount = 0;
  let mounts = 0;
  let removals = 0;
  Object.assign(globalThis, { window: dom.window });
  console.warn = () => {};
  scope.chrome = {
    storage: {
      sync: { get: async () => { readCount++; return read(); } },
      onChanged: {
        addListener: (callback: (changes: unknown, area: string) => void) => { listener = callback; },
        removeListener: () => { listener = undefined; },
      },
    },
  };
  let cleanup: (() => void) | undefined;
  return {
    counts: () => ({ readCount, mounts, removals }),
    readUsing: (callback: () => Promise<Settings>) => { read = callback; },
    changed: () => { assert.ok(listener); listener({}, 'sync'); },
    navigate(hash: string) {
      dom.window.history.pushState({}, '', hash);
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    },
    notifyNavigation() { dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange')); },
    async start() {
      cleanup = await startExtension([{
        id: 'fixture', enabled: () => true, matches: () => true,
        mount: () => { mounts++; return () => { removals++; }; },
      }]);
    },
    dispose() {
      cleanup?.();
      dom.window.close();
      Object.assign(globalThis, { window: previous.window });
      if (previous.chrome === undefined) delete scope.chrome;
      else scope.chrome = previous.chrome;
      console.warn = previous.warn;
    },
  };
}

test('failed settings reads cannot reactivate stale features; real navigation can retry', async () => {
  const runtime = setup();
  try {
    await runtime.start();
    assert.equal(runtime.counts().mounts, 1);
    runtime.readUsing(async () => { throw new Error('Storage unavailable'); });
    runtime.changed();
    await flush();
    assert.equal(runtime.counts().removals, 1);
    runtime.navigate('#two');
    await flush();
    assert.equal(runtime.counts().mounts, 1);
    assert.equal(runtime.counts().readCount, 3);
    runtime.notifyNavigation();
    await flush();
    assert.equal(runtime.counts().readCount, 3);
    runtime.readUsing(async () => ({ ...DEFAULT_SETTINGS }));
    runtime.navigate('#three');
    await flush();
    assert.equal(runtime.counts().mounts, 2);
    assert.equal(runtime.counts().readCount, 4);
  } finally { runtime.dispose(); }
});

test('navigation during a pending retry does not create concurrent reads', async () => {
  const runtime = setup();
  let resolveRetry: ((settings: Settings) => void) | undefined;
  try {
    runtime.readUsing(async () => { throw new Error('Storage unavailable'); });
    await runtime.start();
    runtime.readUsing(() => new Promise<Settings>((resolve) => { resolveRetry = resolve; }));
    runtime.navigate('#two');
    runtime.navigate('#three');
    assert.equal(runtime.counts().readCount, 2);
    assert.ok(resolveRetry);
    resolveRetry({ ...DEFAULT_SETTINGS });
    await flush();
    assert.equal(runtime.counts().mounts, 1);
    assert.equal(runtime.counts().readCount, 2);
  } finally { runtime.dispose(); }
});

test('a stale failed read cannot dispose features started by a newer successful read', async () => {
  const runtime = setup();
  let rejectOlder: ((error: Error) => void) | undefined;
  try {
    await runtime.start();
    runtime.readUsing(() => new Promise<Settings>((_resolve, reject) => { rejectOlder = reject; }));
    runtime.changed();
    runtime.readUsing(async () => ({ ...DEFAULT_SETTINGS, accountPreference: 'school.edu' }));
    runtime.changed();
    await flush();
    assert.deepEqual(runtime.counts(), { readCount: 3, mounts: 2, removals: 1 });
    assert.ok(rejectOlder);
    rejectOlder(new Error('Older read failed'));
    await flush();
    assert.deepEqual(runtime.counts(), { readCount: 3, mounts: 2, removals: 1 });
  } finally { runtime.dispose(); }
});
