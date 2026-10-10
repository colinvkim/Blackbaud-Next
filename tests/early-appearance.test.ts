import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { startOnActivation } from '../src/runtime/activation.ts';
import { startAppearance } from '../src/runtime/early-appearance.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(rootless = true) {
  const dom = new JSDOM('', { url: 'https://example.myschoolapp.com/app/student#studentmyday/progress' });
  const page = dom.window.document;
  const root = page.documentElement;
  if (rootless) root.remove();
  Object.defineProperty(page, 'readyState', { configurable: true, value: 'loading' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const subscriptions = new Set<(changes: unknown, area: string) => void>();
  let settings = { ...DEFAULT_SETTINGS };
  let read: () => Promise<Settings> = async () => ({ ...settings });
  let reads = 0;
  const warnings: unknown[][] = [];
  const previousWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: page,
    MutationObserver: dom.window.MutationObserver,
    chrome: {
      storage: {
        sync: { get: () => { reads++; return read(); } },
        onChanged: {
          addListener: (callback: (changes: unknown, area: string) => void) => { subscriptions.add(callback); },
          removeListener: (callback: (changes: unknown, area: string) => void) => { subscriptions.delete(callback); },
        },
      },
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const runtimes: Array<Promise<Cleanup>> = [];
  return {
    page, root, view: dom.window, warnings,
    counts: () => ({ reads, subscriptions: subscriptions.size }),
    readUsing: (callback: () => Promise<Settings>) => { read = callback; },
    changed(patch: Partial<Settings>) {
      settings = { ...settings, ...patch };
      read = async () => ({ ...settings });
      for (const callback of subscriptions) callback({}, 'sync');
    },
    start() {
      const runtime = startAppearance();
      runtimes.push(runtime);
      return runtime;
    },
    addRoot() { if (!page.documentElement) page.append(root); },
    addNativePage(kind: 'progress' | 'schedule' = 'progress') {
      assert.ok(page.body);
      page.body.innerHTML = `<header id="site-header"></header><nav id="site-nav-container"></nav><main id="site-main"><div id="${kind === 'progress' ? 'coursesContainer' : 'accordionSchedules'}"></div></main>`;
    },
    hide() { dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true })); },
    show() { dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true })); },
    async dispose() {
      dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
      for (const runtime of runtimes) (await runtime)();
      dom.window.close();
      for (const [key, previous] of originals) {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
      }
      console.warn = previousWarn;
    },
  };
}

test('early appearance reads preferences before a parser root and mounts without DOMContentLoaded', async () => {
  const frame = fixture();
  try {
    const starting = frame.start();
    assert.deepEqual(frame.counts(), { reads: 1, subscriptions: 1 });
    await flush();
    assert.equal(frame.page.documentElement, null);
    frame.addRoot();
    await starting;
    assert.equal(frame.page.readyState, 'loading');
    assert.equal(frame.root.getAttribute('data-blackbaud-next-appearance'), 'true');
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-appearance').length, 1);
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-tools').length, 1);
    frame.addNativePage();
    await flush();
    assert.equal(frame.root.getAttribute('data-bn-portal-shell'), 'legacy');
    assert.equal(frame.page.getElementById('site-main')?.getAttribute('data-bn-page'), 'progress');
    assert.deepEqual(frame.warnings, []);
  } finally { await frame.dispose(); }
});

for (const preference of ['enabled', 'pageAppearance'] as const) {
  test(`early appearance waits for the saved ${preference} switch even when the root exists`, async () => {
    const frame = fixture(false);
    let resolve: ((settings: Settings) => void) | undefined;
    try {
      frame.readUsing(() => new Promise((done) => { resolve = done; }));
      const starting = frame.start();
      frame.addNativePage();
      await flush();
      assert.equal(frame.root.hasAttribute('data-blackbaud-next-appearance'), false);
      assert.equal(frame.page.querySelector('#blackbaud-next-appearance'), null);
      assert.ok(resolve);
      resolve({ ...DEFAULT_SETTINGS, [preference]: false });
      await starting;
      assert.equal(frame.root.hasAttribute('data-blackbaud-next-appearance'), false);
      assert.equal(frame.root.hasAttribute('data-bn-portal-shell'), false);
      assert.equal(frame.page.querySelector('#blackbaud-next-appearance'), null);
      assert.equal(!!frame.page.querySelector('#blackbaud-next-tools'), preference === 'pageAppearance');
      assert.deepEqual(frame.warnings, []);
    } finally {
      resolve?.({ ...DEFAULT_SETTINGS, enabled: false });
      await frame.dispose();
    }
  });
}

test('a newer switch change during parser startup wins over an older enabled read', async () => {
  const frame = fixture();
  let resolveOlder: ((settings: Settings) => void) | undefined;
  try {
    frame.readUsing(() => new Promise((done) => { resolveOlder = done; }));
    const starting = frame.start();
    frame.changed({ pageAppearance: false });
    await flush();
    assert.ok(resolveOlder);
    resolveOlder({ ...DEFAULT_SETTINGS });
    frame.addRoot();
    await starting;
    frame.addNativePage();
    await flush();
    assert.equal(frame.root.hasAttribute('data-blackbaud-next-appearance'), false);
    assert.equal(frame.root.hasAttribute('data-bn-portal-shell'), false);
    const tools = frame.page.querySelector('#blackbaud-next-tools');
    assert.ok(tools);
    frame.changed({ pageAppearance: true });
    await flush();
    assert.equal(frame.root.getAttribute('data-blackbaud-next-appearance'), 'true');
    assert.equal(frame.root.getAttribute('data-bn-portal-shell'), 'legacy');
    assert.equal(frame.page.querySelector('#blackbaud-next-tools'), tools);
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-appearance').length, 1);
    assert.deepEqual(frame.warnings, []);
  } finally {
    resolveOlder?.({ ...DEFAULT_SETTINGS, enabled: false });
    await frame.dispose();
  }
});

test('navigation during parser startup mounts the current route and switches restore native state', async () => {
  const frame = fixture();
  try {
    const starting = frame.start();
    await flush();
    frame.view.history.pushState({}, '', '#studentmyday/schedule');
    frame.view.dispatchEvent(new frame.view.PopStateEvent('popstate'));
    frame.addRoot();
    frame.addNativePage('schedule');
    await starting;
    const nativeHeader = frame.page.getElementById('site-header');
    assert.equal(frame.page.getElementById('site-main')?.getAttribute('data-bn-page'), 'schedule');
    frame.changed({ enabled: false });
    await flush();
    assert.equal(frame.root.hasAttribute('data-blackbaud-next-appearance'), false);
    assert.equal(frame.root.hasAttribute('data-bn-portal-shell'), false);
    assert.equal(frame.page.querySelector('[data-bn-page]'), null);
    assert.equal(frame.page.querySelector('#blackbaud-next-tools'), null);
    assert.equal(frame.page.querySelector('#blackbaud-next-appearance'), null);
    assert.equal(frame.page.getElementById('site-header'), nativeHeader);
    frame.changed({ enabled: true });
    await flush();
    assert.equal(frame.page.getElementById('site-main')?.getAttribute('data-bn-page'), 'schedule');
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-appearance').length, 1);
    assert.deepEqual(frame.warnings, []);
  } finally { await frame.dispose(); }
});

test('pagehide cancels parser-root observation and late preferences cannot style the disposed page', async () => {
  const frame = fixture();
  let resolve: ((settings: Settings) => void) | undefined;
  try {
    frame.readUsing(() => new Promise((done) => { resolve = done; }));
    const starting = frame.start();
    await flush();
    frame.hide();
    assert.equal(frame.counts().subscriptions, 0);
    assert.ok(resolve);
    resolve({ ...DEFAULT_SETTINGS });
    await starting;
    frame.addRoot();
    frame.addNativePage();
    await flush();
    assert.equal(frame.root.hasAttribute('data-blackbaud-next-appearance'), false);
    assert.equal(frame.root.hasAttribute('data-bn-portal-shell'), false);
    assert.equal(frame.page.querySelector('#blackbaud-next-tools'), null);
    assert.equal(frame.page.querySelector('#blackbaud-next-appearance'), null);
    assert.deepEqual(frame.warnings, []);
  } finally {
    resolve?.({ ...DEFAULT_SETTINGS, enabled: false });
    await frame.dispose();
  }
});

test('early appearance restarts after BFCache with current preferences and one style owner', async () => {
  const frame = fixture(false);
  const cleanup = startOnActivation(() => { void frame.start(); }, frame.page);
  try {
    frame.addNativePage();
    await flush();
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-appearance').length, 1);
    frame.hide();
    assert.equal(frame.root.hasAttribute('data-blackbaud-next-appearance'), false);
    frame.changed({ pageAppearance: false });
    frame.show();
    await flush();
    assert.deepEqual(frame.counts(), { reads: 2, subscriptions: 1 });
    assert.equal(frame.page.querySelector('#blackbaud-next-appearance'), null);
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-tools').length, 1);
    frame.changed({ pageAppearance: true });
    await flush();
    assert.equal(frame.page.querySelectorAll('#blackbaud-next-appearance').length, 1);
    assert.equal(frame.root.getAttribute('data-bn-portal-shell'), 'legacy');
    assert.deepEqual(frame.warnings, []);
  } finally { cleanup(); await frame.dispose(); }
});
