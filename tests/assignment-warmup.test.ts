import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { assignmentWarmupDestination, canPrepareAssignmentCenter, isAssignmentWarmupPage, isAssignmentWarmupSource } from '../src/blackbaud/assignment-warmup.ts';
import { ASSIGNMENT_WARMUP_LIFETIME, ASSIGNMENT_WARMUP_SETTLE_DELAY, assignmentWarmupFeature } from '../src/features/assignment-warmup.ts';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const nativeHref = '/lms-assignment/assignment-center/student/?svcid=edu';
const sourceUrl = 'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/schedule';
const progressUrl = sourceUrl.replace('/schedule', '/progress');
const sourceHtml = `<nav><a id="assignment-center-btn" href="${nativeHref}">Assignment Center</a></nav><main id="site-main"><div id="accordionSchedules">Native schedule</div></main>`;
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(html = sourceHtml, options: { url?: string; supported?: boolean; hidden?: boolean; prerendering?: boolean; saveData?: boolean } = {}) {
  dom = new JSDOM(html, { url: options.url ?? sourceUrl, pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win.HTMLScriptElement, 'supports', { configurable: true, value: () => options.supported !== false });
  Object.defineProperty(win.document, 'visibilityState', { configurable: true, value: options.hidden ? 'hidden' : 'visible' });
  Object.defineProperty(win.document, 'prerendering', { configurable: true, value: options.prerendering ?? false });
  Object.defineProperty(win.navigator, 'connection', { configurable: true, value: Object.assign(new win.EventTarget(), { saveData: options.saveData ?? false }) });
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
  return win;
}

function mount() {
  const controller = new AbortController();
  const cleanup = assignmentWarmupFeature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  return { controller, cleanup };
}

function ownRule(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>('#blackbaud-next-assignment-warmup');
}

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new dom!.window.Event('visibilitychange'));
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function intent(element: Element, type = 'pointerover') {
  const event = new dom!.window.Event(type, { bubbles: true, cancelable: true });
  assert.equal(element.dispatchEvent(event), true);
  assert.equal(event.defaultPrevented, false);
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('warmup matches only native secure student Schedule routes', () => {
  for (const url of [sourceUrl, `${sourceUrl}/`, `${sourceUrl}/?date=2026-10-08`, 'https://example.myschoolapp.com/app/student/?svcid=edu#studentmyday/schedule?date=2026-10-08']) {
    assert.equal(isAssignmentWarmupSource(new URL(url)), true);
  }
  for (const url of [
    sourceUrl.replace('https:', 'http:'), sourceUrl.replace('example.myschoolapp.com', 'foreign.example'),
    sourceUrl.replace('/app/student?', '/app/teacher?'), sourceUrl.replace('/schedule', '/progress'),
    sourceUrl.replace('/schedule', '/schedule-extra'), sourceUrl.replace('/schedule', '/schedule/details'),
  ]) assert.equal(isAssignmentWarmupSource(new URL(url)), false);
});

test('intent preparation supports other secure LMS pages and excludes login and either Assignment Center', () => {
  for (const url of [progressUrl, sourceUrl.replace('/schedule', '/resources'), sourceUrl.replace('/schedule', '/directory/123'),
    'https://example.myschoolapp.com/app?svcid=edu', 'https://example.myschoolapp.com/lms-assignment/assignment/assignment-student-view/123?svcid=edu']) {
    assert.equal(isAssignmentWarmupPage(new URL(url)), true, url);
    assert.equal(assignmentWarmupFeature.matches(new URL(url)), true, url);
  }
  for (const url of [
    sourceUrl.replace('https:', 'http:'), sourceUrl.replace('example.myschoolapp.com', 'foreign.example'),
    'https://example.myschoolapp.com/app/login?svcid=edu', 'https://example.myschoolapp.com/app?svcid=edu#login',
    `https://example.myschoolapp.com${nativeHref}`, sourceUrl.replace('/schedule', '/assignment-center'),
    sourceUrl.replace('/schedule', '/assignment-center/?date=2026-10-08'), sourceUrl.replace('https://', 'https://user:secret@'),
  ]) assert.equal(isAssignmentWarmupPage(new URL(url)), false, url);
});

test('other LMS pages prepare only on delegated link intent, without link scans or identity reads', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<nav><a href="${nativeHref}"><span>Assignment Center</span></a><a href="#unrelated">Other</a></nav><main></main>`, { url: progressUrl });
  let documentScans = 0;
  let identityReads = 0;
  const query = document.querySelectorAll.bind(document);
  t.mock.method(document, 'querySelectorAll', (selector: string) => { documentScans += 1; return query(selector); });
  t.mock.method(globalThis, 'fetch', () => { identityReads += 1; throw new Error('Intent must not read identity.'); });
  mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY + ASSIGNMENT_WARMUP_LIFETIME);
  assert.equal(ownRule(), null);
  intent(document.querySelector('a[href="#unrelated"]')!);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  document.querySelector('main')!.innerHTML = '<section><p>Native content rerender</p></section>';
  intent(document.querySelector('span')!);
  t.mock.timers.tick(0);
  assert.ok(ownRule());
  assert.equal(identityReads, 0);
  assert.equal(documentScans, 0);
  assert.equal(document.querySelector('a')!.getAttribute('href'), nativeHref);
});

test('keyboard focus prepares late or rerendered native links on another LMS page', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture('<nav></nav>', { url: 'https://example.myschoolapp.com/app/student?svcid=edu#directory/123' });
  mount();
  document.querySelector('nav')!.innerHTML = `<a href="${nativeHref}"><svg><title>Assignment Center</title></svg></a>`;
  intent(document.querySelector('svg')!, 'pointerover');
  document.querySelector('nav')!.innerHTML = `<a href="${nativeHref}">Replacement Assignment Center</a>`;
  // The old pending source is gone; focus on the replacement selects its real href.
  intent(document.querySelector('a')!, 'focusin');
  t.mock.timers.tick(0);
  assert.ok(ownRule());
});

test('Schedule link intent prepares before its automatic settling delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  mount();
  t.mock.timers.tick(300);
  assert.equal(ownRule(), null);
  intent(document.querySelector('#assignment-center-btn')!, 'focusin');
  t.mock.timers.tick(0);
  const rule = ownRule();
  assert.ok(rule);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), rule);
});

test('generic intent preserves one rule across native URL aliases and anchor handoffs without extending its lifetime', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<nav><a href="${nativeHref}">First</a><a href="https://example.myschoolapp.com/lms-assignment/assignment-center/student?svcid=edu">Second</a></nav>`, { url: progressUrl });
  mount();
  const first = document.querySelector('a')!;
  const second = first.nextElementSibling!;
  intent(first);
  t.mock.timers.tick(0);
  const rule = ownRule();
  assert.ok(rule);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_LIFETIME - 1);
  intent(second, 'focusin');
  first.remove();
  second.setAttribute('href', nativeHref);
  await flush();
  assert.equal(ownRule(), rule);
  t.mock.timers.tick(1);
  assert.equal(ownRule(), null);
  intent(second);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
});

test('generic intent validates href and ancestor visibility again before observer delivery at start', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<nav><a href="${nativeHref}">Assignment Center</a></nav>`, { url: progressUrl });
  mount();
  const link = document.querySelector('a')!;
  const nav = document.querySelector<HTMLElement>('nav')!;
  intent(link);
  link.setAttribute('href', `${nativeHref}&action=delete`);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  await flush();
  link.setAttribute('href', nativeHref);
  intent(link);
  nav.hidden = true;
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  await flush();
  nav.hidden = false;
  intent(link);
  t.mock.timers.tick(0);
  assert.ok(ownRule());
  link.setAttribute('href', `${nativeHref}#details`);
  await flush();
  assert.equal(ownRule(), null);
  link.setAttribute('href', nativeHref);
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
});

test('hidden or disabled ancestors and invalid destinations cannot trigger generic preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<nav hidden><a href="${nativeHref}">Assignment Center</a></nav>`, { url: progressUrl });
  mount();
  const link = document.querySelector('a')!;
  const nav = document.querySelector<HTMLElement>('nav')!;
  intent(link, 'focusin');
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  nav.hidden = false;
  for (const href of [progressUrl, 'https://foreign.example/lms-assignment/assignment-center/student/?svcid=edu', `${nativeHref}&action=delete`, `${nativeHref}#details`]) {
    link.setAttribute('href', href);
    intent(link);
    t.mock.timers.tick(0);
    assert.equal(ownRule(), null, href);
  }
  link.setAttribute('href', nativeHref);
  nav.setAttribute('inert', '');
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  nav.removeAttribute('inert');
  nav.setAttribute('aria-disabled', 'true');
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  nav.removeAttribute('aria-disabled');
  intent(link);
  t.mock.timers.tick(0);
  assert.ok(ownRule());
});

test('generic intent stays inactive in unsupported, hidden or prerendered documents', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const options of [{ supported: false }, { prerendering: true }, { hidden: true }]) {
    fixture(`<a href="${nativeHref}">Assignment Center</a>`, { url: progressUrl, ...options });
    const { controller, cleanup } = mount();
    intent(document.querySelector('a')!, 'focusin');
    t.mock.timers.tick(0);
    assert.equal(ownRule(), null);
    controller.abort();
    cleanup?.();
    cleanups.length = 0;
    dom!.window.close();
    restore();
  }
});

test('moved generic sources acquire current ancestor visibility guards and removals cancel the attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<nav><a href="${nativeHref}">Assignment Center</a></nav><section></section>`, { url: progressUrl });
  mount();
  const link = document.querySelector('a')!;
  const section = document.querySelector<HTMLElement>('section')!;
  intent(link);
  t.mock.timers.tick(0);
  const rule = ownRule();
  section.append(link);
  await flush();
  assert.equal(ownRule(), rule);
  section.style.display = 'none';
  await flush();
  assert.equal(ownRule(), null);
  section.style.removeProperty('display');
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
});

test('generic source removal cancels preparation and never starts a second rule', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<nav><a href="${nativeHref}">Assignment Center</a></nav>`, { url: progressUrl });
  mount();
  intent(document.querySelector('a')!);
  t.mock.timers.tick(0);
  assert.ok(ownRule());
  document.querySelector('nav')!.remove();
  await flush();
  assert.equal(ownRule(), null);
  document.body.innerHTML = `<a href="${nativeHref}">Replacement</a>`;
  intent(document.querySelector('a')!);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
});

test('data-saving changes cancel active generic preparation and blocked intent does not consume its attempt', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<a href="${nativeHref}">Assignment Center</a>`, { url: progressUrl, saveData: true });
  mount();
  const connection = (dom!.window.navigator as Navigator & { connection: EventTarget & { saveData: boolean } }).connection;
  const link = document.querySelector('a')!;
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  connection.saveData = false;
  connection.dispatchEvent(new dom!.window.Event('change'));
  assert.equal(ownRule(), null);
  intent(link);
  t.mock.timers.tick(0);
  assert.ok(ownRule());
  connection.saveData = true;
  connection.dispatchEvent(new dom!.window.Event('change'));
  assert.equal(ownRule(), null);
  connection.saveData = false;
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
});

test('generic pointer intent preserves native actions and abort removes pending and active preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<a href="${nativeHref}">Assignment Center</a>`, { url: progressUrl });
  const link = document.querySelector('a')!;
  let nativePointerDown = 0;
  link.addEventListener('pointerdown', () => { nativePointerDown += 1; });
  const pending = mount();
  intent(link, 'pointerdown');
  pending.controller.abort();
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  const active = mount();
  intent(link, 'pointerdown');
  t.mock.timers.tick(0);
  assert.ok(ownRule());
  visibility('hidden');
  assert.equal(ownRule(), null);
  visibility('visible');
  intent(link);
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  active.controller.abort();
  assert.equal(nativePointerDown, 2);
  assert.equal(link.getAttribute('href'), nativeHref);
  assert.equal(window.location.href, progressUrl);
});

test('generic intent revalidates route changes before starting and settings changes clean up active preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(`<a href="${nativeHref}">Assignment Center</a>`, { url: progressUrl });
  const pending = mount();
  const link = document.querySelector('a')!;
  intent(link);
  dom!.reconfigure({ url: sourceUrl.replace('/schedule', '/resources') });
  t.mock.timers.tick(0);
  assert.equal(ownRule(), null);
  pending.controller.abort();
  dom!.reconfigure({ url: progressUrl });
  const controller = new FeatureController([assignmentWarmupFeature]);
  cleanups.push(() => controller.dispose());
  const url = new URL(progressUrl);
  const settings = { ...DEFAULT_SETTINGS, enabled: true, prepareAssignmentCenter: true, oldAssignmentCenter: false };
  for (const changes of [{ prepareAssignmentCenter: false }, { oldAssignmentCenter: true }, { enabled: false }]) {
    controller.update(url, settings);
    intent(link, 'focusin');
    t.mock.timers.tick(0);
    assert.ok(ownRule());
    controller.update(url, { ...settings, ...changes });
    assert.equal(ownRule(), null);
    intent(link);
    t.mock.timers.tick(0);
    assert.equal(ownRule(), null);
  }
});

test('warmup preserves only exact native same-origin assignment destinations with svcid=edu', () => {
  fixture();
  const link = document.querySelector<HTMLAnchorElement>('#assignment-center-btn')!;
  for (const href of [nativeHref, '/lms-assignment/assignment-center/student?svcid=edu', `https://example.myschoolapp.com${nativeHref}`]) {
    link.setAttribute('href', href);
    assert.equal(assignmentWarmupDestination(link, new URL(sourceUrl)), href);
  }
  for (const href of [
    '/lms-assignment/assignment-center/student/', '/lms-assignment/assignment-center/student/?svcid=other',
    `${nativeHref}&action=delete`, `${nativeHref}&svcid=edu`, `${nativeHref}&`, `${nativeHref}#`, `${nativeHref}#details`,
    '/lms-assignment/assignment-center/student-extra/?svcid=edu', '/lms-assignment/assignment/assignment-student-view/123?svcid=edu',
    `https://foreign.example${nativeHref}`, `http://example.myschoolapp.com${nativeHref}`, `https://user:secret@example.myschoolapp.com${nativeHref}`,
    'javascript:bad()',
  ]) {
    link.setAttribute('href', href);
    assert.equal(assignmentWarmupDestination(link, new URL(sourceUrl)), null, href);
  }
});

test('preparation waits for source settling, preserves native URLs and scripts, and expires without rewarming', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  const nativeRule = document.createElement('script');
  nativeRule.type = 'speculationrules';
  nativeRule.textContent = '{"prefetch":[{"source":"list","urls":["/native-resource"]}]}';
  document.head.append(nativeRule);
  const { controller } = mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY - 1);
  assert.equal(ownRule(), null);
  t.mock.timers.tick(1);
  const rule = ownRule()!;
  assert.equal(rule.parentElement, document.head);
  assert.equal(rule.type, 'speculationrules');
  assert.deepEqual(JSON.parse(rule.textContent!), { prerender: [{ source: 'list', urls: [nativeHref], eagerness: 'immediate' }] });
  assert.equal(document.querySelector('#assignment-center-btn')!.getAttribute('href'), nativeHref);
  assert.equal(window.location.href, sourceUrl);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_LIFETIME);
  assert.equal(ownRule(), null);
  document.querySelector('#assignment-center-btn')!.setAttribute('href', nativeHref);
  visibility('hidden');
  visibility('visible');
  await flush();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY + ASSIGNMENT_WARMUP_LIFETIME);
  assert.equal(ownRule(), null);
  assert.equal(nativeRule.isConnected, true);
  controller.abort();
  assert.equal(nativeRule.isConnected, true);
});

test('late anchors and whole ancestor replacements are discovered incrementally before the first attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture('<nav></nav><main id="site-main"><div id="accordionSchedules">Native schedule</div></main>');
  mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  document.querySelector('nav')!.innerHTML = `<a id="assignment-center-btn" href="${nativeHref}">Assignment Center</a>`;
  await flush();
  t.mock.timers.tick(300);
  document.querySelector('nav')!.outerHTML = `<nav><a id="assignment-center-btn" href="${nativeHref}">Replacement native anchor</a></nav>`;
  await flush();
  t.mock.timers.tick(300);
  assert.equal(ownRule(), null);
  t.mock.timers.tick(300);
  assert.ok(ownRule());
});

test('unchanged href mutations do not reset the settle timer or extend the prepared lifetime', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  mount();
  t.mock.timers.tick(300);
  document.querySelector('#assignment-center-btn')!.setAttribute('href', nativeHref);
  await flush();
  t.mock.timers.tick(300);
  const rule = ownRule();
  assert.ok(rule);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_LIFETIME - 1);
  document.querySelector('#assignment-center-btn')!.setAttribute('href', nativeHref);
  await flush();
  assert.equal(ownRule(), rule);
  t.mock.timers.tick(1);
  assert.equal(ownRule(), null);
});

test('changed hrefs are validated again at start and can settle only before any attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  mount();
  const link = document.querySelector('#assignment-center-btn')!;
  link.setAttribute('href', `${nativeHref}&action=delete`);
  // Deliberately run the timer before delivering the href MutationObserver.
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  await flush();
  link.setAttribute('href', nativeHref);
  await flush();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.ok(ownRule());
  link.setAttribute('href', '/lms-assignment/assignment-center/student?svcid=edu');
  await flush();
  assert.equal(ownRule(), null);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY + ASSIGNMENT_WARMUP_LIFETIME);
  assert.equal(ownRule(), null);
});

test('replacing an attempted anchor cancels preparation and never starts a second rule', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.ok(ownRule());
  document.querySelector('nav')!.outerHTML = `<nav><a id="assignment-center-btn" href="${nativeHref}">Replacement</a></nav>`;
  await flush();
  assert.equal(ownRule(), null);
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
});

test('hidden pages cancel settling but may prepare on return only if never attempted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  mount();
  t.mock.timers.tick(300);
  visibility('hidden');
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  visibility('visible');
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.ok(ownRule());
  visibility('hidden');
  assert.equal(ownRule(), null);
  visibility('visible');
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
});

test('unsupported, prerendered, data-saving and initially hidden sources do not start preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const options of [{ supported: false }, { prerendering: true }, { saveData: true }, { hidden: true }]) {
    fixture(sourceHtml, options);
    assert.equal(canPrepareAssignmentCenter(), false);
    const { controller, cleanup } = mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY + ASSIGNMENT_WARMUP_LIFETIME);
    assert.equal(ownRule(), null);
    controller.abort();
    cleanup?.();
    cleanups.length = 0;
    dom!.window.close();
    restore();
  }
});

test('hidden native schedule and cancellation before/after starting preserve native navigation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  const schedule = document.querySelector<HTMLElement>('#accordionSchedules')!;
  schedule.hidden = true;
  const pending = mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  schedule.hidden = false;
  await flush();
  t.mock.timers.tick(300);
  pending.controller.abort();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  const active = mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.ok(ownRule());
  active.controller.abort();
  assert.equal(ownRule(), null);
  assert.equal(document.querySelector('#assignment-center-btn')!.getAttribute('href'), nativeHref);
});

test('route changes are revalidated at timer start and legacy assignment mode disables preparation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  mount();
  dom!.reconfigure({ url: sourceUrl.replace('/schedule', '/progress') });
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  assert.equal(assignmentWarmupFeature.enabled({ ...DEFAULT_SETTINGS, prepareAssignmentCenter: true, oldAssignmentCenter: false }), true);
  assert.equal(assignmentWarmupFeature.enabled({ ...DEFAULT_SETTINGS, prepareAssignmentCenter: true, oldAssignmentCenter: true }), false);
  assert.equal(assignmentWarmupFeature.enabled({ ...DEFAULT_SETTINGS, prepareAssignmentCenter: false, oldAssignmentCenter: false }), false);
});

test('native parent visibility toggles resume an unused visit and cancel an attempted preparation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  const main = document.querySelector<HTMLElement>('#site-main')!;
  const nav = document.querySelector<HTMLElement>('nav')!;
  main.style.display = 'none';
  nav.hidden = true;
  mount();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  main.style.removeProperty('display');
  await flush();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
  nav.hidden = false;
  await flush();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.ok(ownRule());
  main.setAttribute('aria-hidden', 'true');
  await flush();
  assert.equal(ownRule(), null);
  main.removeAttribute('aria-hidden');
  await flush();
  t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
  assert.equal(ownRule(), null);
});

for (const [name, selector] of [['Schedule', '#accordionSchedules'], ['native link', '#assignment-center-btn'], ['Schedule wrapper', '#site-main'], ['link wrapper', 'nav']]) {
  test(`moving the same ${name} out of a hidden container starts unused preparation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(`${sourceHtml}<section id="hidden" hidden></section><section id="visible"></section>`);
    const element = document.querySelector(selector)!;
    document.querySelector('#hidden')!.append(element);
    mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    assert.equal(ownRule(), null);
    document.querySelector('#visible')!.append(element);
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY - 1);
    assert.equal(ownRule(), null);
    t.mock.timers.tick(1);
    const rule = ownRule();
    assert.ok(rule);
    assert.deepEqual(JSON.parse(rule.textContent!), { prerender: [{ source: 'list', urls: [nativeHref], eagerness: 'immediate' }] });
  });

  test(`moving the same ${name} from one hidden container into another follows its reveal`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(`${sourceHtml}<section id="first" hidden></section><section id="second" hidden></section>`);
    const element = document.querySelector(selector)!;
    const second = document.querySelector<HTMLElement>('#second')!;
    document.querySelector('#first')!.append(element);
    mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    assert.equal(ownRule(), null);
    second.append(element);
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    assert.equal(ownRule(), null);
    second.hidden = false;
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    const rule = ownRule();
    assert.ok(rule);
    assert.deepEqual(JSON.parse(rule.textContent!), { prerender: [{ source: 'list', urls: [nativeHref], eagerness: 'immediate' }] });
  });

  test(`moving the same active ${name} into a hidden container cancels preparation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(`${sourceHtml}<section id="hidden" hidden></section>`);
    const element = document.querySelector(selector)!;
    mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    const rule = ownRule();
    assert.ok(rule);
    document.querySelector('#hidden')!.append(element);
    await flush();
    assert.equal(ownRule(), null);
    assert.equal(rule.isConnected, false);
    document.body.append(element);
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    assert.equal(ownRule(), null);
  });

  test(`moving the same ${name} between visible containers follows new ancestor visibility`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(`${sourceHtml}<section id="new-parent"></section>`);
    const element = document.querySelector(selector)!;
    const parent = document.querySelector<HTMLElement>('#new-parent')!;
    mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    const rule = ownRule();
    assert.ok(rule);
    parent.append(element);
    await flush();
    assert.equal(ownRule(), rule);
    parent.hidden = true;
    await flush();
    assert.equal(ownRule(), null);
    assert.equal(rule.isConnected, false);
  });

  test(`moving the same ${name} between visible containers preserves settling and the original expiry`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(`${sourceHtml}<section id="new-parent"></section>`);
    const element = document.querySelector(selector)!;
    mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY / 2);
    document.querySelector('#new-parent')!.append(element);
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY / 2 - 1);
    assert.equal(ownRule(), null);
    t.mock.timers.tick(1);
    const rule = ownRule();
    assert.ok(rule);
    t.mock.timers.tick(ASSIGNMENT_WARMUP_LIFETIME - 1);
    document.body.append(element);
    await flush();
    assert.equal(ownRule(), rule);
    t.mock.timers.tick(1);
    assert.equal(ownRule(), null);
    assert.equal(rule.isConnected, false);
  });

  test(`aborting after moving the same ${name} removes preparation and prevents restart`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(`${sourceHtml}<section id="new-parent"></section>`);
    const element = document.querySelector(selector)!;
    const parent = document.querySelector<HTMLElement>('#new-parent')!;
    const { controller } = mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    const rule = ownRule();
    assert.ok(rule);
    parent.append(element);
    await flush();
    controller.abort();
    assert.equal(ownRule(), null);
    assert.equal(rule.isConnected, false);
    parent.hidden = true;
    await flush();
    parent.hidden = false;
    document.body.append(element);
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY + ASSIGNMENT_WARMUP_LIFETIME);
    assert.equal(ownRule(), null);
    assert.equal(document.querySelector('#assignment-center-btn')!.getAttribute('href'), nativeHref);
  });
}

for (const [attribute, value] of [['disabled', ''], ['aria-disabled', 'true']]) {
  test(`automatic warmup follows ${attribute} ancestor changes before and after preparation`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture();
    const main = document.querySelector('#site-main')!;
    main.setAttribute(attribute, value);
    mount();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    assert.equal(ownRule(), null);
    main.removeAttribute(attribute);
    await flush();
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    const rule = ownRule();
    assert.ok(rule);
    main.setAttribute(attribute, value);
    await flush();
    assert.equal(ownRule(), null);
    assert.equal(rule.isConnected, false);
  });
}

test('schedule descendant additions do not rescan the document or restart preparation settling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  let documentScans = 0;
  const query = document.querySelectorAll.bind(document);
  t.mock.method(document, 'querySelectorAll', (selector: string) => { documentScans += 1; return query(selector); });
  mount();
  const initialScans = documentScans;
  t.mock.timers.tick(300);
  document.querySelector('#accordionSchedules')!.insertAdjacentHTML('beforeend', '<section><p>Native schedule details updated</p><span>Room 101</span></section>');
  await flush();
  assert.equal(documentScans, initialScans);
  t.mock.timers.tick(300);
  assert.ok(ownRule());
});

test('controller preserves preparation across unrelated preferences and cancels it for feature, legacy, master and route changes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture();
  const controller = new FeatureController([assignmentWarmupFeature]);
  cleanups.push(() => controller.dispose());
  const url = new URL(sourceUrl);
  let settings = { ...DEFAULT_SETTINGS, enabled: true, prepareAssignmentCenter: true, oldAssignmentCenter: false };
  const prepare = () => {
    controller.update(url, settings);
    t.mock.timers.tick(ASSIGNMENT_WARMUP_SETTLE_DELAY);
    const rule = ownRule();
    assert.ok(rule);
    return rule;
  };
  const first = prepare();
  settings = { ...settings, pageAppearance: !settings.pageAppearance };
  controller.update(url, settings);
  assert.equal(ownRule(), first);
  settings = { ...settings, prepareAssignmentCenter: false };
  controller.update(url, settings);
  assert.equal(ownRule(), null);
  assert.equal(first.isConnected, false);
  settings = { ...settings, prepareAssignmentCenter: true };
  const second = prepare();
  assert.notEqual(second, first);
  settings = { ...settings, oldAssignmentCenter: true };
  controller.update(url, settings);
  assert.equal(ownRule(), null);
  assert.equal(second.isConnected, false);
  settings = { ...settings, oldAssignmentCenter: false };
  const third = prepare();
  settings = { ...settings, enabled: false };
  controller.update(url, settings);
  assert.equal(ownRule(), null);
  assert.equal(third.isConnected, false);
  settings = { ...settings, enabled: true };
  const fourth = prepare();
  const progress = sourceUrl.replace('/schedule', '/progress');
  dom!.reconfigure({ url: progress });
  controller.update(new URL(progress), settings);
  assert.equal(ownRule(), null);
  assert.equal(fourth.isConnected, false);
  dom!.reconfigure({ url: sourceUrl });
  const newVisit = prepare();
  assert.notEqual(newVisit, fourth);
});
