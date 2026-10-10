import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { assignmentWarmupDestination, canPrepareAssignmentCenter, isAssignmentWarmupSource } from '../src/blackbaud/assignment-warmup.ts';
import { ASSIGNMENT_WARMUP_LIFETIME, ASSIGNMENT_WARMUP_SETTLE_DELAY, assignmentWarmupFeature } from '../src/features/assignment-warmup.ts';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const nativeHref = '/lms-assignment/assignment-center/student/?svcid=edu';
const sourceUrl = 'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/schedule';
const sourceHtml = `<nav><a id="assignment-center-btn" href="${nativeHref}">Assignment Center</a></nav><main id="site-main"><div id="accordionSchedules">Native schedule</div></main>`;
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(html = sourceHtml, options: { supported?: boolean; hidden?: boolean; prerendering?: boolean; saveData?: boolean } = {}) {
  dom = new JSDOM(html, { url: sourceUrl, pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win.HTMLScriptElement, 'supports', { configurable: true, value: () => options.supported !== false });
  Object.defineProperty(win.document, 'visibilityState', { configurable: true, value: options.hidden ? 'hidden' : 'visible' });
  Object.defineProperty(win.document, 'prerendering', { configurable: true, value: options.prerendering ?? false });
  Object.defineProperty(win.navigator, 'connection', { configurable: true, value: { saveData: options.saveData ?? false } });
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
