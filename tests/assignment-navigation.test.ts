import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { ASSIGNMENT_DETAILS_SELECTOR, assignmentBreadcrumbLinks, assignmentCenterUrl, isAssignmentDetail, isNativeAssignmentBackLink } from '../src/blackbaud/assignment-navigation.ts';
import { assignmentBreadcrumbFeature } from '../src/features/assignment-center.ts';
import { legacyAssignmentCenterUrl } from '../src/blackbaud/routes.ts';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Settings } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const origin = 'https://example.myschoolapp.com';
const detailUrl = `${origin}/lms-assignment/assignment/assignment-student-view/123?svcid=edu`;
const centerUrl = `${origin}/lms-assignment/assignment-center/student/?svcid=edu`;
const backHref = 'javascript:history.back()';
const headingClass = 'sky-theme-font-heading-1 display-inline';
const nativeHeading = `<h1 class="${headingClass}"><a href="${backHref}"> Assignments </a><span>&gt; Chapter review</span></h1>`;
const nativePage = `<app-assignment-view-details>${nativeHeading}</app-assignment-view-details>`;
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(html = nativePage, url = detailUrl) {
  dom = new JSDOM(html, { url });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    MutationObserver: dom.window.MutationObserver,
  })) {
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

function mount(settings: Settings = DEFAULT_SETTINGS) {
  const controller = new AbortController();
  const cleanup = assignmentBreadcrumbFeature.mount({ url: new URL(window.location.href), settings, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  return { controller, cleanup };
}

function breadcrumb(): HTMLAnchorElement {
  return document.querySelector<HTMLAnchorElement>('app-assignment-view-details h1 > a')!;
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('assignment breadcrumb routes accept exact secure student details and preserve a direct center destination', () => {
  for (const url of [detailUrl, `${origin}/lms-assignment/assignment/assignment-student-view/456/`, `${detailUrl}#native-state`,
    `${origin}/lms-assignment/assignment/assignment-student-view/${'9'.repeat(100)}`]) {
    assert.equal(isAssignmentDetail(new URL(url)), true, url);
    assert.equal(assignmentCenterUrl(new URL(url)), centerUrl);
  }
  for (const url of [
    detailUrl.replace('https:', 'http:'), detailUrl.replace('example.myschoolapp.com', 'foreign.example'),
    detailUrl.replace('https://', 'https://user:secret@'), detailUrl.replace('/123?', '/0?'),
    detailUrl.replace('/123?', '/01?'), detailUrl.replace('/123?', '/123other?'), detailUrl.replace('/123?', '/123/extra?'),
    centerUrl, `${origin}/app/student?svcid=edu#studentmyday/progress`, `${origin}/app/login`,
    'https://app.blackbaud.com/signin/?redirectUrl=other',
  ]) assert.equal(isAssignmentDetail(new URL(url)), false, url);
});

test('native assignment back hrefs accept harmless whitespace and reject different JavaScript actions', () => {
  fixture();
  const link = breadcrumb();
  for (const href of [backHref, 'javascript: history.back( ) ;', ' javascript:window.history.back() ', 'javascript: window.history.back(\n); ']) {
    link.setAttribute('href', href);
    assert.equal(isNativeAssignmentBackLink(link), true, href);
  }
  for (const href of [centerUrl, '#back', 'javascript:history.forward()', 'javascript:history.go(-1)',
    'javascript:history.back();alert(1)', 'javascript:other.history.back()', 'javascript:history.back(1)', '']) {
    link.setAttribute('href', href);
    assert.equal(isNativeAssignmentBackLink(link), false, href);
  }
  link.removeAttribute('href');
  assert.equal(isNativeAssignmentBackLink(link), false);
});

test('breadcrumb discovery stays within the native component heading and its nearest owner', () => {
  fixture(`<a href="${backHref}">Assignments</a><app-assignment-view-details id="outer">
    ${nativeHeading}<h1 class="${headingClass}"><a href="${backHref}">Class assignments</a></h1>
    <h1><a href="${backHref}">Assignments</a></h1><p><a href="${backHref}">Assignments</a></p>
    <h1 class="${headingClass}"><span><a href="${backHref}">Assignments</a></span></h1>
    <app-assignment-view-details id="inner">${nativeHeading}</app-assignment-view-details>
  </app-assignment-view-details>`);
  assert.equal(ASSIGNMENT_DETAILS_SELECTOR, 'app-assignment-view-details');
  const outer = document.querySelector<HTMLElement>('#outer')!;
  const inner = document.querySelector<HTMLElement>('#inner')!;
  const links = assignmentBreadcrumbLinks(outer);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.closest(ASSIGNMENT_DETAILS_SELECTOR), outer);
  assert.equal(assignmentBreadcrumbLinks(inner).length, 1);
});

test('a detail opened from another LMS page links directly to Assignment Center and leaves unrelated anchors native', async () => {
  const win = fixture(`${nativePage}<a id="unrelated" href="${backHref}">Assignments</a>`, `${origin}/app/student?svcid=edu#resourceboard`);
  win.history.pushState(null, '', detailUrl);
  mount();
  const link = breadcrumb();
  assert.equal(link.href, centerUrl);
  assert.equal(document.querySelector('#unrelated')!.getAttribute('href'), backHref);
  assert.equal(window.location.href, detailUrl);
  await flush();
  assert.equal(link.href, centerUrl);
});

test('the rewritten real href keeps native activation and other anchor attributes', () => {
  const win = fixture();
  const link = breadcrumb();
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener');
  link.setAttribute('aria-label', 'Assignments');
  mount();
  assert.equal(link.href, centerUrl);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener');
  assert.equal(link.getAttribute('aria-label'), 'Assignments');
  const activation = new win.Event('click', { bubbles: true, cancelable: true });
  assert.equal(link.dispatchEvent(activation), true);
  assert.equal(activation.defaultPrevented, false);
  const nativeEvents: boolean[] = [];
  link.addEventListener('click', (event) => {
    nativeEvents.push(event.defaultPrevented);
    // Avoid jsdom's unsupported document navigation after observing the native
    // listener. The extension must neither cancel nor intercept this event.
    event.preventDefault();
  });
  for (const options of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
  }
  assert.deepEqual(nativeEvents, [false, false, false, false]);
});

test('delayed native detail roots and breadcrumb replacements recover without keeping stale href ownership', async () => {
  fixture('<main></main>');
  const { controller } = mount();
  document.querySelector('main')!.innerHTML = nativePage;
  await flush();
  const original = breadcrumb();
  assert.equal(original.href, centerUrl);
  document.querySelector(ASSIGNMENT_DETAILS_SELECTOR)!.innerHTML = nativeHeading;
  await flush();
  const replacement = breadcrumb();
  assert.notEqual(replacement, original);
  assert.equal(original.getAttribute('href'), backHref);
  assert.equal(replacement.href, centerUrl);
  controller.abort();
  assert.equal(replacement.getAttribute('href'), backHref);
  document.querySelector('main')!.innerHTML = nativePage;
  await flush();
  assert.equal(breadcrumb().getAttribute('href'), backHref);
});

test('label and native heading-class changes revoke and recover breadcrumb rewriting', async () => {
  fixture();
  mount();
  const link = breadcrumb();
  const heading = link.parentElement!;
  link.firstChild!.textContent = 'Other page';
  await flush();
  assert.equal(link.getAttribute('href'), backHref);
  link.firstChild!.textContent = ' \n Assignments \t ';
  await flush();
  assert.equal(link.href, centerUrl);
  heading.classList.remove('display-inline');
  await flush();
  assert.equal(link.getAttribute('href'), backHref);
  heading.classList.add('display-inline');
  await flush();
  assert.equal(link.href, centerUrl);
});

test('moving a breadcrumb out of its native heading restores it and moving into another native owner recovers', async () => {
  fixture(`${nativePage}<app-assignment-view-details id="other"><h1 class="${headingClass}"></h1></app-assignment-view-details><aside></aside>`);
  mount();
  const link = breadcrumb();
  document.querySelector('aside')!.append(link);
  await flush();
  assert.equal(link.getAttribute('href'), backHref);
  document.querySelector('#other h1')!.append(link);
  await flush();
  assert.equal(link.href, centerUrl);
  assert.equal(link.closest(ASSIGNMENT_DETAILS_SELECTOR)!.id, 'other');
});

test('direct handoff to an earlier mounted detail root transfers cleanup ownership', async () => {
  fixture(`<app-assignment-view-details id="first"><h1 class="${headingClass}"></h1></app-assignment-view-details>${nativePage}`);
  const { controller } = mount();
  const link = breadcrumb();
  assert.equal(link.href, centerUrl);
  document.querySelector('#first h1')!.append(link);
  await flush();
  assert.equal(link.href, centerUrl);
  assert.equal(link.closest(ASSIGNMENT_DETAILS_SELECTOR)!.id, 'first');
  controller.abort();
  assert.equal(link.getAttribute('href'), backHref);
});

test('native correct and unrelated hrefs are untouched and later native href changes survive cleanup', async () => {
  fixture(`<app-assignment-view-details><h1 class="${headingClass}"><a id="correct" href="${centerUrl}">Assignments</a><a id="other" href="/native-class">Assignments</a><a id="back" href="${backHref}">Assignments</a></h1></app-assignment-view-details>`);
  const { cleanup } = mount();
  assert.equal(document.querySelector('#correct')!.getAttribute('href'), centerUrl);
  assert.equal(document.querySelector('#other')!.getAttribute('href'), '/native-class');
  const owned = document.querySelector<HTMLAnchorElement>('#back')!;
  assert.equal(owned.href, centerUrl);
  owned.setAttribute('href', '/updated-by-native');
  await flush();
  assert.equal(owned.getAttribute('href'), '/updated-by-native');
  cleanup?.();
  assert.equal(owned.getAttribute('href'), '/updated-by-native');
  assert.equal(document.querySelector('#correct')!.getAttribute('href'), centerUrl);
  assert.equal(document.querySelector('#other')!.getAttribute('href'), '/native-class');
});

test('new native history-back href spelling replaces previous ownership for conditional restoration', async () => {
  fixture();
  const { cleanup } = mount();
  const link = breadcrumb();
  const latestHref = 'javascript: window.history.back( ) ;';
  link.setAttribute('href', latestHref);
  await flush();
  assert.equal(link.href, centerUrl);
  cleanup?.();
  cleanup?.();
  assert.equal(link.getAttribute('href'), latestHref);
});

test('legacy preference changes the direct breadcrumb destination and the master switch restores native state', async () => {
  fixture();
  const controller = new FeatureController([assignmentBreadcrumbFeature]);
  cleanups.push(() => controller.dispose());
  const url = new URL(detailUrl);
  const settings = { ...DEFAULT_SETTINGS, enabled: true, oldAssignmentCenter: false };
  const link = breadcrumb();
  controller.update(url, settings);
  assert.equal(link.href, centerUrl);
  controller.update(url, { ...settings, oldAssignmentCenter: true });
  assert.equal(link.href, legacyAssignmentCenterUrl(url));
  controller.update(url, settings);
  assert.equal(link.href, centerUrl);
  controller.update(url, { ...settings, enabled: false });
  assert.equal(link.getAttribute('href'), backHref);
  link.textContent = 'Assignments';
  await flush();
  assert.equal(link.getAttribute('href'), backHref);
  controller.update(url, settings);
  assert.equal(link.href, centerUrl);
  dom!.reconfigure({ url: `${origin}/app/student?svcid=edu#studentmyday/progress` });
  controller.update(new URL(window.location.href), settings);
  assert.equal(link.getAttribute('href'), backHref);
});

test('aborted mounts and repeated cleanup leave native controls unchanged', async () => {
  fixture();
  const controller = new AbortController();
  controller.abort();
  assignmentBreadcrumbFeature.mount({ url: new URL(detailUrl), settings: DEFAULT_SETTINGS, signal: controller.signal });
  assert.equal(breadcrumb().getAttribute('href'), backHref);
  const active = mount();
  assert.equal(breadcrumb().href, centerUrl);
  active.controller.abort();
  active.cleanup?.();
  active.cleanup?.();
  assert.equal(breadcrumb().getAttribute('href'), backHref);
  document.querySelector(ASSIGNMENT_DETAILS_SELECTOR)!.innerHTML = nativeHeading;
  await flush();
  assert.equal(breadcrumb().getAttribute('href'), backHref);
});
