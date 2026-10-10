import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { claimDirectoryPreparedSnapshot, createDirectoryLoadingManager, DIRECTORY_READ_LIFETIME, registerDirectoryLoadingManager } from '../src/blackbaud/directory-loading.ts';
import type { DirectoryLoadingManager, DirectoryPreparedReader } from '../src/blackbaud/directory-loading.ts';
import type { DirectoryPreparedSnapshot, DirectoryTarget } from '../src/blackbaud/directory.ts';
import { createDirectoryLoadingFeature } from '../src/features/directory-loading.ts';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const sourceHref = 'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/schedule';
const destinationHref = 'https://example.myschoolapp.com/app/student?svcid=edu#directory/123';
const target: DirectoryTarget = { directoryId: '123', origin: 'https://example.myschoolapp.com' };
const prepared: DirectoryPreparedSnapshot = { snapshot: { entries: [], totalCount: 0 }, photoFiles: [] };
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(html = '<nav id="topnav-containter"><a href="?svcid=edu#directory/123"><span>Student</span></a></nav>') {
  dom = new JSDOM(html, { url: sourceHref, pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: win, document: win.document, MutationObserver: win.MutationObserver })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return document.querySelector<HTMLAnchorElement>('a')!;
}

function mount(read: DirectoryPreparedReader) {
  const controller = new AbortController();
  const feature = createDirectoryLoadingFeature(read);
  const cleanup = feature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  return { controller, cleanup, feature };
}

function click(element: Element, options: MouseEventInit = {}, prevented = false) {
  const event = new dom!.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options });
  if (prevented) event.preventDefault();
  element.dispatchEvent(event);
  return event;
}

function route(href: string, paired = false) {
  window.history.replaceState(null, '', href);
  window.dispatchEvent(new dom!.window.Event('hashchange'));
  if (paired) window.dispatchEvent(new dom!.window.Event('popstate'));
}

function hashTransition(oldURL: string, newURL: string): HashChangeEvent {
  const event = new dom!.window.HashChangeEvent('hashchange', { oldURL, newURL });
  // Chrome records this timestamp at the hash mutation, before queued event
  // dispatch. JSDOM uses an epoch clock; normalize to the browser timeline.
  Object.defineProperty(event, 'timeStamp', { value: window.performance.now() });
  return event;
}

function managerFixture(read: DirectoryPreparedReader = () => new Promise(() => {})) {
  let href = sourceHref;
  const manager = createDirectoryLoadingManager(read, () => new URL(href), () => performance.now());
  cleanups.push(manager.dispose);
  const navigate = (next: string) => { href = next; manager.updateRoute(new URL(href)); };
  return { manager, navigate, setHref: (next: string) => { href = next; } };
}

async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('native Student click starts its read synchronously in capture without changing native navigation', async () => {
  const anchor = fixture();
  const pending = deferred<DirectoryPreparedSnapshot>();
  let readSignal: AbortSignal | undefined;
  let calls = 0;
  let beforeBubble = false;
  const { feature } = mount((requested, signal, intent) => {
    calls += 1;
    readSignal = signal;
    assert.deepEqual(requested, target);
    assert.equal(intent?.href, destinationHref);
    return pending.promise;
  });
  anchor.addEventListener('click', () => { beforeBubble = calls === 1; });
  const nativeHref = anchor.getAttribute('href');
  const event = click(anchor.firstElementChild!);
  assert.equal(calls, 1);
  assert.equal(beforeBubble, true);
  assert.equal(event.defaultPrevented, false);
  assert.equal(anchor.getAttribute('href'), nativeHref);
  assert.equal(feature.routeScope, 'document');
  assert.deepEqual(feature.settingsKeys, []);
  assert.equal(feature.enabled({ ...DEFAULT_SETTINGS, enhancedDirectory: false }), false);
  route(destinationHref, true);
  const claimed = claimDirectoryPreparedSnapshot(target, new AbortController().signal);
  assert.equal(claimed, pending.promise);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), null);
  pending.resolve(prepared);
  assert.equal(await claimed, prepared);
  await flush();
  assert.equal(readSignal?.aborted, false);
});

test('capture ignores modifiers, new windows, downloads, prevented clicks, hidden links and unrecognized destinations', () => {
  const anchor = fixture();
  let reads = 0;
  mount(() => { reads += 1; return new Promise(() => {}); });
  for (const options of [{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) click(anchor, options);
  click(anchor, {}, true);
  anchor.target = '_blank';
  click(anchor);
  anchor.removeAttribute('target');
  anchor.setAttribute('download', '');
  click(anchor);
  anchor.removeAttribute('download');
  anchor.parentElement!.hidden = true;
  click(anchor);
  anchor.parentElement!.hidden = false;
  for (const href of ['https://other.myschoolapp.com/app/student?svcid=edu#directory/123', 'https://name:secret@example.myschoolapp.com/app/student?svcid=edu#directory/123', '/app/teacher?svcid=edu#directory/123', '?svcid=other#directory/123', '?svcid=edu#directory/123/delete', '#directory/123?action=other', '#profile/123/contactcard']) {
    anchor.setAttribute('href', href);
    click(anchor);
  }
  anchor.setAttribute('href', '?svcid=edu#directory/123');
  anchor.textContent = 'Faculty';
  document.body.append(anchor);
  click(anchor);
  assert.equal(reads, 0);
});

test('desktop, mobile and native Directory dropdown Student links can begin a read', () => {
  fixture(`<nav id="topnav-containter"><a href="?svcid=edu#directory/123">Student</a></nav><nav id="site-mobile-sitenav"><a href="?svcid=edu#directory/123">Students</a></nav><main id="site-main"><div class="dropdown-menu"><a href="?svcid=edu#directory/123">Student Directory</a></div><div class="dropdown-menu-mobile"><a href="?svcid=edu#directory/123">Students</a></div></main>`);
  let reads = 0;
  mount(() => { reads += 1; return new Promise(() => {}); });
  for (const anchor of document.querySelectorAll('a')) click(anchor);
  // Repeated clicks to the same destination share one read, including copies
  // of native desktop/mobile menu links.
  assert.equal(reads, 1);
});

test('native Faculty, Parents and custom Directory labels start reads from desktop, mobile and dropdown navigation', () => {
  fixture(`<nav id="topnav-containter"><a href="?svcid=edu#directory/456">Faculty</a></nav><nav id="site-mobile-sitenav"><a href="?svcid=edu#directory/789">Parents</a></nav><main id="site-main"><div class="dropdown-menu"><a href="?svcid=edu#directory/987">Alumni Connections</a></div><div class="dropdown-menu-mobile"><a href="?svcid=edu#directory/876">Community Volunteers</a></div></main>`);
  const requests: { id: string; url: string; signal: AbortSignal }[] = [];
  mount((requested, signal, intent) => {
    requests.push({ id: requested.directoryId, url: intent!.href, signal });
    return new Promise(() => {});
  });
  for (const anchor of document.querySelectorAll('a')) {
    const nativeHref = anchor.getAttribute('href');
    // Supply each next native click while still on the same source route.
    anchor.addEventListener('click', (event) => event.preventDefault(), { once: true });
    click(anchor);
    assert.equal(anchor.getAttribute('href'), nativeHref);
  }
  assert.deepEqual(requests.map((request) => request.id), ['456', '789', '987', '876']);
  assert.deepEqual(requests.map((request) => request.url), ['456', '789', '987', '876'].map((id) => destinationHref.replace('/123', `/${id}`)));
  assert.deepEqual(requests.map((request) => request.signal.aborted), [true, true, true, false]);
});

test('queued native hashchange transitions invalidate a departed intent even when the live URL already returned to source', async () => {
  const anchor = fixture();
  const first = deferred<DirectoryPreparedSnapshot>();
  const second = deferred<DirectoryPreparedSnapshot>();
  const signals: AbortSignal[] = [];
  mount((_target, signal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise; });
  // The fixture supplies the native hash transitions explicitly, so suppress
  // JSDOM's asynchronous default navigation from this synthetic click.
  anchor.addEventListener('click', (event) => event.preventDefault());
  click(anchor);
  assert.equal(window.location.href, sourceHref);
  window.dispatchEvent(hashTransition(sourceHref, destinationHref));
  window.dispatchEvent(hashTransition(destinationHref, sourceHref));
  assert.equal(signals[0]!.aborted, true);
  click(anchor);
  assert.equal(signals.length, 2);
  first.resolve(prepared);
  await flush();
  route(destinationHref, true);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), second.promise);
  assert.equal(signals[1]!.aborted, false);
});

test('historical queued hashchange events cannot cancel a newer intent from a different source', () => {
  const anchor = fixture();
  const first = deferred<DirectoryPreparedSnapshot>();
  const second = deferred<DirectoryPreparedSnapshot>();
  const signals: AbortSignal[] = [];
  mount((_target, signal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise; });
  anchor.addEventListener('click', (event) => event.preventDefault());
  click(anchor);
  const progress = sourceHref.replace('/schedule', '/progress');
  window.history.replaceState(null, '', destinationHref);
  const oldEntry = hashTransition(sourceHref, destinationHref);
  window.history.replaceState(null, '', progress);
  const oldDeparture = hashTransition(destinationHref, progress);
  click(anchor);
  assert.deepEqual(signals.map((signal) => signal.aborted), [true, false]);
  window.history.replaceState(null, '', destinationHref);
  window.dispatchEvent(oldEntry);
  window.dispatchEvent(oldDeparture);
  assert.deepEqual(signals.map((signal) => signal.aborted), [true, false]);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), second.promise);
});

test('historical same-source transitions cannot cancel a freshly created read for the same destination', () => {
  const anchor = fixture();
  const first = deferred<DirectoryPreparedSnapshot>();
  const second = deferred<DirectoryPreparedSnapshot>();
  const signals: AbortSignal[] = [];
  mount((_target, signal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise; });
  anchor.addEventListener('click', (event) => event.preventDefault());
  click(anchor);
  window.history.replaceState(null, '', destinationHref);
  const oldEntry = hashTransition(sourceHref, destinationHref);
  // Native popstate/current-URL observation can occur before its paired hash
  // event. It establishes that the first intent reached its destination.
  window.dispatchEvent(new dom!.window.Event('popstate'));
  window.history.replaceState(null, '', sourceHref);
  const oldDeparture = hashTransition(destinationHref, sourceHref);
  click(anchor);
  assert.deepEqual(signals.map((signal) => signal.aborted), [true, false]);
  window.history.replaceState(null, '', destinationHref);
  window.dispatchEvent(oldEntry);
  window.dispatchEvent(oldDeparture);
  assert.deepEqual(signals.map((signal) => signal.aborted), [true, false]);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), second.promise);
});

test('a queued destination-source-destination roundtrip without another capture invalidates the first navigation read', () => {
  const anchor = fixture();
  let readSignal: AbortSignal | undefined;
  mount((_target, signal) => { readSignal = signal; return new Promise(() => {}); });
  anchor.addEventListener('click', (event) => event.preventDefault());
  click(anchor);
  window.history.replaceState(null, '', destinationHref);
  const entry = hashTransition(sourceHref, destinationHref);
  window.history.replaceState(null, '', sourceHref);
  const departure = hashTransition(destinationHref, sourceHref);
  window.history.replaceState(null, '', destinationHref);
  const returned = hashTransition(sourceHref, destinationHref);
  window.dispatchEvent(entry);
  window.dispatchEvent(departure);
  window.dispatchEvent(returned);
  assert.equal(readSignal?.aborted, true);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), null);
});

test('resolved preparations are one-shot and are never returned for a later Directory visit', async () => {
  const pending = deferred<DirectoryPreparedSnapshot>();
  const { manager, navigate } = managerFixture(() => pending.promise);
  assert.equal(manager.start(target, new URL(sourceHref), new URL(destinationHref)), true);
  pending.resolve(prepared);
  await flush();
  navigate(destinationHref);
  assert.equal(manager.claim({ ...target, directoryId: '456' }, new AbortController().signal), null);
  assert.equal(manager.claim(target, new AbortController().signal), pending.promise);
  assert.equal(manager.claim(target, new AbortController().signal), null);
  navigate(sourceHref);
  navigate(destinationHref);
  assert.equal(manager.claim(target, new AbortController().signal), null);
});

test('source-to-target and paired route events survive; returning to source or departing invalidates the generation', () => {
  let readSignal: AbortSignal | undefined;
  const { manager, navigate } = managerFixture((_target, signal) => { readSignal = signal; return new Promise(() => {}); });
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  navigate(sourceHref);
  navigate(destinationHref);
  navigate(destinationHref);
  navigate(`${destinationHref}/`);
  assert.equal(readSignal?.aborted, false);
  navigate(sourceHref);
  assert.equal(readSignal?.aborted, true);
  navigate(destinationHref);
  assert.equal(manager.claim(target, new AbortController().signal), null);
  for (const changed of [destinationHref.replace('/app/student?', '/app/teacher?'), destinationHref.replace('svcid=edu', 'svcid=other'), destinationHref.replace('#directory/123', '#directory/456'), `${destinationHref}?new-filter=1`]) {
    navigate(sourceHref);
    manager.start(target, new URL(sourceHref), new URL(destinationHref));
    navigate(changed);
    assert.equal(readSignal?.aborted, true);
  }
});

test('a second intent replaces the first read and old completion cannot replace the new result', async () => {
  const first = deferred<DirectoryPreparedSnapshot>();
  const second = deferred<DirectoryPreparedSnapshot>();
  const signals: AbortSignal[] = [];
  const { manager, navigate } = managerFixture((_target, signal) => { signals.push(signal); return signals.length === 1 ? first.promise : second.promise; });
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  const secondTarget = { ...target, directoryId: '456' };
  const secondHref = destinationHref.replace('/123', '/456');
  manager.start(secondTarget, new URL(sourceHref), new URL(secondHref));
  assert.equal(signals[0]!.aborted, true);
  first.resolve(prepared);
  await flush();
  navigate(secondHref);
  assert.equal(manager.claim(target, new AbortController().signal), null);
  assert.equal(manager.claim(secondTarget, new AbortController().signal), second.promise);
  assert.equal(signals[1]!.aborted, false);
});

test('a coalesced click preserves the original generation timestamp captured before its reader begins', () => {
  let time = 10;
  let reads = 0;
  let readSignal: AbortSignal | undefined;
  const manager = createDirectoryLoadingManager((_target, signal) => {
    reads += 1;
    readSignal = signal;
    time = 50;
    return new Promise(() => {});
  }, () => new URL(sourceHref), () => time);
  cleanups.push(manager.dispose);
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  time = 70;
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  assert.equal(reads, 1);
  manager.updateRoute(new URL(destinationHref), 11);
  manager.updateRoute(new URL(sourceHref), 12);
  assert.equal(readSignal?.aborted, true);
});

test('consumer cancellation aborts the owned request and prevents another claim', () => {
  let readSignal: AbortSignal | undefined;
  const { manager, navigate } = managerFixture((_target, signal) => { readSignal = signal; return new Promise(() => {}); });
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  navigate(destinationHref);
  const consumer = new AbortController();
  assert.ok(manager.claim(target, consumer.signal));
  consumer.abort();
  assert.equal(readSignal?.aborted, true);
  assert.equal(manager.claim(target, new AbortController().signal), null);
});

test('disposing a claimed pending read aborts it and late completion cannot be claimed again', async () => {
  const pending = deferred<DirectoryPreparedSnapshot>();
  let readSignal: AbortSignal | undefined;
  const { manager, navigate } = managerFixture((_target, signal) => { readSignal = signal; return pending.promise; });
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  navigate(destinationHref);
  assert.equal(manager.claim(target, new AbortController().signal), pending.promise);
  manager.dispose();
  assert.equal(readSignal?.aborted, true);
  pending.resolve(prepared);
  await flush();
  assert.equal(manager.claim(target, new AbortController().signal), null);
});

test('timeout bounds pending, resolved-unclaimed, and claimed reads without restarting them', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let readSignal: AbortSignal | undefined;
  let calls = 0;
  let next: Promise<DirectoryPreparedSnapshot> = new Promise(() => {});
  const { manager, navigate } = managerFixture((_target, signal) => { calls += 1; readSignal = signal; return next; });
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  t.mock.timers.tick(DIRECTORY_READ_LIFETIME - 1);
  assert.equal(readSignal?.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(readSignal?.aborted, true);
  navigate(destinationHref);
  assert.equal(manager.claim(target, new AbortController().signal), null);
  navigate(sourceHref);
  next = Promise.resolve(prepared);
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  await flush();
  t.mock.timers.tick(DIRECTORY_READ_LIFETIME);
  assert.equal(readSignal?.aborted, true);
  navigate(destinationHref);
  assert.equal(manager.claim(target, new AbortController().signal), null);
  navigate(sourceHref);
  next = new Promise(() => {});
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  navigate(destinationHref);
  assert.ok(manager.claim(target, new AbortController().signal));
  t.mock.timers.tick(DIRECTORY_READ_LIFETIME);
  assert.equal(readSignal?.aborted, true);
  assert.equal(calls, 3);
  assert.equal(manager.claim(target, new AbortController().signal), null);
});

test('failed or synchronously throwing readers leave no preparation and do not leak an unhandled rejection', async () => {
  let calls = 0;
  const { manager, navigate } = managerFixture(() => {
    calls += 1;
    if (calls === 1) throw new Error('Synchronous read failure');
    return Promise.reject(new Error('Request failed'));
  });
  assert.equal(manager.start(target, new URL(sourceHref), new URL(destinationHref)), false);
  assert.equal(manager.start(target, new URL(sourceHref), new URL(destinationHref)), true);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  navigate(destinationHref);
  assert.equal(manager.claim(target, new AbortController().signal), null);
});

test('manager rejects invalid starts and already aborted consumers; disposal is terminal', () => {
  let calls = 0;
  let readSignal: AbortSignal | undefined;
  const { manager, navigate } = managerFixture((_target, signal) => { calls += 1; readSignal = signal; return new Promise(() => {}); });
  for (const destination of [destinationHref.replace('https:', 'http:'), destinationHref.replace('example.myschoolapp.com', 'other.myschoolapp.com'), destinationHref.replace('svcid=edu', 'svcid=other'), destinationHref.replace('/app/student?', '/app/teacher?')]) {
    assert.equal(manager.start(target, new URL(sourceHref), new URL(destination)), false);
  }
  assert.equal(calls, 0);
  manager.start(target, new URL(sourceHref), new URL(destinationHref));
  navigate(destinationHref);
  const consumer = new AbortController();
  consumer.abort();
  assert.equal(manager.claim(target, consumer.signal), null);
  assert.equal(readSignal?.aborted, true);
  manager.dispose();
  navigate(sourceHref);
  assert.equal(manager.start(target, new URL(sourceHref), new URL(destinationHref)), false);
});

test('registry isolates documents and replacement registration cancels only the previous owner', () => {
  fixture();
  const otherDocument = document.implementation.createHTMLDocument('Other tab');
  let firstSignal: AbortSignal | undefined;
  let otherSignal: AbortSignal | undefined;
  const first = createDirectoryLoadingManager((_target, signal) => { firstSignal = signal; return new Promise(() => {}); });
  const other = createDirectoryLoadingManager((_target, signal) => { otherSignal = signal; return new Promise(() => {}); });
  cleanups.push(registerDirectoryLoadingManager(first));
  cleanups.push(registerDirectoryLoadingManager(other, otherDocument));
  first.start(target, new URL(sourceHref), new URL(destinationHref));
  other.start(target, new URL(sourceHref), new URL(destinationHref));
  const replacement = createDirectoryLoadingManager(() => new Promise(() => {}));
  cleanups.push(registerDirectoryLoadingManager(replacement));
  assert.equal(firstSignal?.aborted, true);
  assert.equal(otherSignal?.aborted, false);
  route(destinationHref);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), null);
});

test('document feature preserves an intent across unrelated settings/routes, while feature/master disable and pagehide cancel it', () => {
  const anchor = fixture();
  const signals: AbortSignal[] = [];
  const feature = createDirectoryLoadingFeature((_target, signal) => { signals.push(signal); return new Promise(() => {}); });
  const controller = new FeatureController([feature]);
  cleanups.push(() => controller.dispose());
  controller.update(new URL(sourceHref), DEFAULT_SETTINGS);
  click(anchor);
  controller.update(new URL(sourceHref), { ...DEFAULT_SETTINGS, helpfulTabTitles: false });
  assert.equal(signals[0]!.aborted, false);
  route(destinationHref, true);
  controller.update(new URL(destinationHref), DEFAULT_SETTINGS);
  assert.equal(signals[0]!.aborted, false);
  controller.update(new URL(destinationHref), { ...DEFAULT_SETTINGS, enhancedDirectory: false });
  assert.equal(signals[0]!.aborted, true);
  route(sourceHref);
  controller.update(new URL(sourceHref), DEFAULT_SETTINGS);
  click(anchor);
  controller.update(new URL(sourceHref), { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(signals[1]!.aborted, true);
  controller.update(new URL(sourceHref), DEFAULT_SETTINGS);
  click(anchor);
  window.dispatchEvent(new dom!.window.Event('pagehide'));
  assert.equal(signals[2]!.aborted, true);
  click(anchor);
  assert.equal(signals.length, 3);
  assert.equal(claimDirectoryPreparedSnapshot(target, new AbortController().signal), null);
});

test('native pushState departures are detected without patching history and cleanup removes capture', async () => {
  const anchor = fixture();
  let readSignal: AbortSignal | undefined;
  let reads = 0;
  const nativePushState = window.history.pushState;
  const { cleanup } = mount((_target, signal) => { reads += 1; readSignal = signal; return new Promise(() => {}); });
  // Avoid JSDOM's deferred default anchor navigation overwriting the native
  // pushState transition being exercised below.
  anchor.addEventListener('click', (event) => event.preventDefault(), { once: true });
  click(anchor);
  window.history.pushState(null, '', '#studentmyday/progress');
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  assert.equal(readSignal?.aborted, true);
  assert.equal(window.history.pushState, nativePushState);
  cleanup?.();
  route(sourceHref);
  click(anchor);
  assert.equal(reads, 1);
});

test('an already aborted mount attaches no capture or registry entry', () => {
  const anchor = fixture();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const feature = createDirectoryLoadingFeature(() => { calls += 1; return new Promise(() => {}); });
  assert.equal(feature.mount({ url: new URL(sourceHref), settings: DEFAULT_SETTINGS, signal: controller.signal }), undefined);
  click(anchor);
  assert.equal(calls, 0);
});
