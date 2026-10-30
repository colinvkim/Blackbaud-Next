import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { startExtension } from '../src/runtime/start.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';
import type { Feature } from '../src/shared/types.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(featureOptions: Partial<Feature> = {}, withNavigation = false) {
  const dom = new JSDOM('', { url: 'https://example.myschoolapp.com/app#one' });
  const navigation = new dom.window.EventTarget();
  if (withNavigation) Object.defineProperty(dom.window, 'navigation', { value: navigation });
  const scope = globalThis as typeof globalThis & { chrome?: unknown };
  const previous = { window: globalThis.window, chrome: scope.chrome, warn: console.warn };
  let listener: ((changes: unknown, area: string) => void) | undefined;
  let read: () => Promise<Settings> = async () => ({ ...DEFAULT_SETTINGS });
  let readCount = 0;
  let mounts = 0;
  let removals = 0;
  const signals: AbortSignal[] = [];
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
    currentSignal: () => signals.at(-1),
    readUsing: (callback: () => Promise<Settings>) => { read = callback; },
    changed: () => { assert.ok(listener); listener({}, 'sync'); },
    navigate(hash: string) {
      dom.window.history.pushState({}, '', hash);
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    },
    navigateEntry(hash: string) {
      dom.window.history.pushState({}, '', hash);
      navigation.dispatchEvent(new dom.window.Event('currententrychange'));
    },
    pagehide() { dom.window.dispatchEvent(new dom.window.Event('pagehide')); },
    observingLocation: () => !!dom.window.__blackbaudNextLocationV1,
    notifyNavigation() { dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange')); },
    async start() {
      cleanup = await startExtension([{
        id: 'fixture', settingsKeys: [], enabled: () => true, matches: () => true,
        ...featureOptions,
        mount: ({ signal }) => { mounts++; signals.push(signal); return () => { removals++; }; },
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
    assert.deepEqual(runtime.counts(), { readCount: 3, mounts: 1, removals: 0 });
    assert.ok(rejectOlder);
    rejectOlder(new Error('Older read failed'));
    await flush();
    assert.deepEqual(runtime.counts(), { readCount: 3, mounts: 1, removals: 0 });
  } finally { runtime.dispose(); }
});

test('successful unrelated preference reads preserve active work and do not duplicate a navigation mount', async () => {
  const runtime = setup();
  let resolveRead: ((settings: Settings) => void) | undefined;
  try {
    await runtime.start();
    const initialSignal = runtime.currentSignal();
    runtime.readUsing(async () => ({ ...DEFAULT_SETTINGS, pageAppearance: false }));
    runtime.changed();
    await flush();
    assert.equal(runtime.currentSignal(), initialSignal);
    assert.deepEqual(runtime.counts(), { readCount: 2, mounts: 1, removals: 0 });
    runtime.readUsing(() => new Promise<Settings>((resolve) => { resolveRead = resolve; }));
    runtime.changed();
    runtime.navigate('#two');
    const navigationSignal = runtime.currentSignal();
    assert.notEqual(navigationSignal, initialSignal);
    assert.equal(initialSignal?.aborted, true);
    assert.ok(resolveRead);
    resolveRead({ ...DEFAULT_SETTINGS, accountPreference: 'school.edu' });
    await flush();
    assert.equal(runtime.currentSignal(), navigationSignal);
    assert.deepEqual(runtime.counts(), { readCount: 3, mounts: 2, removals: 1 });
  } finally { runtime.dispose(); }
});

test('document scope survives native history notifications and is cancelled by the master switch', async () => {
  const runtime = setup({ routeScope: 'document' });
  try {
    await runtime.start();
    const initialSignal = runtime.currentSignal();
    runtime.navigate('#two');
    runtime.notifyNavigation();
    runtime.readUsing(async () => ({ ...DEFAULT_SETTINGS, rosterTools: false }));
    runtime.changed();
    await flush();
    assert.equal(runtime.currentSignal(), initialSignal);
    assert.deepEqual(runtime.counts(), { readCount: 2, mounts: 1, removals: 0 });
    runtime.readUsing(async () => ({ ...DEFAULT_SETTINGS, enabled: false }));
    runtime.changed();
    await flush();
    assert.equal(initialSignal?.aborted, true);
    assert.deepEqual(runtime.counts(), { readCount: 3, mounts: 1, removals: 1 });
  } finally { runtime.dispose(); }
});

test('Navigation API entry changes update immediately and pagehide releases the runtime source', async () => {
  const runtime = setup({}, true);
  try {
    await runtime.start();
    const initialSignal = runtime.currentSignal();
    runtime.navigateEntry('#two');
    assert.deepEqual(runtime.counts(), { readCount: 1, mounts: 2, removals: 1 });
    assert.equal(initialSignal?.aborted, true);
    assert.equal(runtime.observingLocation(), true);
    runtime.pagehide();
    assert.deepEqual(runtime.counts(), { readCount: 1, mounts: 2, removals: 2 });
    assert.equal(runtime.observingLocation(), false);
    runtime.navigateEntry('#three');
    assert.deepEqual(runtime.counts(), { readCount: 1, mounts: 2, removals: 2 });
  } finally { runtime.dispose(); }
});

test('pagehide during startup prevents pending settings from mounting after disposal', async () => {
  const runtime = setup();
  let resolveSettings: ((settings: Settings) => void) | undefined;
  const pending = new Promise<Settings>((resolve) => { resolveSettings = resolve; });
  try {
    runtime.readUsing(() => pending);
    const starting = runtime.start();
    assert.equal(runtime.observingLocation(), true);
    runtime.pagehide();
    assert.equal(runtime.observingLocation(), false);
    assert.ok(resolveSettings);
    resolveSettings({ ...DEFAULT_SETTINGS });
    await starting;
    assert.deepEqual(runtime.counts(), { readCount: 1, mounts: 0, removals: 0 });
  } finally { runtime.dispose(); }
});
