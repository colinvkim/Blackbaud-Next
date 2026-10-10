import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { acquireDirectory, DirectoryUnsupportedError } from '../src/blackbaud/directory-bridge.ts';
import type { DirectoryLease } from '../src/blackbaud/directory-bridge.ts';
import { installDirectoryPageBridge } from '../src/blackbaud/directory-page.ts';
import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../src/blackbaud/directory-protocol.ts';
import { INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE } from '../src/blackbaud/directory-independent-protocol.ts';
import { normalizeDirectorySnapshot } from '../src/blackbaud/directory.ts';
import type { DirectorySnapshot } from '../src/blackbaud/directory.ts';
import { createEnhancedDirectoryFeature, DIRECTORY_PAGE_SIZE, DIRECTORY_REQUEST_TIMEOUT, DIRECTORY_SEARCH_DELAY, enhancedDirectoryFeature } from '../src/features/directory.ts';
import type { DirectoryFeatureDependencies } from '../src/features/directory.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Settings } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const sourceUrl = 'https://example.myschoolapp.com/app/student?svcid=edu#directory/123';
const photoBaseUrl = 'https://photos.myschoolcdn.com/ftpimages/100/user/';
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(name = 'Student Directory') {
  dom = new JSDOM(`<nav id="topnav-containter"><button>Directories</button><a href="#directory/456">Faculty</a></nav><main id="site-main"><div id="native-directory"><div id="overview"><h1>Student Directory</h1><p>Native introduction</p></div><div class="directory-header"><button>Native directory selector</button></div><aside>Native filters</aside><div id="directory-results"><p>Original native people</p></div></div></main>`, { url: sourceUrl, pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: win, document: win.document, MutationObserver: win.MutationObserver, CustomEvent: win.CustomEvent })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  document.querySelector('#overview h1')!.textContent = name;
  return document.getElementById('native-directory')!;
}

function snapshot(count = 3): DirectorySnapshot {
  const records = Array.from({ length: count }, (_, index) => ({
    UserID: index + 1, FirstName: `Student ${String(index + 1).padStart(3, '0')}`, LastName: 'Example',
    UserNameFormatted: `Student ${String(index + 1).padStart(3, '0')} Example`, Nickname: index === 0 ? 'Sunny' : '',
    GradeDisplay: index % 2 ? '10' : '9', PublishUserProfile: true, PublishEmail: index === 0, EmailBad: false,
    Email: index === 0 ? 'student@example.test' : '', LargeFileName: index === 0 ? 'large_user_sample.jpg' : '', TotalCount: count,
  }));
  return normalizeDirectorySnapshot(records, sourceUrl, photoBaseUrl);
}

function partialSnapshot(count = 3): DirectorySnapshot {
  return { ...snapshot(count), complete: false, reportedTotalCount: 1268 };
}

function remoteSnapshot(count = 2): DirectorySnapshot {
  const data = snapshot(count);
  return { ...data, entries: data.entries.map((person) => ({ ...person, firstName: 'Remote', lastName: `Person ${person.userId}`, nickname: '', displayName: `Remote Person ${person.userId}` })) };
}

function lease(root: HTMLElement, data = snapshot(), name = 'Student Directory') {
  const controller = new AbortController();
  let releases = 0;
  let released = false;
  const result: DirectoryLease = {
    root, name, snapshot: data, photoBaseUrl,
    signal: controller.signal,
    release: () => {
      if (released) return;
      released = true;
      releases += 1;
      root.removeAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
      for (const ui of root.querySelectorAll(`[${DIRECTORY_UI_ATTRIBUTE}]`)) ui.remove();
    },
  };
  return { value: result, controller, releases: () => releases };
}

function mount(dependencies: Partial<DirectoryFeatureDependencies>, settings: Settings = DEFAULT_SETTINGS) {
  const controller = new AbortController();
  const feature = createEnhancedDirectoryFeature(dependencies);
  const cleanup = feature.mount({ url: new URL(window.location.href), settings, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  return { controller, cleanup, feature };
}

function field<T extends HTMLInputElement | HTMLSelectElement>(text: string): T {
  const label = [...document.querySelectorAll('.bn-directory-field')].find((candidate) => candidate.firstElementChild?.textContent === text);
  assert.ok(label, `Missing ${text} field`);
  return label.querySelector<T>('input,select')!;
}

function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll<HTMLButtonElement>('[data-blackbaud-next-directory-ui] button')].find((candidate) => candidate.textContent === text);
  assert.ok(result, `Missing ${text} button`);
  return result;
}

function input(value: string) {
  const search = field<HTMLInputElement>('Search people');
  search.value = value;
  search.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
}

function select(label: string, value: string) {
  const control = field<HTMLSelectElement>(label);
  control.value = value;
  control.dispatchEvent(new dom!.window.Event('change', { bubbles: true }));
}

function rows(): HTMLElement[] { return [...document.querySelectorAll<HTMLElement>('.bn-directory-row')]; }
function feedback(): string { return document.querySelector('.bn-directory-feedback')?.textContent ?? ''; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('independent loading keeps one original action and choosing it cancels enhancement without a failure notice', async () => {
  const root = fixture();
  root.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, '123');
  const pending = document.createElement('div');
  pending.setAttribute(INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, '');
  const original = document.createElement('button');
  original.textContent = 'Use original directory';
  pending.append(original);
  root.append(pending);
  let readSignal: AbortSignal | undefined;
  let nativeCalls = 0;
  original.addEventListener('click', () => { nativeCalls += 1; });
  const ready = deferred<DirectoryLease>();
  mount({ acquireDirectory: async (_target, signal) => { readSignal = signal; return ready.promise; } });
  assert.equal([...document.querySelectorAll('button')].filter((button) => button.textContent === 'Use original directory').length, 1);
  assert.equal(document.querySelector('.bn-directory-notice'), null);
  original.click();
  assert.equal(readSignal?.aborted, true);
  assert.equal(nativeCalls, 1);
  const late = lease(root);
  ready.resolve(late.value);
  await flush();
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.equal(late.releases(), 1);
  assert.match(document.querySelector('.bn-directory-notice')?.textContent ?? '', /Using the original Blackbaud directory/);
  assert.doesNotMatch(document.querySelector('.bn-directory-notice')?.textContent ?? '', /could not load/);
});

test('a delayed independent shell keeps one original action and its fallback cancels the pending enhancement', async () => {
  const root = fixture();
  const shell = root.cloneNode(true) as HTMLElement;
  shell.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, '123');
  const pending = document.createElement('div');
  pending.setAttribute(INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, '');
  const original = document.createElement('button');
  original.textContent = 'Use original directory';
  pending.append(original);
  shell.append(pending);
  let readSignal: AbortSignal | undefined;
  let nativeCalls = 0;
  original.addEventListener('click', () => { nativeCalls += 1; });
  const ready = deferred<DirectoryLease>();
  mount({ acquireDirectory: async (_target, signal) => { readSignal = signal; return ready.promise; } });
  assert.match(document.querySelector('.bn-directory-notice')?.textContent ?? '', /Preparing/);
  document.getElementById('site-main')!.replaceChildren(shell);
  await flush();
  assert.equal(document.querySelector('.bn-directory-notice'), null);
  assert.equal([...document.querySelectorAll('button')].filter((button) => button.textContent === 'Use original directory').length, 1);
  original.click();
  assert.equal(readSignal?.aborted, true);
  assert.equal(nativeCalls, 1);
  assert.ok(button('Use enhanced directory'));
  ready.reject(new Error('The native directory resumed.'));
  await flush();
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.match(document.querySelector('.bn-directory-notice')?.textContent ?? '', /Using the original Blackbaud directory/);
  assert.doesNotMatch(document.querySelector('.bn-directory-notice')?.textContent ?? '', /could not load/);
});

test('independent loading listeners are detached when the route feature is disabled', async () => {
  const root = fixture();
  root.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, '123');
  const pending = document.createElement('div');
  pending.setAttribute(INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, '');
  const original = document.createElement('button');
  original.textContent = 'Use original directory';
  pending.append(original);
  root.append(pending);
  const ready = deferred<DirectoryLease>();
  const mounted = mount({ acquireDirectory: async () => ready.promise });
  mounted.controller.abort();
  original.click();
  assert.equal(document.querySelector('.bn-directory-notice'), null);
  const late = lease(root);
  ready.resolve(late.value);
  await flush();
  assert.equal(late.releases(), 1);
  assert.equal(document.querySelector('.bn-directory'), null);
});
async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('enhanced directory uses the setting and only reads the photo preference at mount', () => {
  assert.equal(enhancedDirectoryFeature.enabled(DEFAULT_SETTINGS), true);
  assert.equal(enhancedDirectoryFeature.enabled({ ...DEFAULT_SETTINGS, enhancedDirectory: false }), false);
  assert.deepEqual(enhancedDirectoryFeature.settingsKeys, ['downloadFullAvatar']);
  assert.equal(enhancedDirectoryFeature.matches(new URL(sourceUrl)), true);
  assert.equal(enhancedDirectoryFeature.matches(new URL(sourceUrl.replace('#directory/123', '#resourceboard'))), false);
});

test('native remains usable while acquiring, then its heading and introduction remain visible', async () => {
  const root = fixture();
  const currentLease = lease(root);
  const pending = deferred<DirectoryLease>();
  let acquireSignal: AbortSignal | undefined;
  const { controller } = mount({ acquireDirectory: async (_target, signal) => { acquireSignal = signal; return pending.promise; } });
  const results = document.getElementById('directory-results')!;
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.notEqual(window.getComputedStyle(results).display, 'none');
  assert.match(document.querySelector('.bn-directory-notice')!.textContent!, /Preparing/);
  assert.equal(rows().length, 0);
  pending.resolve(currentLease.value);
  await flush();
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), true);
  assert.equal(window.getComputedStyle(results).display, 'none');
  assert.notEqual(window.getComputedStyle(document.getElementById('overview')!).display, 'none');
  assert.equal(document.querySelector('#overview h1')!.textContent, 'Student Directory');
  assert.match(document.querySelector('#overview')!.textContent!, /Native introduction/);
  assert.equal(document.querySelector('.bn-directory')!.previousElementSibling!.id, 'overview');
  assert.equal(document.querySelector('.bn-directory-notice'), null);
  assert.equal(rows().length, 3);
  assert.equal(document.activeElement, document.body);
  controller.abort();
  assert.equal(acquireSignal?.aborted, false); // The lease owns the completed request; cleanup explicitly releases it.
  assert.equal(currentLease.releases(), 1);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
  assert.equal(document.querySelector('#blackbaud-next-directory'), null);
  assert.notEqual(window.getComputedStyle(results).display, 'none');
});

test('instant name and grade filtering, live grade counts, sorting, pagination and no results keep controls stable', async () => {
  const root = fixture();
  const data = snapshot(DIRECTORY_PAGE_SIZE + 13);
  data.entries[0]!.firstName = 'Zelda';
  data.entries[0]!.lastName = 'Alpha';
  data.entries[0]!.displayName = 'Zelda Alpha';
  const currentLease = lease(root, data);
  mount({ acquireDirectory: async () => currentLease.value });
  await flush();
  assert.equal(rows().length, DIRECTORY_PAGE_SIZE);
  assert.equal(rows()[0]!.querySelector('.bn-directory-name')!.textContent, 'Zelda Alpha');
  assert.equal(button('Previous').disabled, true);
  button('Next').click();
  assert.equal(rows().length, 13);
  assert.equal(button('Next').disabled, true);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /Showing 51–63 of 63/);
  select('Sort by', 'first');
  assert.equal(rows().length, DIRECTORY_PAGE_SIZE);
  assert.equal(rows()[0]!.querySelector('.bn-directory-name')!.textContent, 'Student 002 Example');
  const search = field<HTMLInputElement>('Search people');
  search.focus();
  input('sunny');
  assert.equal(field('Search people'), search);
  assert.equal(document.activeElement, search);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0]!.querySelector('.bn-directory-name')!.textContent, 'Zelda Alpha');
  const grades = field<HTMLSelectElement>('Grade');
  assert.deepEqual([...grades.options].map((item) => item.textContent), ['All grades', '9 (1)', '10 (0)']);
  select('Grade', '10');
  assert.equal(rows().length, 0);
  assert.equal(grades.value, '10');
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-empty')!.hidden, false);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /0 people match your filters/);
  input('no matching person');
  assert.equal(grades.value, '10');
  assert.equal(grades.options.length, 3);
  button('Clear filters').click();
  assert.equal(rows().length, DIRECTORY_PAGE_SIZE);
  assert.equal(search.value, '');
  assert.equal(grades.value, '');
  assert.equal(document.activeElement, search);
});

test('a faculty directory uses its native identity and generic people controls without an unpublished grade filter', async () => {
  const root = fixture('Faculty Directory');
  const data = normalizeDirectorySnapshot([
    { UserID: 1, FirstName: 'Grace', LastName: 'Example', UserNameFormatted: 'Grace Example', PublishUserProfile: true, PublishEmail: true, EmailBad: false, Email: 'grace@example.test', GradeDisplay: '', TotalCount: 2 },
    { UserID: 2, FirstName: 'Hidden', LastName: 'Person', UserNameFormatted: 'Published Name', PublishUserProfile: false, PublishEmail: true, GradeDisplay: '12', TotalCount: 0 },
  ], sourceUrl);
  const currentLease = lease(root, data, 'Faculty Directory');
  mount({ acquireDirectory: async () => currentLease.value });
  await flush();
  assert.equal(document.querySelector('#overview h1')!.textContent, 'Faculty Directory');
  assert.match(document.querySelector('#overview')!.textContent!, /Native introduction/);
  assert.equal(document.querySelector('.bn-directory')!.getAttribute('aria-label'), 'Faculty Directory');
  assert.equal(document.querySelector('.bn-directory h2')!.textContent, 'Browse people');
  const grade = field<HTMLSelectElement>('Grade');
  assert.equal(grade.disabled, true);
  assert.equal(grade.parentElement!.hidden, true);
  assert.equal(window.getComputedStyle(grade.parentElement!).display, 'none');
  assert.deepEqual([...document.querySelectorAll<HTMLElement>('.bn-directory-field')].filter((control) => !control.hidden).map((control) => control.firstElementChild!.textContent), ['Search people', 'Sort by']);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /Showing 1–2 of 2 people/);
  input('grace');
  assert.equal(rows().length, 1);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /of 1 person/);
  input('not listed');
  assert.equal(rows().length, 0);
  assert.equal(document.querySelector('.bn-directory-empty p')!.textContent, 'No people match these filters.');
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /0 people match/);
});

test('complete directory searches stay immediate and local without name requests', async () => {
  const root = fixture();
  let requests = 0;
  mount({ acquireDirectory: async () => lease(root).value, fetchDirectorySnapshot: async () => { requests += 1; throw new Error('Unexpected name read'); } });
  await flush();
  input('sunny');
  assert.equal(rows().length, 1);
  input('no matching name');
  assert.equal(rows().length, 0);
  input('');
  select('Grade', '10');
  select('Sort by', 'first');
  assert.equal(rows().length, 1);
  assert.equal(requests, 0);
  assert.equal(document.querySelector('.bn-directory')!.getAttribute('aria-busy'), null);
});

test('partial directories debounce names, abort earlier reads immediately, and keep server name semantics after complete search results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fixture('Parent Directory');
  const requests: { query: string; signal: AbortSignal; result: ReturnType<typeof deferred<DirectorySnapshot>> }[] = [];
  mount({ acquireDirectory: async () => lease(root, partialSnapshot(), 'Parent Directory').value, fetchDirectorySnapshot: async (_target, signal, _prefix, query = '') => {
    const result = deferred<DirectorySnapshot>();
    requests.push({ query, signal, result });
    return result.promise;
  } });
  await flush();
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /3 available people/);
  assert.doesNotMatch(document.querySelector('.bn-directory-count')!.textContent!, /1268/);
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-limit')!.hidden, false);
  input('a');
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-list')!.hidden, true);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /Searching/);
  t.mock.timers.tick(100);
  input('ab');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY - 1);
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(requests.map((request) => request.query), ['ab']);
  input('abc');
  assert.equal(requests[0]!.signal.aborted, true);
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[1]!.result.resolve(remoteSnapshot(2));
  await flush();
  assert.equal(rows().length, 2); // These backend matches contain none of the typed name tokens.
  assert.equal(rows()[0]!.querySelector('.bn-directory-name')!.textContent, 'Remote Person 1');
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-list')!.hidden, false);
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-limit')!.hidden, true);
  assert.equal(document.querySelector('.bn-directory')!.getAttribute('aria-busy'), 'false');
  requests[0]!.result.resolve(partialSnapshot(9));
  await flush();
  assert.equal(rows().length, 2);
  input('next');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  assert.deepEqual(requests.map((request) => request.query), ['ab', 'abc', 'next']);
});

test('server search failures retain explicit previous results, zero matches are accurate, and only a full blank refresh enables local search', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fixture('Alumni Directory');
  const requests: { query: string; result: ReturnType<typeof deferred<DirectorySnapshot>> }[] = [];
  mount({ acquireDirectory: async () => lease(root, partialSnapshot(), 'Alumni Directory').value, fetchDirectorySnapshot: async (_target, _signal, _prefix, query = '') => {
    const result = deferred<DirectorySnapshot>();
    requests.push({ query, result });
    return result.promise;
  } });
  await flush();
  input('failed name');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[0]!.result.reject(new Error('Network unavailable'));
  await flush();
  assert.equal(rows().length, 3);
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-list')!.hidden, false);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /^Previous results:/);
  assert.match(feedback(), /Could not search.*previous results/);
  assert.equal(field<HTMLInputElement>('Search people').value, 'failed name');
  assert.equal(button('Refresh').disabled, false);
  input('retry');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[1]!.result.resolve(remoteSnapshot(1));
  await flush();
  assert.equal(rows().length, 1);
  assert.equal(feedback(), '');
  input('no match');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[2]!.result.resolve(remoteSnapshot(0));
  await flush();
  assert.equal(rows().length, 0);
  assert.equal(document.querySelector('.bn-directory-empty p')!.textContent, 'No people match this search.');
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /0 people match/);
  assert.doesNotMatch(document.querySelector('.bn-directory-count')!.textContent!, /in this directory/);
  input('');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  assert.equal(requests[3]!.query, '');
  requests[3]!.result.resolve(snapshot(3));
  await flush();
  input('still remote');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  assert.equal(requests[4]!.query, 'still remote');
  requests[4]!.result.resolve(remoteSnapshot());
  await flush();
  input('');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[5]!.result.resolve(partialSnapshot());
  await flush();
  button('Refresh').click();
  assert.equal(requests[6]!.query, '');
  requests[6]!.result.resolve(snapshot(5));
  await flush();
  input('sunny');
  assert.equal(rows().length, 1);
  assert.equal(requests.length, 7);
});

test('server refresh uses the active name, preserves grade and sort, and new input cancels its stale response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fixture();
  const requests: { query: string; signal: AbortSignal; result: ReturnType<typeof deferred<DirectorySnapshot>> }[] = [];
  mount({ acquireDirectory: async () => lease(root, partialSnapshot()).value, fetchDirectorySnapshot: async (_target, signal, _prefix, query = '') => {
    const result = deferred<DirectorySnapshot>();
    requests.push({ query, signal, result });
    return result.promise;
  } });
  await flush();
  input('active name');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[0]!.result.resolve(remoteSnapshot(3));
  await flush();
  select('Grade', '10');
  select('Sort by', 'first');
  button('Refresh').click();
  assert.equal(requests[1]!.query, 'active name');
  requests[1]!.result.resolve(remoteSnapshot(4));
  await flush();
  assert.equal(field<HTMLSelectElement>('Grade').value, '10');
  assert.equal(field<HTMLSelectElement>('Sort by').value, 'first');
  assert.equal(rows().length, 2);
  button('Refresh').click();
  input('new name');
  assert.equal(requests[2]!.signal.aborted, true);
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  requests[2]!.result.resolve(remoteSnapshot(12));
  await flush();
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /Searching/);
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-list')!.hidden, true);
  requests[3]!.result.resolve(remoteSnapshot(2));
  await flush();
  assert.equal(rows().length, 1);
  assert.equal(field<HTMLInputElement>('Search people').value, 'new name');
  assert.equal(document.querySelector('.bn-directory')!.getAttribute('aria-busy'), 'false');
});

test('a stalled server read times out, restores usable previous results, and permits another query', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fixture();
  let requestSignal: AbortSignal | undefined;
  let reads = 0;
  mount({ acquireDirectory: async () => lease(root, partialSnapshot()).value, fetchDirectorySnapshot: async (_target, signal) => {
    reads += 1;
    if (reads > 1) return remoteSnapshot(1);
    requestSignal = signal;
    return new Promise<DirectorySnapshot>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await flush();
  input('stalled');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  t.mock.timers.tick(DIRECTORY_REQUEST_TIMEOUT - 1);
  assert.equal(requestSignal?.aborted, false);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(requestSignal?.aborted, true);
  assert.match(feedback(), /Could not search/);
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-list')!.hidden, false);
  assert.equal(button('Refresh').disabled, false);
  input('recovered');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  await flush();
  assert.equal(reads, 2);
  assert.equal(rows().length, 1);
  assert.equal(feedback(), '');
});

test('disabling or returning to native cancels debounce and owned server requests without late UI changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fixture();
  const result = deferred<DirectorySnapshot>();
  let reads = 0;
  let requestSignal: AbortSignal | undefined;
  const dependencies = { acquireDirectory: async () => lease(root, partialSnapshot()).value, fetchDirectorySnapshot: async (_target: unknown, signal: AbortSignal) => {
    reads += 1; requestSignal = signal; return result.promise;
  } };
  const first = mount(dependencies);
  await flush();
  input('before debounce');
  first.controller.abort();
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  assert.equal(reads, 0);
  const second = mount(dependencies);
  await flush();
  input('pending read');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  assert.equal(reads, 1);
  button('Use original directory').click();
  assert.equal(requestSignal?.aborted, true);
  result.resolve(remoteSnapshot(9));
  await flush();
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.ok(button('Use enhanced directory'));
  second.controller.abort();
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
});

test('search-first directories invite a name, never issue blank reads, and keep server mode after complete matches', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fixture('Search-first Directory');
  const currentLease = lease(root, snapshot(3), 'Search-first Directory');
  currentLease.value.searchOnly = true;
  const queries: string[] = [];
  let result = remoteSnapshot(1);
  mount({ acquireDirectory: async () => currentLease.value, fetchDirectorySnapshot: async (_target, _signal, _prefix, query = '') => { queries.push(query); return result; } });
  await flush();
  assert.equal(rows().length, 0);
  assert.equal(field<HTMLSelectElement>('Grade').parentElement!.hidden, true);
  assert.equal(document.querySelector('.bn-directory-empty p')!.textContent, 'Search by name to find people in this directory.');
  assert.equal(document.querySelector<HTMLElement>('.bn-directory-count')!.hidden, true);
  button('Refresh').click();
  assert.deepEqual(queries, []);
  input('name');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  await flush();
  assert.equal(rows().length, 1);
  input('');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  assert.equal(rows().length, 0);
  assert.deepEqual(queries, ['name']);
  assert.match(document.querySelector('.bn-directory-empty p')!.textContent!, /Search by name/);
  button('Refresh').click();
  input('different name');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  await flush();
  assert.deepEqual(queries, ['name', 'different name']);
  result = remoteSnapshot(0);
  input('no match');
  t.mock.timers.tick(DIRECTORY_SEARCH_DELAY);
  await flush();
  assert.equal(document.querySelector('.bn-directory-empty p')!.textContent, 'No people match this search.');
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /0 people match/);
});

test('published multi-grade faculty rows use grade membership rather than a single CSV option', async () => {
  const root = fixture('Faculty Directory');
  const data = normalizeDirectorySnapshot([{ UserID: 1, FirstName: 'Grace', LastName: 'Example', UserNameFormatted: 'Grace Example', PublishUserProfile: true, PublishEmail: false, GradeDisplay: '10, 11, 12, 9, 10', TotalCount: 1 }], sourceUrl);
  mount({ acquireDirectory: async () => lease(root, data, 'Faculty Directory').value });
  await flush();
  assert.equal(rows()[0]!.querySelector('.bn-directory-grade')!.textContent, 'Grades 9, 10, 11, 12');
  assert.deepEqual([...field<HTMLSelectElement>('Grade').options].map((item) => item.textContent), ['All grades', '9 (1)', '10 (1)', '11 (1)', '12 (1)']);
  select('Grade', '11');
  assert.equal(rows().length, 1);
});

test('refresh adds and removes available grade controls while preserving search and sort and clearing a vanished grade', async () => {
  const root = fixture('Staff Directory');
  const withGrades = snapshot(DIRECTORY_PAGE_SIZE + 13);
  const withoutGrades: DirectorySnapshot = { ...withGrades, entries: withGrades.entries.map((person) => ({ ...person, grade: '' })) };
  const currentLease = lease(root, withoutGrades, 'Staff Directory');
  let updated = withGrades;
  mount({ acquireDirectory: async () => currentLease.value, fetchDirectorySnapshot: async () => updated });
  await flush();
  const search = field<HTMLInputElement>('Search people');
  const order = field<HTMLSelectElement>('Sort by');
  const grade = field<HTMLSelectElement>('Grade');
  assert.equal(grade.parentElement!.hidden, true);
  input('Student');
  select('Sort by', 'first');
  button('Next').click();
  assert.equal(rows().length, 13);
  button('Refresh').click();
  await flush();
  assert.equal(grade.parentElement!.hidden, false);
  assert.equal(grade.disabled, false);
  assert.equal(field('Search people'), search);
  assert.equal(field('Sort by'), order);
  assert.equal(field('Grade'), grade);
  assert.equal(search.value, 'Student');
  assert.equal(order.value, 'first');
  assert.equal(rows().length, 13);
  select('Grade', '10');
  assert.equal(rows().length, 31);
  grade.focus();
  updated = withoutGrades;
  button('Refresh').click();
  await flush();
  assert.equal(grade.parentElement!.hidden, true);
  assert.equal(grade.disabled, true);
  assert.equal(grade.value, '');
  assert.equal(document.activeElement, search);
  assert.equal(search.value, 'Student');
  assert.equal(order.value, 'first');
  assert.equal(rows().length, DIRECTORY_PAGE_SIZE);
  assert.match(document.querySelector('.bn-directory-count')!.textContent!, /Showing 1–50 of 63 people/);
  updated = { ...withGrades, entries: withGrades.entries.map((person) => ({ ...person, grade: '7' })) };
  button('Refresh').click();
  await flush();
  assert.equal(grade.parentElement!.hidden, false);
  assert.equal(grade.disabled, false);
  assert.equal(grade.value, '');
  assert.deepEqual([...grade.options].map((item) => item.textContent), ['All grades', '7 (63)']);
});

test('only published profile fields create links, photos and email actions; failed photos fall back to initials', async () => {
  const root = fixture();
  const data = normalizeDirectorySnapshot([
    { UserID: 1, FirstName: 'Alex', LastName: 'Example', UserNameFormatted: 'Alex Example', PublishUserProfile: true, PublishEmail: true, EmailBad: false, Email: 'alex+school@example.test', GradeDisplay: '9', LargeFileName: 'large_user_alex.jpg', TotalCount: 2 },
    { UserID: 2, FirstName: 'Private', LastName: 'Person', UserNameFormatted: 'Student Only', Nickname: 'Hidden Name', PublishUserProfile: false, PublishEmail: true, EmailBad: false, Email: 'unpublished@example.test', GradeDisplay: '12', LargeFileName: 'large_user_hidden.jpg', TotalCount: 2 },
  ], sourceUrl, photoBaseUrl);
  const currentLease = lease(root, data);
  mount({ acquireDirectory: async () => currentLease.value });
  await flush();
  const publicRow = document.querySelector('[data-bn-directory-user="1"]')!;
  assert.equal(publicRow.querySelector('.bn-directory-name')!.getAttribute('href'), '#profile/1/contactcard');
  assert.equal(publicRow.querySelector('.bn-directory-email a')!.getAttribute('href'), 'mailto:alex%2Bschool@example.test');
  const fullPhoto = publicRow.querySelector<HTMLAnchorElement>('.bn-directory-avatar')!;
  assert.equal(fullPhoto.getAttribute('target'), '_blank');
  assert.equal(fullPhoto.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(fullPhoto.href, `${photoBaseUrl}large_user_alex.jpg`);
  const image = publicRow.querySelector('img')!;
  assert.equal(image.loading, 'lazy');
  assert.equal(image.decoding, 'async');
  assert.equal(image.width, 48);
  assert.equal(image.height, 48);
  assert.match(image.src, /resize=96(?:%2C|,)96/);
  image.dispatchEvent(new dom!.window.Event('error'));
  assert.equal(publicRow.querySelector('img'), null);
  assert.equal(publicRow.querySelector('.bn-directory-initials')!.textContent, 'AE');
  const protectedRow = document.querySelector('[data-bn-directory-user="2"]')!;
  assert.equal(protectedRow.querySelectorAll('a,button,img').length, 0);
  assert.equal(protectedRow.querySelector('.bn-directory-grade'), null);
  assert.equal(protectedRow.querySelector('.bn-directory-name')!.textContent, 'Student Only');
  assert.doesNotMatch(document.querySelector('.bn-directory')!.textContent!, /unpublished|Hidden Name|Private|Person/);
  input('Hidden Name');
  assert.equal(rows().length, 0);
});

test('photo preference retains thumbnails while removing the full-size action', async () => {
  const root = fixture();
  const currentLease = lease(root);
  mount({ acquireDirectory: async () => currentLease.value }, { ...DEFAULT_SETTINGS, downloadFullAvatar: false });
  await flush();
  assert.ok(document.querySelector('.bn-directory-avatar img'));
  assert.equal(document.querySelector('a.bn-directory-avatar'), null);
});

test('email copy reports success and failure and ignores completion for replaced results', async () => {
  const root = fixture();
  const currentLease = lease(root);
  const pending = deferred<void>();
  const copied: string[] = [];
  let copyResult: Promise<void> = Promise.resolve();
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: (value: string) => { copied.push(value); return copyResult; } } });
  mount({ acquireDirectory: async () => currentLease.value });
  await flush();
  button('Copy').click();
  await flush();
  assert.deepEqual(copied, ['student@example.test']);
  assert.match(feedback(), /Copied email/);
  copyResult = Promise.reject(new Error('Clipboard unavailable'));
  button('Copy').click();
  await flush();
  assert.match(feedback(), /Could not copy/);
  copyResult = pending.promise;
  button('Copy').click();
  input('Student 002');
  const before = feedback();
  pending.resolve();
  await flush();
  assert.equal(feedback(), before);
});

test('refresh preserves old results on failure, cancels requests, and ignores stale responses', async () => {
  const root = fixture();
  const currentLease = lease(root);
  const requests: { pending: ReturnType<typeof deferred<DirectorySnapshot>>; signal: AbortSignal }[] = [];
  mount({
    acquireDirectory: async () => currentLease.value,
    fetchDirectorySnapshot: async (target, signal, prefix) => {
      assert.equal(target.directoryId, '123');
      assert.equal(prefix, photoBaseUrl);
      const pending = deferred<DirectorySnapshot>();
      requests.push({ pending, signal });
      return pending.promise;
    },
  });
  await flush();
  button('Refresh').click();
  assert.equal(rows().length, 3);
  assert.equal(button('Refresh').disabled, true);
  requests[0]!.pending.reject(new Error('Incomplete response'));
  await flush();
  assert.equal(rows().length, 3);
  assert.match(feedback(), /previous directory results/);
  assert.equal(button('Refresh').disabled, false);
  button('Refresh').click();
  button('Cancel refresh').click();
  assert.equal(requests[1]!.signal.aborted, true);
  button('Refresh').click();
  requests[2]!.pending.resolve(snapshot(4));
  await flush();
  assert.equal(rows().length, 4);
  assert.equal(feedback(), 'Directory refreshed.');
  requests[1]!.pending.resolve(snapshot(9));
  await flush();
  assert.equal(rows().length, 4);
  assert.equal(feedback(), 'Directory refreshed.');
  input('Student 004');
  select('Grade', '10');
  button('Refresh').click();
  requests[3]!.pending.resolve(snapshot(2));
  await flush();
  assert.equal(field<HTMLInputElement>('Search people').value, 'Student 004');
  assert.equal(field<HTMLSelectElement>('Grade').value, '10');
  assert.equal(rows().length, 0);
});

test('returning to native restores the page, cancels refresh, and permits a fresh lease', async () => {
  const root = fixture();
  const leases: ReturnType<typeof lease>[] = [];
  const pending = deferred<DirectorySnapshot>();
  let refreshSignal: AbortSignal | undefined;
  mount({
    acquireDirectory: async () => { const next = lease(root); leases.push(next); return next.value; },
    fetchDirectorySnapshot: async (_target, signal) => { refreshSignal = signal; return pending.promise; },
  });
  await flush();
  button('Refresh').click();
  button('Use original directory').click();
  assert.equal(refreshSignal?.aborted, true);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.equal(leases[0]!.releases(), 1);
  assert.match(document.querySelector('.bn-directory-notice')!.textContent!, /full search, filters, and contact details/);
  pending.resolve(snapshot(8));
  await flush();
  assert.equal(document.querySelector('.bn-directory'), null);
  button('Use enhanced directory').click();
  await flush();
  assert.equal(leases.length, 2);
  assert.equal(rows().length, 3);
  assert.equal(document.activeElement, field('Search people'));
});

test('asynchronous native root replacement retains the enhanced switch and permits a fresh lease', async () => {
  const root = fixture();
  const nativeRoot = root.cloneNode(true) as HTMLElement;
  root.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, '123');
  const main = document.getElementById('site-main')!;
  const nativeRead = deferred<void>();
  const replacement = nativeRead.promise.then(() => main.replaceChildren(nativeRoot));
  const firstLease = lease(root);
  let acquisitions = 0;
  mount({ acquireDirectory: async () => {
    acquisitions += 1;
    return acquisitions === 1 ? firstLease.value : lease(nativeRoot).value;
  } });
  await flush();
  button('Use original directory').click();
  const switchControl = button('Use enhanced directory');
  const notice = switchControl.closest('.bn-directory-notice');
  assert.ok(notice);
  assert.equal(firstLease.releases(), 1);
  assert.equal(document.querySelector('.bn-directory'), null);
  nativeRead.resolve();
  await replacement;
  await flush();
  assert.equal(root.isConnected, false);
  assert.equal(nativeRoot.querySelector('#overview > .bn-directory-notice'), notice);
  assert.equal(button('Use enhanced directory'), switchControl);
  switchControl.click();
  await flush();
  assert.equal(acquisitions, 2);
  assert.equal(nativeRoot.querySelectorAll('.bn-directory-row').length, 3);
  assert.equal(document.querySelector('.bn-directory-notice'), null);
});

test('fallback notice observation disconnects on cleanup and cannot recreate UI after native replacement', async (t) => {
  const root = fixture();
  const nativeRoot = root.cloneNode(true) as HTMLElement;
  const main = document.getElementById('site-main')!;
  const disconnect = window.MutationObserver.prototype.disconnect;
  let disconnections = 0;
  t.mock.method(window.MutationObserver.prototype, 'disconnect', function (this: MutationObserver) {
    disconnections += 1;
    disconnect.call(this);
  });
  let acquisitions = 0;
  const mounted = mount({ acquireDirectory: async () => { acquisitions += 1; return lease(root).value; } });
  await flush();
  button('Use original directory').click();
  const oldSwitch = button('Use enhanced directory');
  const beforeCleanup = disconnections;
  mounted.controller.abort();
  assert.ok(disconnections > beforeCleanup);
  main.replaceChildren(nativeRoot);
  await flush();
  oldSwitch.click();
  await flush();
  assert.equal(acquisitions, 1);
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
  assert.equal(document.querySelector('#blackbaud-next-directory'), null);
});

test('intentionally unsupported directories quietly keep the original native view without a retry notice', async () => {
  const root = fixture();
  const nativeHtml = root.outerHTML;
  mount({ acquireDirectory: async () => { throw new DirectoryUnsupportedError(); } });
  await flush();
  assert.equal(root.outerHTML, nativeHtml);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
  assert.notEqual(window.getComputedStyle(document.getElementById('directory-results')!).display, 'none');
});

test('failed acquisition and cancellation keep native visible, retry works, and late leases are released', async () => {
  const root = fixture();
  let attempt = 0;
  const pending = deferred<DirectoryLease>();
  let signal: AbortSignal | undefined;
  mount({ acquireDirectory: async (_target, requestSignal) => {
    attempt += 1;
    if (attempt === 1) throw new Error('Unsupported directory');
    signal = requestSignal;
    return pending.promise;
  } });
  await flush();
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.match(document.querySelector('.bn-directory-notice')!.textContent!, /original Blackbaud view/);
  button('Try again').click();
  button('Use original directory').click();
  assert.equal(signal?.aborted, true);
  const late = lease(root);
  pending.resolve(late.value);
  await flush();
  assert.equal(late.releases(), 1);
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.ok(button('Use enhanced directory'));
});

test('the enhanced view has no redundant directory selector and keeps the global native directories menu usable', async () => {
  const root = fixture();
  const currentLease = lease(root);
  mount({ acquireDirectory: async () => currentLease.value });
  await flush();
  const controls = [...document.querySelectorAll('.bn-directory-field > span')].map((control) => control.textContent);
  assert.deepEqual(controls, ['Search people', 'Grade', 'Sort by']);
  const nativeNavigation = document.getElementById('topnav-containter')!;
  assert.notEqual(window.getComputedStyle(nativeNavigation).display, 'none');
  assert.equal(nativeNavigation.querySelector('button')!.textContent, 'Directories');
  assert.equal(nativeNavigation.querySelector('a')!.getAttribute('href'), '#directory/456');
  assert.equal(currentLease.releases(), 0);
});

test('global native directory navigation releases the enhanced view without replaying obsolete native work', async (t) => {
  const root = fixture();
  const records = [{ UserID: 1, FirstName: 'Ada', LastName: 'Example', UserNameFormatted: 'Ada Example', PublishUserProfile: true, PublishEmail: false, TotalCount: 1 }];
  const requests: string[] = [];
  let renders = 0;
  const getResults = () => {};
  const getFacetValues = () => { void fetch('/api/directory/directoryfacetvaluesget?directoryId=123'); };
  const renderResults = () => { renders += 1; };
  const view = {
    el: root, template: 'directory/directory.template.html',
    model: { get: (key: string) => key === 'DirectoryName' ? 'Students' : key === 'DefaultResults' ? true : key === 'DirectoryId' ? 123 : undefined },
    results: { length: records.length, toJSON: () => records },
    facets: { length: 1, toJSON: () => [{ FieldName: 'student_grade' }] },
    getResults, getFacetValues, renderResults,
  };
  Object.defineProperty(window, 'p3', { configurable: true, value: {
    _currentMainView: view,
    _modules: { 'shared/directory': { Data: { directoryId: 123, searchVal: '', searchFacets: [], searchAllFields: false } } },
    Data: { Context: { get: () => [{ DirectoryID: 123, DirectoryName: 'Students' }, { DirectoryID: 456, DirectoryName: 'Faculty' }] } },
  } });
  cleanups.push(installDirectoryPageBridge(window as unknown as Window & typeof globalThis));
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    requests.push(String(path));
    return new Response(JSON.stringify(String(path).includes('directoryresultsget') ? records : []));
  });
  let releaseHash = '';
  const { controller } = mount({ acquireDirectory: async (target, signal) => {
    const acquired = await acquireDirectory(target, signal);
    return { ...acquired, release: () => { releaseHash = window.location.hash; acquired.release(); } };
  } });
  await flush();
  await flush();
  assert.equal(rows().length, 1);
  view.renderResults();
  view.getFacetValues();
  assert.equal(renders, 0);
  assert.deepEqual(requests, ['/api/directory/directoryresultsget?directoryId=123&searchVal=&facets=&searchAll=false']);
  const changed = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
  document.querySelector<HTMLAnchorElement>('#topnav-containter a')!.click();
  await changed;
  controller.abort();
  assert.deepEqual({ releaseHash, renders, requests }, {
    releaseHash: '#directory/456', renders: 0,
    requests: ['/api/directory/directoryresultsget?directoryId=123&searchVal=&facets=&searchAll=false'],
  });
  assert.equal(view.getResults, getResults);
  assert.equal(view.getFacetValues, getFacetValues);
  assert.equal(view.renderResults, renderResults);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelector('.bn-directory'), null);
});

test('unexpected native release removes the enhanced UI, aborts refresh and offers a native retry', async () => {
  const root = fixture();
  const currentLease = lease(root);
  let refreshSignal: AbortSignal | undefined;
  const pending = deferred<DirectorySnapshot>();
  mount({ acquireDirectory: async () => currentLease.value, fetchDirectorySnapshot: async (_target, signal) => { refreshSignal = signal; return pending.promise; } });
  await flush();
  button('Refresh').click();
  currentLease.controller.abort();
  // Model the page adapter's synchronous teardown after it emits released.
  currentLease.value.release();
  await flush();
  assert.equal(refreshSignal?.aborted, true);
  assert.equal(currentLease.releases(), 1);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelector('.bn-directory'), null);
  assert.ok(button('Try enhanced directory'));
  pending.resolve(snapshot(10));
  await flush();
  assert.equal(document.querySelector('.bn-directory'), null);
});

test('feature abort during acquisition or refresh leaves no owned UI and ignores later responses', async () => {
  const root = fixture();
  const pending = deferred<DirectoryLease>();
  let acquireSignal: AbortSignal | undefined;
  const { controller } = mount({ acquireDirectory: async (_target, signal) => { acquireSignal = signal; return pending.promise; } });
  controller.abort();
  assert.equal(acquireSignal?.aborted, true);
  const late = lease(root);
  pending.resolve(late.value);
  await flush();
  assert.equal(late.releases(), 1);
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
  assert.equal(document.querySelector('#blackbaud-next-directory'), null);
  const active = lease(root);
  const refresh = deferred<DirectorySnapshot>();
  let refreshSignal: AbortSignal | undefined;
  const next = mount({ acquireDirectory: async () => active.value, fetchDirectorySnapshot: async (_target, signal) => { refreshSignal = signal; return refresh.promise; } });
  await flush();
  button('Refresh').click();
  next.controller.abort();
  assert.equal(refreshSignal?.aborted, true);
  refresh.resolve(snapshot(20));
  await flush();
  assert.equal(active.releases(), 1);
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
  assert.equal(root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
});

test('an empty complete directory has a clear empty state and cleanup is idempotent', async () => {
  const root = fixture();
  const currentLease = lease(root, snapshot(0));
  const { cleanup } = mount({ acquireDirectory: async () => currentLease.value });
  await flush();
  assert.equal(rows().length, 0);
  assert.equal(document.querySelector('.bn-directory-empty p')!.textContent, 'No people are listed in this directory.');
  assert.equal(button('Previous').disabled, true);
  assert.equal(button('Next').disabled, true);
  assert.equal(button('Clear filters').hidden, true);
  cleanup?.();
  cleanup?.();
  assert.equal(currentLease.releases(), 1);
  assert.equal(document.querySelector(`[${DIRECTORY_UI_ATTRIBUTE}]`), null);
});
