import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { nativeAppearancePage, nativeAppearancePageKind, nativeCourseRows, nativeLegacyAppearanceShell, nativeModernAppearanceRoute, nativeModernAppearanceShell, nativeProgressSummaryRow } from '../src/blackbaud/appearance.ts';
import { appearanceLayoutFeature, APPEARANCE_COURSE_ROW_ATTRIBUTE, APPEARANCE_PAGE_ATTRIBUTE, APPEARANCE_SHELL_ATTRIBUTE, APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE } from '../src/features/appearance-layout.ts';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { ASSIGNMENT_ROW_SELECTOR } from '../src/blackbaud/assignment-list.ts';
import type { Cleanup } from '../src/shared/types.ts';

const origin = 'https://example.myschoolapp.com';
const progress = '/app/student?svcid=edu#studentmyday/progress';
const shell = '<header id="site-header"></header><nav id="site-nav-container"></nav>';
const columns = ['col-md-3', 'col-md-2', 'col-md-2', 'col-md-2', 'col-md-3'];
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function courseRow(id = 'course', href = '?svcid=edu#academicclass/123/undefined/bulletinboard'): string {
  return `<div id="${id}" class="row">${columns.map((column, index) => `<div class="${column}">${index === 0 ? `<a href="${href}">Example course</a>` : index === 4 ? '<a href="mailto:teacher@example.org">Email teacher</a>' : '<button type="button">Native action</button>'}</div>`).join('')}</div>`;
}

function progressMain(rows = courseRow()): string {
  return `<main id="site-main"><div id="coursesContainer">${rows}</div></main>`;
}

function fixture(html: string, path = progress) {
  dom = new JSDOM(html, { url: `${origin}${path}` });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, previous] of originals) {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return dom.window;
}

function mount() {
  const abort = new AbortController();
  const cleanup = appearanceLayoutFeature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: abort.signal });
  cleanups.push(() => abort.abort());
  if (cleanup) cleanups.push(cleanup);
  return abort;
}

async function flush() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('appearance scopes only known root routes on authenticated school pages', () => {
  const routes = new Map([
    [progress, 'progress'],
    ['/app/student/#studentmyday/schedule/?date=2026-10-09', 'schedule'],
    ['/app/student#academicclass/123/assignments', 'class'],
    ['/app/student#academicclass/123/undefined/roster', 'class'],
    ['/app/student#academicclass/123/0/bulletinboard', 'class'],
    ['/app/faculty#directory/456?sort=name', 'directory'],
    ['/app/student#resourceboard/?category=school', 'resources'],
    ['/lms-assignment/assignment-center/student?svcid=edu', 'assignments'],
  ]);
  for (const [path, kind] of routes) assert.equal(nativeAppearancePageKind(new URL(`${origin}${path}`)), kind);
  for (const path of [
    '/app/student#studentmyday/progress/unknown', '/app/student#resourceboard/detail',
    '/app/student#academicclass/123/unknown', '/app/student#academicclass/123/0/assignments/456',
    '/app/student#academicclass/123other/roster', '/app/student#directory/456/profile/789',
    '/app/student#userprofile/789', '/login.aspx#studentmyday/progress',
    '/lms-assignment/assignment-center/unknown', '/app/faculty#studentmyday/progress',
  ]) assert.equal(nativeAppearancePageKind(new URL(`${origin}${path}`)), null, path);
  assert.equal(nativeAppearancePageKind(new URL(`https://foreign.example${progress}`)), null);
  assert.equal(nativeAppearancePageKind(new URL(`http://example.myschoolapp.com${progress}`)), null);
  assert.equal(nativeAppearancePageKind(new URL(`https://user:pass@example.myschoolapp.com${progress}`)), null);
});

test('course layout verifies the exact five-column shape and native same-page class link', () => {
  fixture(progressMain(courseRow('valid') + courseRow('foreign', 'https://foreign.example/app/student#academicclass/123/roster') + courseRow('otherpath', '/login.aspx#academicclass/123/roster') + courseRow('unknown', '#academicclass/123/unknown')));
  const main = document.getElementById('site-main')!;
  const url = new URL(window.location.href);
  assert.deepEqual(nativeCourseRows(main, url).map((row) => row.id), ['valid']);
  assert.deepEqual(nativeCourseRows(main, new URL(`${origin}/app/student#studentmyday/schedule`)), []);
  const valid = document.getElementById('valid')!;
  valid.children[2]!.className = 'col-md-3';
  assert.deepEqual(nativeCourseRows(main, url), []);
  valid.children[2]!.className = 'col-md-2 col-md-3';
  assert.deepEqual(nativeCourseRows(main, url), []);
});

test('each known legacy page needs its own unambiguous native component before receiving a page scope', () => {
  const examples = [
    { hash: '#studentmyday/progress', component: '<div id="coursesContainer"></div>', kind: 'progress' },
    { hash: '#studentmyday/schedule', component: '<table><tbody id="accordionSchedules"></tbody></table>', kind: 'schedule' },
    { hash: '#academicclass/123/undefined/assignments', component: '<div id="academicclassmaincontainer"></div>', kind: 'class' },
    { hash: '#directory/456', component: '<section><div id="overview"></div></section>', kind: 'directory' },
    { hash: '#resourceboard', component: '<div id="board-container"><div class="board-container isotope"></div></div>', kind: 'resources' },
  ];
  for (const { hash, component, kind } of examples) {
    const url = new URL(`${origin}/app/student${hash}`);
    const view = new JSDOM('<main id="site-main"></main>', { url: url.href });
    try {
      const main = view.window.document.getElementById('site-main')!;
      assert.equal(nativeAppearancePage(url, view.window.document), null, `${kind}: missing native component`);
      main.innerHTML = component;
      assert.equal(nativeAppearancePage(url, view.window.document)?.kind, kind);
      main.insertAdjacentHTML('beforeend', component);
      assert.equal(nativeAppearancePage(url, view.window.document), null, `${kind}: ambiguous native component`);
    } finally { view.window.close(); }
  }
});

test('missing or additional row content falls back without modifying native controls', () => {
  fixture(progressMain(courseRow('valid') + courseRow('short') + courseRow('extra')));
  document.getElementById('short')!.lastElementChild!.remove();
  document.getElementById('extra')!.append(document.createElement('button'));
  const button = document.querySelector<HTMLButtonElement>('#valid button')!;
  const link = document.querySelector<HTMLAnchorElement>('#valid a')!;
  const href = link.getAttribute('href');
  let clicks = 0;
  button.addEventListener('click', () => { clicks++; });
  mount();
  assert.equal(document.getElementById('valid')!.getAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), 'true');
  assert.equal(document.getElementById('short')!.hasAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), false);
  assert.equal(document.getElementById('extra')!.hasAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), false);
  assert.equal(document.querySelector('#valid button'), button);
  assert.equal(link.getAttribute('href'), href);
  button.click();
  assert.equal(clicks, 1);
});

test('a delayed native root is enhanced once it arrives and unchanged markup stays intact', async () => {
  fixture(shell);
  mount();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  document.body.insertAdjacentHTML('beforeend', progressMain());
  await flush();
  assert.equal(document.getElementById('site-main')!.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'progress');
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'legacy');
  assert.equal(document.getElementById('course')!.getAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), 'true');
  assert.equal(document.querySelectorAll('#coursesContainer > .row').length, 1);
});

test('a row loses its grid marker when the native shape changes and recovers after a rerender', async () => {
  fixture(shell + progressMain());
  mount();
  const row = document.getElementById('course')!;
  const last = row.lastElementChild!;
  last.remove();
  await flush();
  assert.equal(row.hasAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), false);
  row.append(last);
  await flush();
  assert.equal(row.getAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), 'true');
  row.querySelector('a')!.setAttribute('href', '#unknown');
  await flush();
  assert.equal(row.hasAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), false);
});

test('native root replacement restores detached elements and enhances only the new root', async () => {
  fixture(shell + progressMain());
  mount();
  const oldMain = document.getElementById('site-main')!;
  const oldRow = document.getElementById('course')!;
  oldMain.outerHTML = progressMain(courseRow('replacement'));
  await flush();
  assert.equal(oldMain.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  assert.equal(oldRow.hasAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), false);
  assert.equal(document.getElementById('replacement')!.getAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), 'true');
  assert.equal(document.getElementById('site-main')!.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'progress');
});

test('ambiguous roots and changed native shell structures remove their corresponding enhancements', async () => {
  fixture(shell + progressMain());
  mount();
  document.body.insertAdjacentHTML('beforeend', '<main id="site-main"></main>');
  await flush();
  assert.equal(nativeAppearancePage(new URL(window.location.href)), null);
  assert.equal(document.querySelector(`[${APPEARANCE_PAGE_ATTRIBUTE}]`), null);
  assert.equal(document.querySelector(`[${APPEARANCE_COURSE_ROW_ATTRIBUTE}]`), null);
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  document.querySelectorAll('#site-main')[1]!.remove();
  await flush();
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'legacy');
  document.getElementById('site-header')!.remove();
  await flush();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  assert.equal(document.getElementById('site-main')!.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'progress');
});

test('a native shell is themed only on the verified student portal', () => {
  fixture(progressMain());
  const url = new URL(window.location.href);
  assert.equal(nativeLegacyAppearanceShell(url), null);
  document.body.insertAdjacentHTML('afterbegin', shell);
  assert.equal(nativeLegacyAppearanceShell(url), document.documentElement);
  assert.equal(nativeLegacyAppearanceShell(new URL(`${origin}/app/faculty#directory/456`)), null);
  document.body.insertAdjacentHTML('afterbegin', '<header id="site-header"></header>');
  assert.equal(nativeLegacyAppearanceShell(url), null);
});

test('an unfamiliar student view retains the verified common shell without receiving page layout flags', () => {
  fixture(shell + '<main id="site-main"><section>Unfamiliar native page</section></main>', '/app/student#userprofile/789');
  mount();
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'legacy');
  assert.equal(document.querySelector(`[${APPEARANCE_PAGE_ATTRIBUTE}]`), null);
  assert.equal(document.querySelector(`[${APPEARANCE_COURSE_ROW_ATTRIBUTE}]`), null);
});

test('navigation clears stale layout markers even while Blackbaud retains the old view', async () => {
  const view = fixture(shell + progressMain());
  mount();
  view.history.pushState(null, '', '#userprofile/123');
  view.dispatchEvent(new view.PopStateEvent('popstate'));
  assert.equal(document.querySelector(`[${APPEARANCE_PAGE_ATTRIBUTE}]`), null);
  assert.equal(document.querySelector(`[${APPEARANCE_COURSE_ROW_ATTRIBUTE}]`), null);
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  document.getElementById('coursesContainer')!.insertAdjacentHTML('beforeend', courseRow('late'));
  await flush();
  assert.equal(document.querySelector(`[${APPEARANCE_COURSE_ROW_ATTRIBUTE}]`), null);
});

test('abort restores preexisting marker values and stops observing later native changes', async () => {
  fixture(shell + progressMain());
  const main = document.getElementById('site-main')!;
  const row = document.getElementById('course')!;
  main.setAttribute(APPEARANCE_PAGE_ATTRIBUTE, 'previous-page');
  row.setAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE, 'previous-row');
  document.documentElement.setAttribute(APPEARANCE_SHELL_ATTRIBUTE, 'previous-shell');
  const abort = mount();
  abort.abort();
  assert.equal(main.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'previous-page');
  assert.equal(row.getAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), 'previous-row');
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'previous-shell');
  main.outerHTML = progressMain(courseRow('later'));
  await flush();
  assert.equal(document.getElementById('site-main')!.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  assert.equal(document.getElementById('later')!.hasAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), false);
});

test('page appearance and master switches remove flags and reenabling uses current native markup', () => {
  fixture(shell + progressMain());
  const controller = new FeatureController([appearanceLayoutFeature]);
  cleanups.push(() => controller.dispose());
  const url = new URL(window.location.href);
  controller.update(url, DEFAULT_SETTINGS);
  assert.equal(document.getElementById('course')!.getAttribute(APPEARANCE_COURSE_ROW_ATTRIBUTE), 'true');
  controller.update(url, { ...DEFAULT_SETTINGS, pageAppearance: false });
  assert.equal(document.querySelector(`[${APPEARANCE_PAGE_ATTRIBUTE}]`), null);
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  controller.update(url, DEFAULT_SETTINGS);
  controller.update(url, { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(document.querySelector(`[${APPEARANCE_COURSE_ROW_ATTRIBUTE}]`), null);
  document.getElementById('course')!.replaceWith(document.createElement('section'));
  controller.update(url, DEFAULT_SETTINGS);
  assert.equal(document.getElementById('site-main')!.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'progress');
  assert.equal(document.querySelector(`[${APPEARANCE_COURSE_ROW_ATTRIBUTE}]`), null);
});

function assignmentRow(id = 123, href = `/lms-assignment/assignment/assignment-student-view/${id}`): string {
  return `<sky-repeater-item class="assignment-repeater-item"><app-assignment-title-link><a href="${href}">Example assignment</a></app-assignment-title-link></sky-repeater-item>`;
}

test('modern assignment appearance requires verified native controls and rows and never receives legacy shell flags', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar>' + assignmentRow(), '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  const link = document.querySelector('app-assignment-title-link a')!;
  link.setAttribute('href', 'https://foreign.example/assignment/123');
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  link.setAttribute('href', '/lms-assignment/assignment/assignment-student-view/456');
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
  document.body.insertAdjacentHTML('beforeend', assignmentRow(789, '/unknown'));
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
});

test('empty and unfamiliar modern assignment structures stay native until known rows arrive', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar>', '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  document.body.insertAdjacentHTML('beforeend', assignmentRow());
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
  document.body.insertAdjacentHTML('beforeend', '<sky-toolbar><input aria-label="Search items"></sky-toolbar>');
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
});

test('modern common navigation has its own verified shell while assignments load and falls back when native structure changes', async () => {
  fixture('<app-root><header id="site-header"></header><nav id="site-nav-container"><div id="site-nav-lower"></div></nav><sky-toolbar><input aria-label="Search items"></sky-toolbar></app-root>', '/lms-assignment/assignment-center/student?svcid=edu');
  const url = new URL(window.location.href);
  assert.equal(nativeLegacyAppearanceShell(url), null);
  assert.equal(nativeModernAppearanceShell(url), document.documentElement);
  const abort = mount();
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'modern');
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  const lowerNavigation = document.getElementById('site-nav-lower')!;
  lowerNavigation.id = 'changed-native-navigation';
  await flush();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  lowerNavigation.id = 'site-nav-lower';
  await flush();
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'modern');
  document.querySelector('app-root')!.insertAdjacentHTML('beforeend', assignmentRow());
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
  document.querySelector('app-root')!.insertAdjacentHTML('beforeend', '<div id="site-header"></div>');
  await flush();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  abort.abort();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
});

test('an assignment detail route with unverified native navigation does not authorize appearance changes', () => {
  fixture('<header id="site-header"></header><nav id="site-nav-container"><div id="site-nav-lower"></div></nav>', '/lms-assignment/assignment/assignment-student-view/123');
  assert.equal(nativeModernAppearanceShell(new URL(window.location.href)), null);
  mount();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
});

test('appearance validation does not read native assignment dates or statuses', () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar>' + assignmentRow(), '/lms-assignment/assignment-center/student?svcid=edu');
  const row = document.querySelector(ASSIGNMENT_ROW_SELECTOR)!;
  row.insertAdjacentHTML('beforeend', '<div class="assignment-center-middle-block"><div class="assignment-details sky-font-deemphasized"></div><app-assignment-status-display><button></button></app-assignment-status-display></div>');
  for (const element of row.querySelectorAll('.assignment-details, app-assignment-status-display button')) {
    Object.defineProperty(element, 'textContent', { get: () => { throw new Error('Unrelated metadata must not be parsed by appearance.'); } });
  }
  assert.equal(nativeAppearancePage(new URL(window.location.href))?.kind, 'assignments');
});

test('unrelated modern body mutations do not rescan assignment rows', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater>' + assignmentRow() + '</sky-repeater><aside id="unrelated"></aside>', '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  await flush();
  let scans = 0;
  const query = document.querySelectorAll.bind(document);
  document.querySelectorAll = ((selector: string) => {
    if (selector === ASSIGNMENT_ROW_SELECTOR) scans++;
    return query(selector);
  }) as Document['querySelectorAll'];
  const unrelated = document.getElementById('unrelated')!;
  unrelated.className = 'native-other-component';
  unrelated.style.display = 'block';
  unrelated.insertAdjacentHTML('beforeend', '<p>Unrelated status update</p>');
  await flush();
  unrelated.firstElementChild!.remove();
  await flush();
  assert.equal(scans, 0);
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
});

test('replacing the modern list root retains validation and an empty rerender returns to native styling', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater>' + assignmentRow() + '</sky-repeater>', '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  document.querySelector('sky-repeater')!.outerHTML = '<sky-repeater>' + assignmentRow(456, '/unknown') + '</sky-repeater>';
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  document.querySelector('app-assignment-title-link a')!.setAttribute('href', '/lms-assignment/assignment/assignment-student-view/456');
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
  document.querySelector('sky-repeater')!.replaceChildren();
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
});

test('moving an existing native row between list and standalone scopes preserves later href validation', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater>' + assignmentRow() + '</sky-repeater>', '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  const row = document.querySelector(ASSIGNMENT_ROW_SELECTOR)!;
  const link = row.querySelector('app-assignment-title-link a')!;
  document.body.append(row);
  await flush();
  link.setAttribute('href', '/unknown');
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  document.querySelector('sky-repeater')!.append(row);
  await flush();
  link.setAttribute('href', '/lms-assignment/assignment/assignment-student-view/123');
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
});

test('delayed row identification and changed native search labels update the verified appearance scope', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater-item><app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/123">Example assignment</a></app-assignment-title-link></sky-repeater-item>', '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  const row = document.querySelector('sky-repeater-item')!;
  row.className = 'assignment-repeater-item';
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
  const search = document.querySelector('sky-toolbar input')!;
  search.setAttribute('aria-label', 'Unknown native control');
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  search.setAttribute('aria-label', 'Search items');
  await flush();
  assert.equal(document.body.getAttribute(APPEARANCE_PAGE_ATTRIBUTE), 'assignments');
});

test('multiple title controls in one native assignment row trigger the structural fallback', async () => {
  fixture('<sky-toolbar><input aria-label="Search items"></sky-toolbar>' + assignmentRow(), '/lms-assignment/assignment-center/student?svcid=edu');
  mount();
  document.querySelector(ASSIGNMENT_ROW_SELECTOR)!.insertAdjacentHTML('beforeend', '<app-assignment-title-link><a href="https://foreign.example/assignment">Unexpected second title</a></app-assignment-title-link>');
  await flush();
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
});

function modernShellHtml(href = '/app/student#studentmyday'): string {
  return `<app-root><header id="site-header"></header><nav id="site-nav-container"><ul class="topnav"><li><a href="${href}">My Day</a></li></ul></nav><section id="modern-content"><button type="button">Native page action</button></section></app-root>`;
}

test('calendar and full assignment routes share only verified modern navigation styling', () => {
  const routes = [
    { path: '/sis-scheduling/user-calendar?date=2026-10-09', kind: 'calendar' },
    { path: '/lms-assignment/assignment/assignment-student-view/123?svcid=edu', kind: 'assignment' },
  ];
  for (const { path, kind } of routes) {
    const url = new URL(`${origin}${path}`);
    const view = new JSDOM(modernShellHtml(), { url: url.href });
    try {
      assert.equal(nativeModernAppearanceRoute(url), kind);
      assert.equal(nativeModernAppearanceShell(url, view.window.document), view.window.document.documentElement);
      assert.equal(nativeAppearancePageKind(url), null);
      assert.equal(nativeAppearancePage(url, view.window.document), null);
      assert.equal(view.window.document.getElementById('site-main'), null);
      assert.equal(view.window.document.getElementById('site-nav-lower'), null);
    } finally { view.window.close(); }
  }
});

test('calendar and detail shells require the native student root link and an unambiguous app identity', () => {
  const url = new URL(`${origin}/sis-scheduling/user-calendar?date=2026-10-09`);
  for (const href of ['/app/faculty#studentmyday', '/app/student#studentmyday/schedule', 'https://foreign.example/app/student#studentmyday', '/login.aspx#studentmyday', '/app/student#other']) {
    const view = new JSDOM(modernShellHtml(href), { url: url.href });
    try { assert.equal(nativeModernAppearanceShell(url, view.window.document), null, href); }
    finally { view.window.close(); }
  }
  const view = new JSDOM(modernShellHtml(), { url: url.href });
  try {
    const page = view.window.document;
    page.querySelector('.topnav a')!.removeAttribute('href');
    assert.equal(nativeModernAppearanceShell(url, page), null);
    page.querySelector('.topnav a')!.setAttribute('href', '/app/student?svcid=edu#studentmyday');
    assert.equal(nativeModernAppearanceShell(url, page), page.documentElement);
    page.body.insertAdjacentHTML('beforeend', '<app-root></app-root>');
    assert.equal(nativeModernAppearanceShell(url, page), null);
    page.querySelectorAll('app-root')[1]!.remove();
    page.getElementById('site-header')!.remove();
    assert.equal(nativeModernAppearanceShell(url, page), null);
  } finally { view.window.close(); }
});

test('unknown modern applications and invalid assignment detail routes stay outside the theme', () => {
  for (const path of ['/sis-scheduling/user-calendar/unknown', '/sis-scheduling/other', '/sis-scheduling/user-calendar#unknown', '/lms-assignment/assignment/assignment-student-view/0', '/lms-assignment/assignment/assignment-student-view/123other', '/lms-assignment/assignment/assignment-student-view/123/unknown']) {
    const url = new URL(`${origin}${path}`);
    const view = new JSDOM(modernShellHtml(), { url: url.href });
    try {
      assert.equal(nativeModernAppearanceRoute(url), null, path);
      assert.equal(nativeModernAppearanceShell(url, view.window.document), null, path);
    } finally { view.window.close(); }
  }
});

test('calendar shell rerenders and link changes retain native actions and clear stale theme markers', async () => {
  fixture(modernShellHtml(), '/sis-scheduling/user-calendar?date=2026-10-09');
  const abort = mount();
  const action = document.querySelector<HTMLButtonElement>('#modern-content button')!;
  let clicks = 0;
  action.addEventListener('click', () => { clicks++; });
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'modern');
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
  document.getElementById('site-nav-container')!.outerHTML = '<nav id="site-nav-container"><ul class="topnav"><li><a href="/app/faculty#studentmyday">My Day</a></li></ul></nav>';
  await flush();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  document.querySelector('.topnav a')!.setAttribute('href', '/app/student#studentmyday');
  await flush();
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'modern');
  action.click();
  assert.equal(clicks, 1);
  assert.equal(document.querySelector('#modern-content button'), action);
  abort.abort();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  document.querySelector('app-root')!.outerHTML = modernShellHtml();
  await flush();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
});

test('calendar content mutations do not revalidate the navigation shell, while duplicate app roots do', async () => {
  fixture(modernShellHtml(), '/sis-scheduling/user-calendar?date=2026-10-09');
  mount();
  await flush();
  let appReads = 0;
  const query = document.querySelectorAll.bind(document);
  document.querySelectorAll = ((selector: string) => {
    if (selector === 'app-root') appReads++;
    return query(selector);
  }) as Document['querySelectorAll'];
  const content = document.getElementById('modern-content')!;
  content.className = 'native-calendar-month';
  content.style.height = '400px';
  content.insertAdjacentHTML('beforeend', '<article>Native calendar event</article>');
  await flush();
  assert.equal(appReads, 0);
  document.body.insertAdjacentHTML('beforeend', '<app-root id="duplicate-app"></app-root>');
  await flush();
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  document.getElementById('duplicate-app')!.remove();
  await flush();
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'modern');
});

test('assignment detail shell cleanup respects page appearance and master switches', () => {
  fixture(modernShellHtml(), '/lms-assignment/assignment/assignment-student-view/123?svcid=edu');
  const controller = new FeatureController([appearanceLayoutFeature]);
  cleanups.push(() => controller.dispose());
  const url = new URL(window.location.href);
  controller.update(url, DEFAULT_SETTINGS);
  assert.equal(document.documentElement.getAttribute(APPEARANCE_SHELL_ATTRIBUTE), 'modern');
  controller.update(url, { ...DEFAULT_SETTINGS, pageAppearance: false });
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  controller.update(url, DEFAULT_SETTINGS);
  controller.update(url, { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(document.documentElement.hasAttribute(APPEARANCE_SHELL_ATTRIBUTE), false);
  assert.equal(document.body.hasAttribute(APPEARANCE_PAGE_ATTRIBUTE), false);
});

function progressSummary(id = 'summary'): string {
  return `<div class="row" id="${id}">${['performance', 'attendance'].map((name) => `<div id="${name}"><div class="ch col-md-4"><section class="bb-tile" id="${name}"><div class="bb-tile-title"><h2>${name}</h2><button type="button" data-toggle="collapse">Toggle details</button></div><div class="bb-tile-content">Native details</div></section></div></div>`).join('')}</div>`;
}

test('Progress summary recognition allows native duplicate IDs and preserves both cards and collapse actions', () => {
  fixture(shell + progressMain());
  document.getElementById('site-main')!.insertAdjacentHTML('afterbegin', progressSummary());
  const row = document.getElementById('summary')!;
  const title = row.querySelector('.bb-tile-title')!;
  const details = row.querySelector('.bb-tile-content')!;
  const collapse = row.querySelector<HTMLButtonElement>('button')!;
  let clicks = 0;
  collapse.addEventListener('click', () => { clicks++; });
  assert.equal(document.querySelectorAll('#performance').length, 2);
  assert.equal(document.querySelectorAll('#attendance').length, 2);
  assert.equal(nativeProgressSummaryRow(document.getElementById('site-main')!, new URL(window.location.href)), row);
  mount();
  assert.equal(row.getAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), 'true');
  assert.equal(row.querySelector('.bb-tile-title'), title);
  assert.equal(row.querySelector('.bb-tile-content'), details);
  assert.equal(row.querySelector('button'), collapse);
  collapse.click();
  assert.equal(clicks, 1);
  assert.equal(document.querySelector('#coursesContainer > .row')!.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
});

test('unknown summary hierarchies and ambiguous duplicate widget rows retain the native layout', () => {
  const variations: Array<(main: HTMLElement, row: HTMLElement) => void> = [
    (_main, row) => { row.append(row.ownerDocument.createElement('div')); },
    (_main, row) => { row.children[1]!.id = 'unknown'; },
    (_main, row) => { row.querySelector('.ch')!.className = 'ch col-md-6'; },
    (_main, row) => { row.querySelector('.ch')!.classList.add('col-md-6'); },
    (_main, row) => { row.querySelector('section')!.id = 'different-widget'; },
    (_main, row) => { row.querySelector('.bb-tile-title')!.remove(); },
    (_main, row) => { row.querySelector('.bb-tile-content')!.insertAdjacentHTML('afterend', '<div class="bb-tile-content">Unexpected content</div>'); },
    (_main, row) => { row.children[0]!.append(row.ownerDocument.createElement('button')); },
    (main) => { main.insertAdjacentHTML('beforeend', progressSummary('other-summary')); },
  ];
  for (const modify of variations) {
    const view = new JSDOM(shell + progressMain() + progressSummary(), { url: `${origin}${progress}` });
    try {
      const page = view.window.document;
      const main = page.getElementById('site-main')!;
      const row = page.getElementById('summary')!;
      main.prepend(row);
      modify(main, row);
      assert.equal(nativeProgressSummaryRow(main, new URL(view.window.location.href)), null);
    } finally { view.window.close(); }
  }
});

test('summary layout loses its marker after shape changes and follows a native replacement', async () => {
  fixture(shell + progressMain());
  document.getElementById('site-main')!.insertAdjacentHTML('afterbegin', progressSummary());
  mount();
  const old = document.getElementById('summary')!;
  const column = old.querySelector('.ch')!;
  column.className = 'ch col-md-6';
  await flush();
  assert.equal(old.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
  column.className = 'ch col-md-4';
  await flush();
  assert.equal(old.getAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), 'true');
  old.outerHTML = progressSummary('replacement-summary');
  await flush();
  assert.equal(old.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
  assert.equal(document.getElementById('replacement-summary')!.getAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), 'true');
});

test('summary markers restore previous attributes on abort and do not return after cleanup', async () => {
  fixture(shell + progressMain());
  document.getElementById('site-main')!.insertAdjacentHTML('afterbegin', progressSummary());
  const row = document.getElementById('summary')!;
  row.setAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE, 'previous-value');
  const abort = mount();
  abort.abort();
  assert.equal(row.getAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), 'previous-value');
  row.outerHTML = progressSummary('later-summary');
  await flush();
  assert.equal(document.getElementById('later-summary')!.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
});

test('Progress summary styling clears on appearance switches, master disable, and route departure', async () => {
  const view = fixture(shell + progressMain());
  document.getElementById('site-main')!.insertAdjacentHTML('afterbegin', progressSummary());
  const row = document.getElementById('summary')!;
  const controller = new FeatureController([appearanceLayoutFeature]);
  cleanups.push(() => controller.dispose());
  const url = new URL(window.location.href);
  controller.update(url, DEFAULT_SETTINGS);
  assert.equal(row.getAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), 'true');
  controller.update(url, { ...DEFAULT_SETTINGS, pageAppearance: false });
  assert.equal(row.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
  controller.update(url, DEFAULT_SETTINGS);
  controller.update(url, { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(row.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
  controller.update(url, DEFAULT_SETTINGS);
  view.history.pushState(null, '', '#studentmyday/schedule');
  view.dispatchEvent(new view.PopStateEvent('popstate'));
  await flush();
  assert.equal(row.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
  controller.update(new URL(window.location.href), DEFAULT_SETTINGS);
  assert.equal(row.hasAttribute(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE), false);
  assert.equal(nativeProgressSummaryRow(document.getElementById('site-main')!, new URL(window.location.href)), null);
});

function iconNavigation(modern = false, image = true): string {
  return `<header id="site-header"></header><nav id="site-nav-container"><ul class="topnav"><li>
    <a id="group-header-Classes" class="${modern ? 'root-nav-item' : ''}" href="#">
    ${image ? '<img src="//libs-w2.myschoolapp.com/p3-cache/img/48x48/classes_48.png">' : ''}
    <span class="desc"><span class="title">Classes</span></span>${modern ? '<sky-icon iconname="caret-down"></sky-icon>' : '<span class="caret"></span>'}
    </a></li></ul></nav>`;
}

function lowerIconNavigation(id = 'site-nav-lower'): string {
  return `<nav id="${id}"><ul><li><a id="progress-btn" href="/app/student?svcid=edu#studentmyday/progress"><i class="p3icon-progress"></i>Progress</a></li></ul></nav>`;
}

test('delayed lower navigation outside the page root is enhanced and a replacement restores detached native icons', async () => {
  fixture(iconNavigation() + progressMain());
  mount();
  document.body.insertAdjacentHTML('beforeend', lowerIconNavigation());
  await flush();
  const old = document.getElementById('site-nav-lower')!;
  const control = old.querySelector<HTMLAnchorElement>('a')!;
  const original = control.querySelector('i')!;
  let clicks = 0;
  control.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
  assert.equal(control.querySelector('svg')?.getAttribute('data-bn-navigation-icon'), 'chart-column');
  assert.equal(original.getAttribute('data-bn-native-icon'), 'replaced');
  control.click();
  assert.equal(clicks, 1);
  old.outerHTML = lowerIconNavigation('site-nav-bottom');
  await flush();
  assert.equal(old.querySelector('[data-bn-navigation-icon]'), null);
  assert.equal(original.hasAttribute('data-bn-native-icon'), false);
  const replacement = document.querySelector<HTMLAnchorElement>('#site-nav-bottom a')!;
  assert.equal(replacement.querySelector('[data-bn-navigation-icon]')?.getAttribute('data-bn-navigation-icon'), 'chart-column');
  replacement.querySelector('i')!.setAttribute('role', 'button');
  await flush();
  assert.equal(replacement.querySelector('[data-bn-navigation-icon]'), null, 'The newly discovered bottom root also observes native semantics');
});

test('named or interactive originals return to native presentation immediately while keeping their native attributes and actions', async () => {
  fixture(iconNavigation() + lowerIconNavigation() + progressMain());
  const control = document.querySelector<HTMLAnchorElement>('#group-header-Classes')!;
  const image = control.querySelector('img')!;
  const lower = document.querySelector<HTMLAnchorElement>('#progress-btn')!;
  const original = lower.querySelector('i')!;
  image.setAttribute('data-bn-native-icon', 'previous-image-value');
  original.setAttribute('data-bn-native-icon', 'previous-lower-value');
  const inlineStyle = 'display: inline-block; margin: 3px;';
  image.setAttribute('style', inlineStyle);
  let clicks = 0;
  control.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
  mount();
  await flush();
  for (const [attribute, value] of [['alt', 'Student photo'], ['aria-label', 'Open student profile'], ['tabindex', '0'], ['aria-controls', 'native-student-panel']] as const) {
    image.setAttribute(attribute, value);
    await flush();
    assert.equal(control.querySelector('[data-bn-navigation-icon]'), null, attribute);
    assert.equal(image.getAttribute('data-bn-native-icon'), 'previous-image-value');
    assert.equal(image.getAttribute(attribute), value);
    assert.equal(image.getAttribute('style'), inlineStyle);
    image.removeAttribute(attribute);
    await flush();
    assert.equal(control.querySelectorAll('[data-bn-navigation-icon]').length, 1, `Recover after ${attribute}`);
  }
  original.setAttribute('role', 'button');
  await flush();
  assert.equal(lower.querySelector('[data-bn-navigation-icon]'), null);
  assert.equal(original.getAttribute('data-bn-native-icon'), 'previous-lower-value');
  assert.equal(original.getAttribute('role'), 'button');
  original.setAttribute('role', 'presentation');
  await flush();
  assert.equal(lower.querySelectorAll('[data-bn-navigation-icon]').length, 1);
  control.click();
  assert.equal(clicks, 1);
  assert.equal(document.querySelector('#group-header-Classes'), control);
});

test('native navigation text updates revalidate decorative graphics without watching unrelated page text', async () => {
  fixture(iconNavigation() + lowerIconNavigation() + progressMain());
  mount();
  await flush();
  const control = document.getElementById('group-header-Classes')!;
  const text = control.querySelector('.title')!.firstChild!;
  text.nodeValue = '';
  await flush();
  assert.equal(control.querySelector('[data-bn-navigation-icon]'), null);
  text.nodeValue = 'Classes';
  await flush();
  assert.equal(control.querySelectorAll('[data-bn-navigation-icon]').length, 1);
  const lower = document.getElementById('progress-btn')!;
  const icon = lower.querySelector('i')!;
  icon.append(document.createTextNode(''));
  await flush();
  icon.firstChild!.nodeValue = 'Native action label';
  await flush();
  assert.equal(lower.querySelector('[data-bn-navigation-icon]'), null);
  assert.equal(icon.textContent, 'Native action label');
  let navigationReads = 0;
  const query = document.querySelectorAll.bind(document);
  document.querySelectorAll = ((selector: string) => {
    if (selector === '#site-nav-container') navigationReads++;
    return query(selector);
  }) as Document['querySelectorAll'];
  document.querySelector('#coursesContainer a')!.firstChild!.nodeValue = 'Updated native course title';
  await flush();
  assert.equal(navigationReads, 0, 'Unrelated page text does not rescan navigation');
});

test('a modern missing-image icon follows caret semantics and abort cancels pending reinjection', async () => {
  fixture(iconNavigation(true, false) + '<nav id="site-nav-lower"></nav>', '/lms-assignment/assignment-center/student?svcid=edu');
  const abort = mount();
  await flush();
  const control = document.getElementById('group-header-Classes')!;
  const caret = control.querySelector('sky-icon')!;
  assert.equal(control.querySelector('[data-bn-navigation-icon]')?.getAttribute('data-bn-navigation-icon'), 'book-open');
  caret.setAttribute('iconname', 'warning');
  await flush();
  assert.equal(control.querySelector('[data-bn-navigation-icon]'), null);
  assert.equal(control.querySelector('sky-icon'), caret);
  caret.setAttribute('iconname', 'caret-down');
  await flush();
  assert.equal(control.querySelectorAll('[data-bn-navigation-icon]').length, 1);
  control.querySelector('[data-bn-navigation-icon]')!.remove();
  abort.abort();
  await flush();
  assert.equal(control.querySelector('[data-bn-navigation-icon]'), null, 'An already queued native rerender cannot reinsert after abort');
  caret.setAttribute('iconname', 'warning');
  caret.setAttribute('iconname', 'caret-down');
  document.getElementById('site-nav-lower')!.outerHTML = lowerIconNavigation();
  await flush();
  assert.equal(document.querySelector('[data-bn-navigation-icon]'), null);
});

test('explicit icon feature cleanup restores originals and disconnects observers without requiring signal abort', async () => {
  fixture(iconNavigation() + lowerIconNavigation() + progressMain());
  const abort = new AbortController();
  const cleanup = appearanceLayoutFeature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: abort.signal });
  cleanups.push(() => abort.abort());
  if (cleanup) cleanups.push(cleanup);
  const image = document.querySelector<HTMLImageElement>('#group-header-Classes img')!;
  assert.equal(image.getAttribute('data-bn-native-icon'), 'replaced');
  assert.ok(cleanup);
  cleanup();
  assert.equal(abort.signal.aborted, false);
  assert.equal(document.querySelector('[data-bn-navigation-icon], [data-bn-native-icon]'), null);
  image.setAttribute('alt', 'Meaningful photo');
  image.removeAttribute('alt');
  document.getElementById('site-nav-lower')!.outerHTML = lowerIconNavigation('site-nav-bottom');
  await flush();
  assert.equal(document.querySelector('[data-bn-navigation-icon], [data-bn-native-icon]'), null);
});
