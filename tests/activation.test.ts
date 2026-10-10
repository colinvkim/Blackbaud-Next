import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { startOnActivation } from '../src/runtime/activation.ts';
import { startExtension } from '../src/runtime/start.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

function fixture(prerendering = false) {
  const dom = new JSDOM('', { url: 'https://example.myschoolapp.com/lms-assignment/assignment-center/student' });
  const page = dom.window.document;
  Object.defineProperty(page, 'prerendering', { configurable: true, get: () => prerendering });
  return {
    page,
    activation(value = false) {
      prerendering = value;
      page.dispatchEvent(new dom.window.Event('prerenderingchange'));
    },
    hide(persisted = true) { dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted })); },
    show(persisted = true) { dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted })); },
    close: () => dom.window.close(),
  };
}

test('fresh loads start once and ignore initial or duplicate lifecycle notifications', () => {
  const frame = fixture();
  let starts = 0;
  const cleanup = startOnActivation(() => { starts++; }, frame.page);
  try {
    assert.equal(starts, 1);
    frame.show(false);
    frame.show(true);
    frame.activation();
    frame.activation();
    assert.equal(starts, 1);
  } finally { cleanup(); frame.close(); }
});

test('prerender defers settings, authentication work, and features until confirmed activation', () => {
  const frame = fixture(true);
  const work = { settingsReads: 0, authReads: 0, authWrites: 0, featureMounts: 0 };
  let enabled = true;
  const observedSettings: boolean[] = [];
  const cleanup = startOnActivation(() => {
    work.settingsReads++;
    observedSettings.push(enabled);
    if (!enabled) return;
    work.authReads++;
    work.authWrites++;
    work.featureMounts++;
  }, frame.page);
  try {
    frame.activation(true);
    frame.show(false);
    frame.show(true);
    assert.deepEqual(work, { settingsReads: 0, authReads: 0, authWrites: 0, featureMounts: 0 });
    enabled = false;
    frame.activation();
    assert.deepEqual(observedSettings, [false]);
    assert.deepEqual(work, { settingsReads: 1, authReads: 0, authWrites: 0, featureMounts: 0 });
    frame.activation();
    frame.show(true);
    assert.equal(work.settingsReads, 1);
  } finally { cleanup(); frame.close(); }
});

test('an ordinary hidden background document starts immediately', () => {
  const frame = fixture();
  Object.defineProperty(frame.page, 'visibilityState', { value: 'hidden', configurable: true });
  Object.defineProperty(frame.page, 'hidden', { value: true, configurable: true });
  let starts = 0;
  const cleanup = startOnActivation(() => { starts++; }, frame.page);
  try {
    assert.equal(starts, 1);
  } finally { cleanup(); frame.close(); }
});

test('the real runtime reads current preferences only at activation and again after BFCache restore', async () => {
  const frame = fixture(true);
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let enabled = true;
  let reads = 0;
  let subscriptions = 0;
  let mounts = 0;
  let removals = 0;
  for (const [key, value] of Object.entries({
    window: frame.page.defaultView,
    chrome: {
      storage: {
        sync: { get: async () => { reads++; return { ...DEFAULT_SETTINGS, enabled }; } },
        onChanged: {
          addListener: () => { subscriptions++; },
          removeListener: () => { subscriptions--; },
        },
      },
    },
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const runtimes: Array<Promise<Cleanup>> = [];
  const cleanup = startOnActivation(() => {
    runtimes.push(startExtension([{
      id: 'activation-fixture', settingsKeys: [], enabled: () => true, matches: () => true,
      mount: () => { mounts++; return () => { removals++; }; },
    }]));
  }, frame.page);
  try {
    assert.deepEqual({ reads, subscriptions, mounts }, { reads: 0, subscriptions: 0, mounts: 0 });
    enabled = false;
    frame.activation();
    await runtimes[0];
    assert.deepEqual({ reads, subscriptions, mounts }, { reads: 1, subscriptions: 1, mounts: 0 });
    frame.hide();
    assert.equal(subscriptions, 0);
    enabled = true;
    frame.show();
    await runtimes[1];
    assert.deepEqual({ reads, subscriptions, mounts }, { reads: 2, subscriptions: 1, mounts: 1 });
    frame.show();
    frame.activation();
    assert.equal(runtimes.length, 2);
    frame.hide();
    assert.equal(removals, 1);
    assert.equal(subscriptions, 0);
  } finally {
    cleanup();
    for (const runtime of runtimes) (await runtime)();
    frame.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('pagehide cancels a prerender that never activated', () => {
  const frame = fixture(true);
  let starts = 0;
  const cleanup = startOnActivation(() => { starts++; }, frame.page);
  try {
    frame.hide(false);
    frame.activation();
    frame.show(true);
    frame.activation();
    assert.equal(starts, 0);
  } finally { cleanup(); frame.close(); }
});

test('explicit disposal cancels pending activation and future BFCache callbacks', () => {
  const frame = fixture(true);
  let starts = 0;
  const cleanup = startOnActivation(() => { starts++; }, frame.page);
  try {
    cleanup();
    cleanup();
    frame.activation();
    frame.hide();
    frame.show();
    assert.equal(starts, 0);
  } finally { cleanup(); frame.close(); }
});

test('each BFCache restoration starts fresh once after the previous runtime hides', () => {
  const frame = fixture(true);
  let preference = 'initial';
  const starts: string[] = [];
  const cleanup = startOnActivation(() => { starts.push(preference); }, frame.page);
  try {
    frame.activation();
    frame.show(false);
    frame.show(true);
    assert.deepEqual(starts, ['initial']);
    frame.hide();
    preference = 'changed while cached';
    frame.activation();
    assert.deepEqual(starts, ['initial']);
    frame.show();
    frame.show();
    frame.activation();
    assert.deepEqual(starts, ['initial', 'changed while cached']);
    frame.hide();
    preference = 'next restore';
    frame.show(false);
    assert.equal(starts.length, 2);
    frame.show();
    assert.deepEqual(starts, ['initial', 'changed while cached', 'next restore']);
    cleanup();
    frame.hide();
    frame.show();
    assert.equal(starts.length, 3);
  } finally { cleanup(); frame.close(); }
});

test('initial startup failures remove pending lifecycle callbacks', () => {
  const frame = fixture();
  let attempts = 0;
  try {
    assert.throws(() => startOnActivation(() => { attempts++; throw new Error('Fixture failure'); }, frame.page), /Fixture failure/);
    frame.hide();
    frame.show();
    frame.activation();
    assert.equal(attempts, 1);
  } finally { frame.close(); }
});
