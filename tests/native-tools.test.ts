import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { fullSizePhotoUrl, profilePhotoForOptions } from '../src/blackbaud/avatar.ts';
import { ROSTER_CACHE_LIFETIME, createRosterReader, fetchRoster, normalizeRoster, rosterTargetFromRequest, rosterTargetFromUrl, rosterValues } from '../src/blackbaud/roster.ts';
import { ASSIGNMENT_STALL_DELAY, assignmentRecoveryFeature, oldAssignmentCenterFeature, recoveryRemaining } from '../src/features/assignment-center.ts';
import { avatarDownloadFeature } from '../src/features/avatar-download.ts';
import { faviconFeature } from '../src/features/favicon.ts';
import { rosterToolsFeature } from '../src/features/roster-tools.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(html: string, path = '/app/student?svcid=edu#academicclass/123/roster') {
  dom = new JSDOM(html, { url: `https://example.myschoolapp.com${path}` });
  const main = dom.window.document.createElement('main');
  main.id = 'site-main';
  const view = dom.window.document.createElement('div');
  view.id = path.includes('#directory/') ? 'directory-results' : 'academicclassmaincontainer';
  view.append(...dom.window.document.body.childNodes);
  main.append(view);
  dom.window.document.body.append(main);
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    chrome: { storage: {}, runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } },
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return dom.window;
}

async function flush() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('roster identifiers require a semantic route or same-origin endpoint', () => {
  const route = (hash: string) => new URL(`https://example.myschoolapp.com/app/student#${hash}`);
  assert.deepEqual(rosterTargetFromUrl(route('academicclass/123/roster')), { kind: 'section', id: '123' });
  assert.deepEqual(rosterTargetFromUrl(route('athleticteam/456/roster')), { kind: 'team', id: '456' });
  assert.equal(rosterTargetFromUrl(route('directory/123')), null);
  assert.equal(rosterTargetFromUrl(route('studentmyday/progress/123')), null);
  assert.equal(rosterTargetFromUrl(route('academicclass/123other/roster')), null);
  assert.equal(rosterTargetFromRequest('https://foreign.example/api/datadirect/sectionrosterget/123/', route('').origin), null);
  assert.deepEqual(rosterTargetFromRequest('/api/datadirect/athleticrosterget/?teamId=456', route('').origin), { kind: 'team', id: '456' });
});

test('roster validation drops malformed fields and deduplicates safe email addresses', () => {
  assert.throws(() => normalizeRoster({ data: [] }), /unsupported format/);
  const entries = normalizeRoster([
    { firstName: 'Ada', lastName: 'Example', email: 'ADA@example.org' },
    { name: 'Ada Example', email: 'ada@example.org' },
    { formatted_name: 'Grace Example', email: 'not an address' },
    { name: {}, email: 123 }, null, 'bad',
  ]);
  assert.deepEqual(rosterValues(entries, 'name'), ['Ada Example', 'Ada Example', 'Grace Example']);
  assert.deepEqual(rosterValues(entries, 'email'), ['ADA@example.org']);
  assert.equal('raw' in (entries[0] ?? {}), false);
});

test('copying roster names preserves distinct students who share a display name', () => {
  const entries = normalizeRoster([
    { name: 'Alex Smith', email: 'alex.one@example.org' },
    { name: 'Alex Smith', email: 'alex.two@example.org' },
    { name: 'ALEX SMITH', email: 'alex.three@example.org' },
  ]);
  assert.deepEqual(rosterValues(entries, 'name'), ['Alex Smith', 'Alex Smith', 'ALEX SMITH']);
  assert.equal(rosterValues(entries, 'email').length, 3);
});

test('roster fetch validates identifiers and forwards cancellation', async (t) => {
  const controller = new AbortController();
  let requested: unknown;
  let options: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, init?: RequestInit) => {
    requested = path;
    options = init;
    return new Response(JSON.stringify([{ name: 'Ada Example' }]), { status: 200 });
  });
  assert.deepEqual(await fetchRoster({ kind: 'section', id: '123' }, controller.signal), [{ name: 'Ada Example', email: '' }]);
  assert.equal(requested, '/api/datadirect/sectionrosterget/123/?format=json');
  assert.equal(options?.signal, controller.signal);
  assert.equal(options?.credentials, 'same-origin');
  await assert.rejects(fetchRoster({ kind: 'section', id: '123/foreign' }, controller.signal), /invalid/);
});

test('roster reads share one in-flight result and expire without crossing identities', async (t) => {
  let time = 0;
  let requests = 0;
  let resolveRequest: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    if (requests === 1) return new Promise<Response>((resolve) => { resolveRequest = resolve; });
    return new Response(JSON.stringify([{ name: `Person ${requests}` }]));
  });
  const reader = createRosterReader(() => time);
  cleanups.push(reader.clear);
  const target = { kind: 'section', id: '123' } as const;
  const first = reader.read(target, 'course:fall');
  assert.equal(reader.read(target, 'course:fall'), first);
  assert.equal(requests, 1);
  resolveRequest?.(new Response(JSON.stringify([{ name: 'Fall Person', email: 'fall@example.org' }])));
  assert.deepEqual(await first, [{ name: 'Fall Person', email: 'fall@example.org' }]);
  time = ROSTER_CACHE_LIFETIME - 1;
  assert.equal(reader.read(target, 'course:fall'), first);
  time = ROSTER_CACHE_LIFETIME;
  await reader.read(target, 'course:fall');
  assert.equal(requests, 2);
  await reader.read(target, 'course:spring');
  assert.equal(requests, 3);
  await reader.read({ kind: 'team', id: '123' }, 'course:spring');
  assert.equal(requests, 4);
});

test('failed or canceled roster reads cannot poison a replacement read', async (t) => {
  let requests = 0;
  let firstSignal: AbortSignal | null | undefined;
  let resolveOld: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (_path: RequestInfo | URL, options?: RequestInit) => {
    requests += 1;
    if (requests === 1) return new Response('Unavailable', { status: 503 });
    if (requests === 2) {
      firstSignal = options?.signal;
      return new Promise<Response>((resolve) => { resolveOld = resolve; });
    }
    return new Response(JSON.stringify([{ name: 'Current Person' }]));
  });
  const reader = createRosterReader();
  cleanups.push(reader.clear);
  const target = { kind: 'section', id: '123' } as const;
  await assert.rejects(reader.read(target, 'fall'), /503/);
  const old = reader.read(target, 'fall');
  const canceled = assert.rejects(old, { name: 'AbortError' });
  reader.clear();
  assert.equal(firstSignal?.aborted, true);
  const current = reader.read(target, 'spring');
  resolveOld?.(new Response(JSON.stringify([{ name: 'Stale Person' }])));
  await canceled;
  assert.deepEqual(await current, [{ name: 'Current Person', email: '' }]);
  assert.equal(reader.read(target, 'spring'), current);
  assert.equal(requests, 3);
});

test('copying names then emails reuses the current roster and changing terms discards it', async (t) => {
  const win = fixture('<select id="roster-term-picker"><option value="123">Fall</option><option value="456">Spring</option></select>');
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    requested.push(String(path));
    return new Response(JSON.stringify([{ name: 'Example Person', email: 'person@example.org' }]));
  });
  const copied: string[] = [];
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const [names, emails] = [...win.document.querySelectorAll<HTMLButtonElement>('.bn-tools button')];
  names!.click();
  await flush();
  emails!.click();
  await flush();
  assert.deepEqual(copied, ['Example Person', 'person@example.org']);
  assert.equal(requested.length, 1);
  const picker = win.document.querySelector<HTMLSelectElement>('#roster-term-picker')!;
  picker.value = '456';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  names!.click();
  await flush();
  picker.value = '123';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  emails!.click();
  await flush();
  assert.deepEqual(requested, [
    '/api/datadirect/sectionrosterget/123/?format=json',
    '/api/datadirect/sectionrosterget/456/?format=json',
    '/api/datadirect/sectionrosterget/123/?format=json',
  ]);
});

test('roster copy retries a failed read and discards data when the native view is replaced', async (t) => {
  const win = fixture('<select id="roster-term-picker"><option value="123">Fall</option></select>');
  let requests = 0;
  let pendingSignal: AbortSignal | null | undefined;
  let resolvePending: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (_path: RequestInfo | URL, options?: RequestInit) => {
    requests += 1;
    if (requests === 1) return new Response('Unavailable', { status: 503 });
    if (requests === 2) {
      pendingSignal = options?.signal;
      return new Promise<Response>((resolve) => { resolvePending = resolve; });
    }
    return new Response(JSON.stringify([{ name: 'Replacement Person' }]));
  });
  const copied: string[] = [];
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const button = win.document.querySelector<HTMLButtonElement>('.bn-tools button')!;
  button.click();
  await flush();
  assert.equal(button.disabled, false);
  assert.match(win.document.querySelector('.bn-tool-status')!.textContent ?? '', /503/);
  button.click();
  win.document.querySelector('#academicclassmaincontainer')!.outerHTML = '<div id="academicclassmaincontainer"><select id="roster-term-picker"><option value="123">Fall</option></select></div>';
  await flush();
  assert.equal(pendingSignal?.aborted, true);
  resolvePending?.(new Response(JSON.stringify([{ name: 'Removed Person' }])));
  await flush();
  assert.deepEqual(copied, []);
  const replacement = win.document.querySelector<HTMLButtonElement>('.bn-tools button')!;
  replacement.click();
  await flush();
  assert.deepEqual(copied, ['Replacement Person']);
  assert.equal(requests, 3);
  controller.abort();
  assert.equal(win.document.querySelector('.bn-tools'), null);
});

test('term changes abort copy requests and refuse stale roster identifiers', async (t) => {
  const win = fixture('<select id="roster-term-picker"><option value="fall">Fall</option><option value="spring">Spring</option></select>');
  let requests = 0;
  let requestSignal: AbortSignal | null | undefined;
  let resolveRequest: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (_path: RequestInfo | URL, options?: RequestInit) => {
    requests += 1;
    requestSignal = options?.signal;
    return new Promise<Response>((resolve) => { resolveRequest = resolve; });
  });
  let copied = false;
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async () => { copied = true; } } });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const picker = win.document.querySelector<HTMLSelectElement>('#roster-term-picker')!;
  const button = win.document.querySelector<HTMLButtonElement>('.bn-tools button')!;
  button.click();
  assert.equal(requests, 1);
  picker.value = 'spring';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(requestSignal?.aborted, true);
  resolveRequest?.(new Response(JSON.stringify([{ name: 'Old Term Person' }]), { status: 200 }));
  await flush();
  assert.equal(copied, false);
  button.click();
  assert.equal(requests, 1);
  assert.match(win.document.querySelector('.bn-tool-status')!.textContent ?? '', /Roster unavailable/);
  controller.abort();
  assert.equal(win.document.querySelector('.bn-tools'), null);
});

test('native academic roster section values remain authoritative after changing terms', async (t) => {
  const win = fixture('<select id="roster-term-picker" class="form-control input-medium mr-5"><option value="123" data-term-id="10">Fall</option><option value="456" data-term-id="20">Spring</option></select>', '/app/student?svcid=edu#academicclass/123/undefined/roster');
  const requested: Array<RequestInfo | URL> = [];
  let firstSignal: AbortSignal | null | undefined;
  let resolveFirst: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    requested.push(path);
    if (requested.length === 1) {
      firstSignal = options?.signal;
      return new Promise<Response>((resolve) => { resolveFirst = resolve; });
    }
    return new Response(JSON.stringify([{ name: 'Spring Person' }]));
  });
  const copied: string[] = [];
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const picker = win.document.querySelector<HTMLSelectElement>('#roster-term-picker')!;
  const button = win.document.querySelector<HTMLButtonElement>('.bn-tools button')!;
  button.click();
  picker.value = '456';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(firstSignal?.aborted, true);
  button.click();
  resolveFirst?.(new Response(JSON.stringify([{ name: 'Fall Person' }])));
  await flush();
  assert.deepEqual(requested, ['/api/datadirect/sectionrosterget/123/?format=json', '/api/datadirect/sectionrosterget/456/?format=json']);
  assert.deepEqual(copied, ['Spring Person']);
});

test('roster tools are cleaned up when the native picker is replaced', async () => {
  const win = fixture('<select id="roster-term-picker"><option>Fall</option></select>');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  win.document.querySelector('#roster-term-picker')!.remove();
  win.document.querySelector('#academicclassmaincontainer')!.insertAdjacentHTML('afterbegin', '<select id="roster-term-picker"><option>Spring</option></select>');
  await flush();
  assert.equal(win.document.querySelectorAll('.bn-tools').length, 1);
});

test('only the newest request made during the current roster term supplies its identifier', async (t) => {
  const win = fixture('<select id="roster-term-picker"><option value="fall">Fall</option><option value="spring">Spring</option></select>');
  let observeEntries: ((entries: Array<{ name: string; startTime: number }>) => void) | undefined;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver');
  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    writable: true,
    value: class {
      constructor(callback: PerformanceObserverCallback) {
        observeEntries = (entries) => callback({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, this as unknown as PerformanceObserver);
      }
      observe() {}
      disconnect() {}
    },
  });
  cleanups.push(() => {
    if (original) Object.defineProperty(globalThis, 'PerformanceObserver', original);
    else Reflect.deleteProperty(globalThis, 'PerformanceObserver');
  });
  let requested: RequestInfo | URL | undefined;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL) => {
    requested = path;
    return new Response(JSON.stringify([{ name: 'Current Person' }]));
  });
  let copied = '';
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const picker = win.document.querySelector<HTMLSelectElement>('#roster-term-picker')!;
  picker.value = 'spring';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  observeEntries?.([{ name: '/api/datadirect/sectionrosterget/999/', startTime: -1 }]);
  const button = win.document.querySelector<HTMLButtonElement>('.bn-tools button')!;
  button.click();
  assert.equal(requested, undefined);
  const start = performance.now() + 10;
  observeEntries?.([{ name: '/api/datadirect/sectionrosterget/789/', startTime: start + 10 }]);
  observeEntries?.([{ name: '/api/datadirect/sectionrosterget/456/', startTime: start }]);
  button.click();
  await flush();
  assert.equal(requested, '/api/datadirect/sectionrosterget/789/?format=json');
  assert.equal(copied, 'Current Person');
});

test('profile tools stay associated with their own unambiguous photo', async () => {
  const win = fixture('<section><article><img src="/user/large_user_one.jpg?resize=80,80&amp;other=keep"><button class="user-options-button">Options</button></article><article><img src="/user/large_user_two.jpg?resize=80,80"><button class="user-options-button">Options</button></article></section>', '/app/student#directory/123');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const opened: string[] = [];
  win.open = (url, _target, features) => { opened.push(String(url)); assert.equal(features, 'noopener,noreferrer'); return null; };
  const cleanup = avatarDownloadFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const buttons = win.document.querySelectorAll<HTMLButtonElement>('[data-blackbaud-next-photo]');
  assert.equal(buttons.length, 2);
  buttons[1]!.click();
  assert.deepEqual(opened, ['https://example.myschoolapp.com/user/large_user_two.jpg']);
  win.document.querySelectorAll('article')[1]!.insertAdjacentHTML('afterbegin', '<img src="/user/large_user_other.jpg">');
  await flush();
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-photo]').length, 1);
  assert.equal(fullSizePhotoUrl('javascript:alert(1)', win.location.href), null);
  assert.equal(fullSizePhotoUrl('/user/large_user_one.jpg?resize=80,80&other=keep', win.location.href), 'https://example.myschoolapp.com/user/large_user_one.jpg?other=keep');
});

test('ambiguous directory containers do not use a nearby unrelated photo', () => {
  const win = fixture('<section><img src="/user/large_user_unrelated.jpg"><button class="user-options-button">Options one</button><button class="user-options-button">Options two</button></section>', '/app/student#directory/123');
  assert.equal(profilePhotoForOptions(win.document.querySelector('.user-options-button')!), null);
});

test('native directory table rows keep original photos associated with the correct options', () => {
  const win = fixture('<table><tbody><tr><td><img src="/user/large_user_first.jpg?resize=80,80"></td><td><div class="pull-right"><div class="btn-group"><button class="btn btn-default dropdown-toggle user-options-button">First options</button></div></div></td></tr><tr><td><img src="/user/large_user_second.jpg?resize=80,80"></td><td><div class="pull-right"><div class="btn-group"><button class="btn btn-default dropdown-toggle user-options-button">Second options</button></div></div></td></tr><tr><td>No photo</td><td><div class="pull-right"><div class="btn-group"><button class="btn btn-default dropdown-toggle user-options-button">Other options</button></div></div></td></tr></tbody></table>', '/app/student#directory/123');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const opened: string[] = [];
  win.open = (url, _target, features) => { opened.push(String(url)); assert.equal(features, 'noopener,noreferrer'); return null; };
  const cleanup = avatarDownloadFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const controls = win.document.querySelectorAll<HTMLButtonElement>('[data-blackbaud-next-photo]');
  assert.equal(controls.length, 2);
  assert.ok(controls[0]!.closest('tr') === win.document.querySelectorAll('tr')[0]);
  assert.ok(controls[1]!.closest('tr') === win.document.querySelectorAll('tr')[1]);
  controls[0]!.click();
  controls[1]!.click();
  assert.deepEqual(opened, ['https://example.myschoolapp.com/user/large_user_first.jpg', 'https://example.myschoolapp.com/user/large_user_second.jpg']);
  assert.equal(profilePhotoForOptions(win.document.querySelectorAll('.user-options-button')[2]!), null);
});

test('an unrelated photo outside a profile card is not associated with its sole options button', () => {
  const win = fixture('<section><img src="/user/large_user_unrelated.jpg"><div><button class="user-options-button">Options</button></div></section>', '/app/student#directory/123');
  assert.equal(profilePhotoForOptions(win.document.querySelector('.user-options-button')!), null);
});

test('directory discovery waits for its native results and follows replacements and late photos', async () => {
  const win = fixture('', '/app/student#directory/123');
  win.document.querySelector('#directory-results')!.remove();
  win.document.body.insertAdjacentHTML('beforeend', '<article><img src="/user/large_user_unrelated.jpg"><button class="user-options-button">Outside directory</button></article>');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = avatarDownloadFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  assert.equal(win.document.querySelector('[data-blackbaud-next-photo]'), null);
  win.document.querySelector('#site-main')!.insertAdjacentHTML('beforeend', '<div id="directory-results"><article><button class="user-options-button">Person options</button></article></div>');
  await flush();
  assert.equal(win.document.querySelector('[data-blackbaud-next-photo]'), null);
  win.document.querySelector('#directory-results article')!.insertAdjacentHTML('afterbegin', '<img src="/user/large_user_first.jpg?resize=80,80">');
  await flush();
  const original = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-photo]')!;
  assert.ok(original);
  win.document.querySelector('#directory-results')!.outerHTML = '<div id="directory-results"><table><tbody><tr><td><img src="/user/large_user_second.jpg"></td><td><button class="user-options-button">Replacement options</button></td></tr></tbody></table></div>';
  await flush();
  assert.equal(original.isConnected, false);
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-photo]').length, 1);
  const opened: string[] = [];
  win.open = (url) => { opened.push(String(url)); return null; };
  original.click();
  win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-photo]')!.click();
  assert.deepEqual(opened, ['https://example.myschoolapp.com/user/large_user_second.jpg']);
  controller.abort();
  assert.equal(win.document.querySelector('[data-blackbaud-next-photo]'), null);
});

test('directory actions follow nearest card ownership when nested cards change or move', async () => {
  const win = fixture('<article id="outer"><div id="inner"><img src="/user/large_user_person.jpg"><button class="user-options-button">Person options</button></div></article><article id="other"></article>', '/app/student#directory/123');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const opened: string[] = [];
  win.open = (url) => { opened.push(String(url)); return null; };
  const cleanup = avatarDownloadFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  const inner = win.document.querySelector<HTMLElement>('#inner')!;
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-photo]').length, 1);
  const outerAction = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-photo]')!;
  inner.className = 'profile-card';
  outerAction.click();
  assert.deepEqual(opened, []);
  await flush();
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-photo]').length, 1);
  assert.equal(outerAction.isConnected, false);
  const innerAction = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-photo]')!;
  inner.className = '';
  innerAction.click();
  assert.deepEqual(opened, []);
  await flush();
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-photo]').length, 1);
  assert.equal(innerAction.isConnected, false);
  const movedAction = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-photo]')!;
  win.document.querySelector('#other')!.append(inner);
  movedAction.click();
  assert.deepEqual(opened, []);
  await flush();
  assert.equal(win.document.querySelectorAll('[data-blackbaud-next-photo]').length, 1);
  assert.equal(movedAction.isConnected, false);
  const current = win.document.querySelector<HTMLButtonElement>('[data-blackbaud-next-photo]')!;
  assert.equal(current.closest('article')?.id, 'other');
  current.click();
  assert.deepEqual(opened, ['https://example.myschoolapp.com/user/large_user_person.jpg']);
});

test('roster discovery ignores unrelated pickers and activates a delayed native class view', async () => {
  const win = fixture('');
  win.document.querySelector('#academicclassmaincontainer')!.remove();
  win.document.body.insertAdjacentHTML('beforeend', '<select id="roster-term-picker"><option value="999">Unrelated picker</option></select>');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = rosterToolsFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  assert.equal(win.document.querySelector('.bn-tools'), null);
  win.document.querySelector('#site-main')!.insertAdjacentHTML('beforeend', '<div id="academicclassmaincontainer"><select id="roster-term-picker"><option value="123">Current picker</option></select></div>');
  await flush();
  assert.equal(win.document.querySelectorAll('.bn-tools').length, 1);
  assert.ok(win.document.querySelector('.bn-tools')!.closest('#academicclassmaincontainer'));
});

test('disabling legacy assignment navigation restores native hrefs', () => {
  const win = fixture('<a id="assignment-center-btn" href="/lms-assignment/assignment-center">Assignments</a>');
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = oldAssignmentCenterFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: { ...DEFAULT_SETTINGS, oldAssignmentCenter: true } });
  const link = win.document.querySelector<HTMLAnchorElement>('#assignment-center-btn')!;
  assert.equal(link.href, 'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/assignment-center');
  cleanup?.();
  assert.equal(link.getAttribute('href'), '/lms-assignment/assignment-center');
});

test('assignment recovery offers a manual action after a sustained mask and removes it on success', async (t) => {
  const win = fixture('<div class="sky-wait-mask sky-wait-mask-loading-fixed sky-wait-mask-loading-blocking"></div>', '/lms-assignment/assignment-center');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = assignmentRecoveryFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  t.mock.timers.tick(ASSIGNMENT_STALL_DELAY - 1);
  assert.equal(win.document.querySelector('.bn-recovery'), null);
  t.mock.timers.tick(1);
  assert.match(win.document.querySelector('.bn-recovery')!.textContent ?? '', /Reload assignments/);
  win.document.querySelector<HTMLElement>('.sky-wait-mask')!.style.display = 'none';
  await flush();
  assert.equal(win.document.querySelector('.bn-recovery'), null);
});

test('assignment recovery does not treat explicit errors as stalled loading', (t) => {
  const win = fixture('<div class="sky-wait-mask sky-wait-mask-loading-fixed sky-wait-mask-loading-blocking"></div><div class="sky-error">Unable to load</div>', '/lms-assignment/assignment-center');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const cleanup = assignmentRecoveryFeature.mount({ url: new URL(win.location.href), signal: controller.signal, settings: DEFAULT_SETTINGS });
  if (cleanup) cleanups.push(cleanup);
  t.mock.timers.tick(ASSIGNMENT_STALL_DELAY * 2);
  assert.equal(win.document.querySelector('.bn-recovery'), null);
});

test('recovery cooldown is bounded, route-specific, and tolerates blocked storage', () => {
  const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value) });
  assert.equal(recoveryRemaining(storage({ route: '/assignments', time: 1000 }), '/assignments', 2000), 59_000);
  assert.equal(recoveryRemaining(storage({ route: '/assignments', time: 1000 }), '/other', 2000), 0);
  assert.equal(recoveryRemaining(storage({ route: '/assignments', time: 1000 }), '/assignments', 61_000), 0);
  assert.equal(recoveryRemaining(storage({ route: '/assignments', time: 2000 }), '/assignments', 1000), 0);
  assert.equal(recoveryRemaining({ getItem: () => { throw new Error('Blocked'); } }, '/assignments', 2000), 0);
});

test('favicon cleanup preserves the school icon', () => {
  const win = fixture('<head><link rel="icon" href="/school.png"></head><body></body>');
  const cleanup = faviconFeature.mount({ url: new URL(win.location.href), signal: new AbortController().signal, settings: DEFAULT_SETTINGS });
  assert.equal(win.document.querySelectorAll('link[rel="icon"]').length, 2);
  cleanup?.();
  assert.equal(win.document.querySelector('link[rel="icon"]')!.getAttribute('href'), '/school.png');
});
