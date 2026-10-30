import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { watchLocation } from '../src/shared/location.ts';
import type { LocationChange } from '../src/shared/location.ts';

const cleanups: Array<() => void> = [];

function fixture(withNavigation = true) {
  const dom = new JSDOM('', { url: 'https://example.myschoolapp.com/app#source' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });
  cleanups.push(() => {
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const navigation = new dom.window.EventTarget();
  if (withNavigation) Object.defineProperty(dom.window, 'navigation', { value: navigation });
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  Object.defineProperty(dom.window, 'setInterval', { value: (callback: () => void, delay: number) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  } });
  Object.defineProperty(dom.window, 'clearInterval', { value: (id: number) => { timers.delete(id); } });
  const controller = () => {
    const abort = new AbortController();
    cleanups.push(() => abort.abort());
    return abort;
  };
  return {
    dom, controller, timers,
    navigate(hash: string, event = 'currententrychange') {
      dom.window.history.pushState({}, '', hash);
      const target = event === 'currententrychange' ? navigation : dom.window;
      target.dispatchEvent(new dom.window.Event(event));
    },
    poll() { for (const timer of timers.values()) timer.callback(); },
  };
}

afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

test('independent bundled copies share one source and release it after the final subscriber', async () => {
  const page = fixture();
  const copy: typeof import('../src/shared/location.ts') = await import(new URL('../src/shared/location.ts?second-bundle', import.meta.url).href);
  assert.notEqual(copy.watchLocation, watchLocation);
  const first = page.controller();
  const second = page.controller();
  const firstUrls: string[] = [];
  const secondUrls: string[] = [];
  watchLocation(({ url }) => { firstUrls.push(url.hash); }, first.signal);
  copy.watchLocation(({ url }) => { secondUrls.push(url.hash); }, second.signal);
  assert.deepEqual([...page.timers.values()].map(({ delay }) => delay), [2_000]);
  assert.deepEqual(firstUrls, ['#source']);
  assert.deepEqual(secondUrls, ['#source']);
  page.navigate('#destination');
  assert.deepEqual(firstUrls, ['#source', '#destination']);
  assert.deepEqual(secondUrls, ['#source', '#destination']);
  first.abort();
  page.navigate('#later');
  assert.deepEqual(firstUrls, ['#source', '#destination']);
  assert.deepEqual(secondUrls, ['#source', '#destination', '#later']);
  assert.equal(page.timers.size, 1);
  second.abort();
  assert.equal(page.timers.size, 0);
  assert.equal(page.dom.window.__blackbaudNextLocationV1, undefined);
  page.navigate('#after-disposal');
  assert.deepEqual(secondUrls, ['#source', '#destination', '#later']);
  const restart: string[] = [];
  watchLocation(({ url }) => { restart.push(url.hash); }, page.controller().signal);
  assert.deepEqual(restart, ['#after-disposal']);
  assert.equal(page.timers.size, 1);
});

test('navigation events update synchronously and backup polling only reports changed URLs', () => {
  const page = fixture();
  const urls: string[] = [];
  watchLocation(({ url }) => { urls.push(url.hash); }, page.controller().signal);
  page.navigate('#one');
  page.poll();
  page.dom.window.history.replaceState({}, '', '#two');
  page.poll();
  page.poll();
  assert.deepEqual(urls, ['#source', '#one', '#two']);
});

test('popstate and hashchange work without Navigation API and use the fast fallback', () => {
  const page = fixture(false);
  const urls: string[] = [];
  watchLocation(({ url }) => { urls.push(url.hash); }, page.controller().signal);
  assert.deepEqual([...page.timers.values()].map(({ delay }) => delay), [300]);
  page.navigate('#pop', 'popstate');
  page.navigate('#hash', 'hashchange');
  page.dom.window.history.pushState({}, '', '#polled');
  page.poll();
  assert.deepEqual(urls, ['#source', '#pop', '#hash', '#polled']);
});

test('queued hash transitions retain their destination and timestamp even when the live URL is unchanged', () => {
  const page = fixture();
  const changes: LocationChange[] = [];
  watchLocation((change) => { changes.push(change); }, page.controller().signal);
  const source = page.dom.window.location.href;
  const destination = source.replace('#source', '#destination');
  const outward = new page.dom.window.HashChangeEvent('hashchange', { oldURL: source, newURL: destination });
  const returned = new page.dom.window.HashChangeEvent('hashchange', { oldURL: destination, newURL: source });
  page.dom.window.dispatchEvent(outward);
  page.dom.window.dispatchEvent(returned);
  assert.deepEqual(changes.map(({ url, transition }) => [url.hash, transition?.url.hash, transition?.timeStamp]), [
    ['#source', undefined, undefined],
    ['#source', '#destination', outward.timeStamp],
    ['#source', '#source', returned.timeStamp],
  ]);
});

test('malformed or cross-origin hash destinations reconcile only valid live changes', () => {
  const page = fixture();
  const changes: LocationChange[] = [];
  watchLocation((change) => { changes.push(change); }, page.controller().signal);
  page.dom.window.history.pushState({}, '', '#changed');
  page.dom.window.dispatchEvent(new page.dom.window.HashChangeEvent('hashchange', { newURL: 'invalid url' }));
  page.dom.window.history.pushState({}, '', '#later');
  page.dom.window.dispatchEvent(new page.dom.window.HashChangeEvent('hashchange', { newURL: 'https://other.example/app#away' }));
  assert.deepEqual(changes.map(({ url, transition }) => [url.hash, transition]), [
    ['#source', undefined], ['#changed', undefined], ['#later', undefined],
  ]);
});

test('aborted subscribers never start a source and an abort during delivery skips later callbacks', () => {
  const page = fixture();
  const cancelled = page.controller();
  cancelled.abort();
  let cancelledCalls = 0;
  watchLocation(() => { cancelledCalls += 1; }, cancelled.signal);
  assert.equal(cancelledCalls, 0);
  assert.equal(page.timers.size, 0);
  const later = page.controller();
  watchLocation(({ url }) => { if (url.hash === '#destination') later.abort(); }, page.controller().signal);
  let laterCalls = 0;
  watchLocation(() => { laterCalls += 1; }, later.signal);
  page.navigate('#destination');
  assert.equal(laterCalls, 1);
});

test('subscriber errors do not interrupt initial or later delivery and cleanup stays idempotent', () => {
  const page = fixture();
  const previous = console.warn;
  let reports = 0;
  console.warn = () => { reports += 1; };
  cleanups.push(() => { console.warn = previous; });
  const stop = watchLocation(() => { throw new Error('Broken subscriber'); }, page.controller().signal);
  const urls: string[] = [];
  watchLocation(({ url }) => { urls.push(url.hash); }, page.controller().signal);
  page.navigate('#destination');
  assert.deepEqual(urls, ['#source', '#destination']);
  assert.equal(reports, 2);
  stop();
  stop();
  assert.equal(page.timers.size, 1);
});
