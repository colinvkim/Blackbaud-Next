import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS, FEATURE_DEFINITIONS } from '../src/shared/settings.ts';
import { INDEPENDENT_DIRECTORY_REQUEST_EVENT } from '../src/blackbaud/directory-independent-protocol.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('LMS startup arms directory loading before DOM readiness and honors disablement while other tools wait', async () => {
  const dom = new JSDOM('', { url: 'https://example.myschoolapp.com/app/student#studentmyday/progress' });
  const page = dom.window.document;
  const blockReady = (event: Event) => event.stopImmediatePropagation();
  page.addEventListener('DOMContentLoaded', blockReady, true);
  Object.defineProperty(page, 'readyState', { configurable: true, value: 'loading' });
  let settings = { ...DEFAULT_SETTINGS };
  for (const { key } of FEATURE_DEFINITIONS) settings[key] = false;
  settings.enhancedDirectory = true;
  settings.fixFavicon = true;
  const subscriptions = new Set<(changes: unknown, area: string) => void>();
  const requests: string[] = [];
  page.addEventListener(INDEPENDENT_DIRECTORY_REQUEST_EVENT, (event) => {
    const request: unknown = JSON.parse((event as CustomEvent).detail);
    if (request && typeof request === 'object' && 'action' in request && typeof request.action === 'string') requests.push(request.action);
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const previousWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: page,
    MutationObserver: dom.window.MutationObserver,
    chrome: {
      storage: {
        sync: { get: async () => ({ ...settings }) },
        onChanged: {
          addListener: (listener: (changes: unknown, area: string) => void) => { subscriptions.add(listener); },
          removeListener: (listener: (changes: unknown, area: string) => void) => { subscriptions.delete(listener); },
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const changed = (enabled: boolean) => {
    settings = { ...settings, enabled };
    for (const listener of subscriptions) listener({}, 'sync');
  };
  const icon = () => page.querySelector('[data-blackbaud-next-favicon]');
  try {
    await import('../src/entrypoints/lms.ts');
    await flush();
    assert.deepEqual(requests, ['enable']);
    assert.equal(icon(), null);
    changed(false);
    await flush();
    assert.deepEqual(requests, ['enable', 'disable']);
    page.removeEventListener('DOMContentLoaded', blockReady, true);
    Object.defineProperty(page, 'readyState', { configurable: true, value: 'interactive' });
    page.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flush();
    assert.equal(icon(), null);
    changed(true);
    await flush();
    assert.deepEqual(requests, ['enable', 'disable', 'enable']);
    assert.equal(icon()?.getAttribute('href'), 'chrome-extension://fixture/assets/blackbaud.png');
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    assert.equal(icon(), null);
    assert.equal(subscriptions.size, 0);
    settings = { ...settings, enabled: false };
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    await flush();
    assert.equal(icon(), null);
    assert.deepEqual(requests, ['enable', 'disable', 'enable', 'disable']);
    assert.deepEqual(warnings, []);
  } finally {
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    console.warn = previousWarn;
  }
});
