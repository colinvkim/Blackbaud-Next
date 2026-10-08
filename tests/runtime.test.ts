import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Feature } from '../src/shared/types.ts';
import { faviconFeature } from '../src/features/favicon.ts';
import { pageAppearanceFeature, toolStylesFeature } from '../src/features/page-appearance.ts';

test('navigation aborts old work, removes controls, and mounts a fresh feature', () => {
  let mounts = 0;
  let removals = 0;
  const signals: AbortSignal[] = [];
  const feature: Feature = {
    id: 'fixture', enabled: () => true, matches: () => true,
    mount: ({ signal }) => { mounts++; signals.push(signal); return () => { removals++; }; },
  };
  const controller = new FeatureController([feature]);
  controller.update(new URL('https://example.myschoolapp.com/app#one'), DEFAULT_SETTINGS);
  controller.update(new URL('https://example.myschoolapp.com/app#one'), DEFAULT_SETTINGS);
  assert.equal(mounts, 1);
  controller.update(new URL('https://example.myschoolapp.com/app#two'), DEFAULT_SETTINGS);
  assert.equal(signals[0].aborted, true);
  assert.equal(removals, 1);
  assert.equal(mounts, 2);
  controller.update(new URL('https://example.myschoolapp.com/app#two'), { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(signals[1].aborted, true);
  assert.equal(removals, 2);
  controller.dispose();
  assert.equal(removals, 2);
});

test('a failing feature cannot stop unrelated features from working', () => {
  let errorCount = 0;
  let mounted = false;
  let failedSignal: AbortSignal | undefined;
  const controller = new FeatureController([
    { id: 'broken', enabled: () => true, matches: () => true, mount: ({ signal }) => { failedSignal = signal; throw new Error('fixture failure'); } },
    { id: 'working', enabled: () => true, matches: () => true, mount: () => { mounted = true; } },
  ], () => { errorCount++; });
  controller.update(new URL('https://example.myschoolapp.com/app'), DEFAULT_SETTINGS);
  assert.equal(errorCount, 1);
  assert.equal(failedSignal?.aborted, true);
  assert.equal(mounted, true);
  controller.dispose();
});

test('unrelated switches preserve mounted controls and their current state', () => {
  const controls: Array<{ signal: AbortSignal; value: string }> = [];
  const rosterSignals: AbortSignal[] = [];
  const controller = new FeatureController([
    {
      id: 'search', settingsKeys: [], enabled: (settings) => settings.resourceSearch, matches: () => true,
      mount: ({ signal }) => { controls.push({ signal, value: '' }); },
    },
    {
      id: 'roster', settingsKeys: [], enabled: (settings) => settings.rosterTools, matches: () => true,
      mount: ({ signal }) => { rosterSignals.push(signal); },
    },
  ]);
  const url = new URL('https://example.myschoolapp.com/app#resources');
  controller.update(url, DEFAULT_SETTINGS);
  const search = controls[0];
  search.value = 'science';
  controller.update(url, { ...DEFAULT_SETTINGS, rosterTools: false });
  controller.update(url, { ...DEFAULT_SETTINGS, rosterTools: false, pageAppearance: false });
  assert.equal(controls.length, 1);
  assert.equal(controls[0], search);
  assert.equal(search.value, 'science');
  assert.equal(search.signal.aborted, false);
  assert.equal(rosterSignals.length, 1);
  assert.equal(rosterSignals[0].aborted, true);
  controller.update(url, DEFAULT_SETTINGS);
  assert.equal(controls.length, 1);
  assert.equal(rosterSignals.length, 2);
  assert.equal(rosterSignals[1].aborted, false);
  controller.dispose();
});

test('native appearance and favicon nodes retain identity across compatible routes and switches', () => {
  const dom = new JSDOM('<head><link rel="icon" href="/school.png"></head><body><main id="site-main"></main></body>', {
    url: 'https://example.myschoolapp.com/app/student#studentmyday/progress',
  });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    chrome: { storage: {}, runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } },
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const controller = new FeatureController([toolStylesFeature, pageAppearanceFeature, faviconFeature]);
  try {
    controller.update(new URL(dom.window.location.href), DEFAULT_SETTINGS);
    const tools = dom.window.document.querySelector('#blackbaud-next-tools');
    const appearance = dom.window.document.querySelector('#blackbaud-next-appearance');
    const favicon = dom.window.document.querySelector('[data-blackbaud-next-favicon]');
    assert.ok(tools);
    assert.ok(appearance);
    assert.ok(favicon);
    const url = new URL('https://example.myschoolapp.com/app/student#directory/123');
    controller.update(url, { ...DEFAULT_SETTINGS, rosterTools: false, resourceSearch: false });
    assert.equal(dom.window.document.querySelector('#blackbaud-next-tools'), tools);
    assert.equal(dom.window.document.querySelector('#blackbaud-next-appearance'), appearance);
    assert.equal(dom.window.document.querySelector('[data-blackbaud-next-favicon]'), favicon);
    assert.equal(dom.window.document.querySelectorAll('style').length, 2);
    controller.update(url, { ...DEFAULT_SETTINGS, pageAppearance: false });
    assert.equal(dom.window.document.querySelector('#blackbaud-next-appearance'), null);
    assert.equal(dom.window.document.documentElement.getAttribute('data-blackbaud-next-appearance'), null);
    assert.equal(dom.window.document.querySelector('#blackbaud-next-tools'), tools);
    assert.equal(dom.window.document.querySelector('[data-blackbaud-next-favicon]'), favicon);
    controller.update(url, { ...DEFAULT_SETTINGS, enabled: false });
    assert.equal(dom.window.document.querySelectorAll('style').length, 0);
    assert.equal(dom.window.document.querySelector('[data-blackbaud-next-favicon]'), null);
    assert.equal(dom.window.document.querySelector('link[rel="icon"]')?.getAttribute('href'), '/school.png');
  } finally {
    controller.dispose();
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('auth restarts only for its own settings and keeps exact navigation cancellation', () => {
  const signals: AbortSignal[] = [];
  const actions: string[] = [];
  const controller = new FeatureController([{
    id: 'auth',
    settingsKeys: ['automaticLogin', 'optimizeLoginPage', 'loadingOverlay', 'accountPreference'],
    enabled: (settings) => settings.automaticLogin || settings.optimizeLoginPage,
    matches: () => true,
    mount: ({ signal, settings, url }) => {
      signals.push(signal);
      actions.push(`${url.hash}:${settings.accountPreference}`);
      return () => { assert.equal(signal.aborted, true); actions.push('cancel'); };
    },
  }]);
  const url = new URL('https://example.myschoolapp.com/app#one');
  controller.update(url, DEFAULT_SETTINGS);
  controller.update(url, { ...DEFAULT_SETTINGS, resourceSearch: false });
  assert.equal(signals.length, 1);
  controller.update(url, { ...DEFAULT_SETTINGS, accountPreference: 'school.edu' });
  assert.equal(signals[0].aborted, true);
  assert.equal(signals.length, 2);
  controller.update(new URL('https://example.myschoolapp.com/app#two'), { ...DEFAULT_SETTINGS, accountPreference: 'school.edu' });
  assert.equal(signals[1].aborted, true);
  assert.deepEqual(actions, ['#one:', 'cancel', '#one:school.edu', 'cancel', '#two:school.edu']);
  controller.update(url, { ...DEFAULT_SETTINGS, automaticLogin: false, optimizeLoginPage: false });
  assert.equal(signals[2].aborted, true);
  assert.equal(signals.length, 3);
  controller.dispose();
});

test('document features survive compatible navigation while page work is replaced', () => {
  const documentSignals: AbortSignal[] = [];
  const pageSignals: AbortSignal[] = [];
  const events: string[] = [];
  const controller = new FeatureController([
    {
      id: 'styles', settingsKeys: [], routeScope: 'document', enabled: () => true,
      matches: (url) => url.pathname.startsWith('/app'),
      mount: ({ signal }) => { documentSignals.push(signal); return () => { events.push('styles removed'); }; },
    },
    {
      id: 'preview', settingsKeys: [], enabled: () => true, matches: () => true,
      mount: ({ signal, url }) => {
        pageSignals.push(signal);
        events.push(`preview ${url.hash}`);
        return () => { assert.equal(signal.aborted, true); events.push('preview removed'); };
      },
    },
  ]);
  controller.update(new URL('https://example.myschoolapp.com/app#one'), DEFAULT_SETTINGS);
  controller.update(new URL('https://example.myschoolapp.com/app?term=2#two'), DEFAULT_SETTINGS);
  assert.equal(documentSignals.length, 1);
  assert.equal(documentSignals[0].aborted, false);
  assert.equal(pageSignals[0].aborted, true);
  assert.deepEqual(events, ['preview #one', 'preview removed', 'preview #two']);
  controller.update(new URL('https://example.myschoolapp.com/login'), DEFAULT_SETTINGS);
  assert.equal(documentSignals[0].aborted, true);
  controller.update(new URL('https://example.myschoolapp.com/app#three'), DEFAULT_SETTINGS);
  assert.equal(documentSignals.length, 2);
  controller.update(new URL('https://other.myschoolapp.com/app#three'), DEFAULT_SETTINGS);
  assert.equal(documentSignals[1].aborted, true);
  assert.equal(documentSignals.length, 3);
  controller.dispose();
});

test('master disable cancels every scope once and reenable mounts fresh features', () => {
  const signals: AbortSignal[] = [];
  let removals = 0;
  const controller = new FeatureController(['page', 'document'].map((routeScope) => ({
    id: routeScope,
    settingsKeys: [],
    routeScope: routeScope as 'page' | 'document',
    enabled: () => true,
    matches: () => true,
    mount: ({ signal }) => { signals.push(signal); return () => { removals++; }; },
  })));
  const url = new URL('https://example.myschoolapp.com/app');
  controller.update(url, DEFAULT_SETTINGS);
  controller.update(url, { ...DEFAULT_SETTINGS, enabled: false });
  controller.update(url, { ...DEFAULT_SETTINGS, enabled: false, loadingOverlay: false });
  assert.equal(removals, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  controller.update(url, DEFAULT_SETTINGS);
  assert.equal(signals.length, 4);
  assert.ok(signals.slice(2).every((signal) => !signal.aborted));
  controller.dispose();
  controller.dispose();
  assert.equal(removals, 4);
});

test('undeclared dependencies conservatively restart work when settings change', () => {
  const signals: AbortSignal[] = [];
  const controller = new FeatureController([{
    id: 'unannotated', enabled: () => true, matches: () => true,
    mount: ({ signal }) => { signals.push(signal); },
  }]);
  const url = new URL('https://example.myschoolapp.com/app');
  controller.update(url, DEFAULT_SETTINGS);
  controller.update(url, { ...DEFAULT_SETTINGS, accountPreference: 'school.edu' });
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  controller.dispose();
});

for (const stage of ['enabled', 'matches', 'settingsKeys'] as const) {
  test(`a ${stage} failure disposes only that feature's stale active work`, () => {
    let broken = false;
    const signals: Record<string, AbortSignal[]> = { fragile: [], stable: [] };
    const errors: string[] = [];
    const fragile: Feature = {
      id: 'fragile', settingsKeys: [], enabled: () => true, matches: () => true,
      mount: ({ signal }) => { signals.fragile.push(signal); },
    };
    const original = fragile[stage];
    if (stage === 'settingsKeys') {
      Object.defineProperty(fragile, stage, { get: () => { if (broken) throw new Error('Fixture failure'); return original; } });
    } else {
      fragile[stage] = () => { if (broken) throw new Error('Fixture failure'); return true; };
    }
    const stable: Feature = {
      id: 'stable', settingsKeys: [], enabled: () => true, matches: () => true,
      mount: ({ signal }) => { signals.stable.push(signal); },
    };
    const controller = new FeatureController([fragile, stable], (id) => { errors.push(id); });
    const url = new URL('https://example.myschoolapp.com/app');
    controller.update(url, DEFAULT_SETTINGS);
    broken = true;
    controller.update(url, { ...DEFAULT_SETTINGS, pageAppearance: false });
    assert.deepEqual(errors, ['fragile']);
    assert.equal(signals.fragile[0].aborted, true);
    assert.equal(signals.stable.length, 1);
    assert.equal(signals.stable[0].aborted, false);
    broken = false;
    controller.update(url, DEFAULT_SETTINGS);
    assert.equal(signals.fragile.length, 2);
    assert.equal(signals.stable.length, 1);
    controller.dispose();
  });
}

test('a cleanup failure cannot prevent replacement or disturb a retained feature', () => {
  const signals: AbortSignal[] = [];
  let stableMounts = 0;
  let errors = 0;
  const controller = new FeatureController([
    {
      id: 'broken-cleanup', settingsKeys: [], enabled: () => true, matches: () => true,
      mount: ({ signal }) => { signals.push(signal); return () => { throw new Error('Fixture cleanup failure'); }; },
    },
    {
      id: 'stable', settingsKeys: [], routeScope: 'document', enabled: () => true, matches: () => true,
      mount: () => { stableMounts++; },
    },
  ], () => { errors++; });
  controller.update(new URL('https://example.myschoolapp.com/app#one'), DEFAULT_SETTINGS);
  controller.update(new URL('https://example.myschoolapp.com/app#two'), DEFAULT_SETTINGS);
  assert.equal(errors, 1);
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.equal(stableMounts, 1);
  controller.dispose();
});
