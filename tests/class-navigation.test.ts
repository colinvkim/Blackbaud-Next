import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { classDestinationForSection, currentClassSection, nativeClassMenuItems, NATIVE_CLASSES_MENU_SELECTOR } from '../src/blackbaud/class-navigation.ts';
import { classNavigationFeature } from '../src/features/class-navigation.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function classLink(id: number, name: string, mobile = false, extra = ''): string {
  return `<li ${extra}><a class="${mobile ? 'mobile-' : ''}group-page-link-1" data-taskid="1853" href="?svcid=edu#academicclass/${id}/0/bulletinboard">${name}</a></li>`;
}

function desktopMenu(links = classLink(123, 'Geometry') + classLink(456, 'Café Studies') + classLink(789, 'English I')): string {
  return `<div id="site-nav-container"><div id="topnav-containter"><ul class="topnav"><li class="twoline parentitem"><a id="group-header-Classes">Classes</a><div class="subnavtop"></div><div class="subnav sec-75-bordercolor white-bgc sky-nav subnav-multicol nav-visible"><ul>${links}</ul><ul class="subnavfooter"><li class="divider"></li><li><a href="#otherclasses">View Other Classes</a></li></ul></div></li></ul></div></div>`;
}

function mobileMenu(): string {
  return `<div id="site-mobile-sitenav"><ul><li class="clearfix"><i></i><a id="mobile-group-header-Classes">Classes</a><div class="app-mobile-level"><h2>Classes</h2><div class="app-mobile-back">Back</div><ul>${classLink(123, 'Geometry', true)}${classLink(456, 'Café Studies', true)}<li><a href="#otherclasses">View Other Classes</a></li></ul></div></li></ul></div>`;
}

function modernClassLink(id: number, name: string, href = `/app/student?svcid=edu#academicclass/${id}/0/bulletinboard`, task = '1853'): string {
  return `<li><a class="sec-25-bgc-hover" data-taskid="${task}" href="${href}"><span class="desc"><span class="title">${name}</span></span></a></li>`;
}

function modernMenu(links = Array.from({ length: 14 }, (_, index) => modernClassLink(index + 100, index === 0 ? 'Geometry' : `Course ${index + 1}`)).join('')): string {
  return `<nav id="site-nav-container"><ul class="topnav"><li><a id="group-header-Classes" class="root-nav-item" href="#"><div class="desc"><div class="title"><div>Classes</div></div></div></a><div class="subnavtop"></div><div class="subnav subnav-multicol"><ul>${links}</ul><ul class="subnavfooter"><li><a href="/app/student?svcid=edu#otherclasses"><span class="desc"><span class="title">View Other Classes</span></span></a></li></ul></div></li></ul></nav>`;
}

function fixture(html: string, route = '#academicclass/999/10/assignments') {
  dom = new JSDOM(html, { url: `https://example.myschoolapp.com/app/student?svcid=edu${route}` });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver })) {
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

function mount() {
  const controller = new AbortController();
  const cleanup = classNavigationFeature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  return { controller, cleanup };
}

function search(query: string, menu: Document | Element = document) {
  const input = menu.querySelector<HTMLInputElement>('.bn-class-search input')!;
  input.value = query;
  input.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
  return input;
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

test('class switching preserves the destination course, term and query while keeping the current supported section', () => {
  const current = new URL('https://example.myschoolapp.com/app/student?svcid=edu#academicclass/999/10/assignments/old-specific-id');
  const destination = classDestinationForSection('?svcid=edu&keep=value#academicclass/123/22/bulletinboard?sort=name', current);
  assert.equal(destination, 'https://example.myschoolapp.com/app/student?svcid=edu&keep=value#academicclass/123/22/assignments?sort=name');
  assert.equal(classDestinationForSection('#academicclass/456/undefined/bulletinboard', current), 'https://example.myschoolapp.com/app/student?svcid=edu#academicclass/456/undefined/assignments');
  assert.equal(classDestinationForSection('#academicclass/456/roster', current), 'https://example.myschoolapp.com/app/student?svcid=edu#academicclass/456/assignments');
  assert.equal(currentClassSection(new URL('https://example.myschoolapp.com/app/student#academicclass/1/0/roster')), 'roster');
});

test('unsupported sections, specific native destinations, and other pages retain native destinations', () => {
  const native = '?svcid=edu#academicclass/123/0/bulletinboard';
  for (const route of ['#studentmyday/progress', '#academicclass/999/0/topics', '#academicclass/999/0/unknown']) {
    assert.equal(classDestinationForSection(native, new URL(`https://example.myschoolapp.com/app/student${route}`)), native);
  }
  const current = new URL('https://example.myschoolapp.com/app/student#academicclass/999/0/roster');
  const specific = '#academicclass/123/0/assignments/native-specific-id';
  assert.equal(classDestinationForSection(specific, current), specific);
  assert.equal(classDestinationForSection('#academicclass/123/0/topics', current), '#academicclass/123/0/topics');
  assert.equal(classDestinationForSection('https://foreign.example/app/student#academicclass/123/0/bulletinboard', current), null);
  assert.equal(classDestinationForSection('https://user:secret@example.myschoolapp.com/app/student#academicclass/123/0/bulletinboard', current), null);
  assert.equal(classDestinationForSection('#athleticteam/123/0/bulletinboard', current), null);
  assert.equal(classDestinationForSection('#academicclass/123other/0/bulletinboard', current), null);
});

test('desktop class search filters names without altering native footer actions and restores native hrefs', () => {
  fixture(desktopMenu());
  const menu = document.querySelector<HTMLElement>(NATIVE_CLASSES_MENU_SELECTOR)!;
  const originalHrefs = [...menu.querySelectorAll('a')].map((link) => link.getAttribute('href'));
  const footer = menu.querySelector('.subnavfooter')!;
  const originalFooter = footer.innerHTML;
  const { controller } = mount();
  assert.equal(document.querySelector('.subnavtop .bn-class-search'), null);
  assert.equal(nativeClassMenuItems(menu, new URL(window.location.href)).length, 3);
  assert.match(menu.querySelector('a.group-page-link-1')!.getAttribute('href') ?? '', /\/123\/0\/assignments$/);
  const input = search('cafe studies');
  assert.equal(input.labels?.[0]?.textContent, 'Search classes');
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  assert.equal(menu.querySelectorAll('[data-blackbaud-next-class-hidden]').length, 2);
  assert.equal(footer.innerHTML, originalFooter);
  search('nonexistent class');
  assert.match(menu.querySelector('.bn-tool-status')!.textContent ?? '', /No classes match/);
  menu.querySelector<HTMLButtonElement>('.bn-class-search button')!.click();
  assert.equal(input.value, '');
  assert.equal(document.activeElement, input);
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  search('cafe');
  controller.abort();
  assert.equal(document.querySelector('.bn-class-search'), null);
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  assert.equal(menu.hasAttribute('data-blackbaud-next-class-menu'), false);
  assert.deepEqual([...menu.querySelectorAll('a')].map((link) => link.getAttribute('href')), originalHrefs);
  assert.equal(footer.innerHTML, originalFooter);
});

test('modern class search recognizes Angular rows, filters all classes, and restores native actions on cleanup', () => {
  const win = fixture(modernMenu(), '');
  dom!.reconfigure({ url: 'https://example.myschoolapp.com/lms-assignment/assignment-center/student?svcid=edu' });
  const menu = document.querySelector<HTMLElement>('.subnav')!;
  const before = menu.innerHTML;
  const link = menu.querySelector<HTMLAnchorElement>('a[data-taskid="1853"]')!;
  const nativeHref = link.getAttribute('href');
  let clicks = 0;
  link.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
  const { controller } = mount();
  assert.equal(nativeClassMenuItems(menu, new URL(win.location.href)).length, 14);
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '14 classes');
  search('geometry');
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 14 classes');
  assert.equal(menu.querySelectorAll('[data-blackbaud-next-class-hidden]').length, 13);
  assert.equal(menu.querySelector('.subnavfooter li')!.hasAttribute('data-blackbaud-next-class-hidden'), false);
  assert.equal(link.getAttribute('href'), nativeHref, 'modern pages keep their native class destination');
  link.click();
  assert.equal(clicks, 1);
  controller.abort();
  assert.equal(menu.innerHTML, before);
  link.click();
  assert.equal(clicks, 2);
});

test('modern task-based class recognition stays inside one verified Classes menu and excludes nested, footer and invalid routes', () => {
  fixture(modernMenu(modernClassLink(100, 'Geometry') +
    modernClassLink(101, 'Wrong task', undefined, '9999') +
    modernClassLink(102, 'Foreign', 'https://foreign.example/app/student#academicclass/102/0/bulletinboard') +
    modernClassLink(103, 'Credentials', 'https://user:secret@example.myschoolapp.com/app/student#academicclass/103/0/bulletinboard') +
    modernClassLink(104, 'Wrong app', '/different-app#academicclass/104/0/bulletinboard') +
    modernClassLink(105, 'Wrong route', '/app/student#athleticteam/105/0/bulletinboard') +
    '<li><div><ul>' + modernClassLink(106, 'Nested course') + '</ul></div></li>') +
    `<div id="unrelated-menu" class="subnav"><ul>${modernClassLink(107, 'Body course')}</ul></div>`);
  const menu = document.querySelector<HTMLElement>(NATIVE_CLASSES_MENU_SELECTOR)!;
  const url = new URL(window.location.href);
  menu.querySelector('.subnavfooter')!.insertAdjacentHTML('beforeend', modernClassLink(108, 'Footer course'));
  const items = () => nativeClassMenuItems(menu, url);
  assert.deepEqual(items().map(({ name }) => name), ['Geometry']);
  assert.deepEqual(nativeClassMenuItems(document.querySelector<HTMLElement>('#unrelated-menu')!, url), []);
  const control = document.querySelector<HTMLElement>('#group-header-Classes')!;
  control.classList.remove('root-nav-item');
  assert.deepEqual(items(), []);
  control.classList.add('root-nav-item');
  assert.equal(items().length, 1);
  control.setAttribute('href', '/other');
  assert.deepEqual(items(), []);
  control.setAttribute('href', '#');
  const duplicate = control.cloneNode(true);
  document.body.append(duplicate);
  assert.deepEqual(items(), []);
  duplicate.parentNode!.removeChild(duplicate);
  const duplicateMenu = menu.cloneNode(true);
  menu.after(duplicateMenu);
  assert.deepEqual(items(), []);
  duplicateMenu.parentNode!.removeChild(duplicateMenu);
  assert.equal(items().length, 1, 'verified menu recovers after ambiguity clears');
});

test('modern class row replacement preserves an active query and restores detached native rows', async () => {
  fixture(modernMenu(modernClassLink(100, 'Geometry') + modernClassLink(101, 'English')), '');
  dom!.reconfigure({ url: 'https://example.myschoolapp.com/lms-assignment/assignment-center/student?svcid=edu' });
  const { controller } = mount();
  const menu = document.querySelector<HTMLElement>('.subnav')!;
  search('geometry');
  const oldRow = menu.querySelectorAll<HTMLElement>('ul:not(.subnavfooter) > li')[1]!;
  assert.equal(oldRow.hasAttribute('data-blackbaud-next-class-hidden'), true);
  oldRow.outerHTML = modernClassLink(102, 'Geometry II');
  await flush();
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '2 of 2 classes');
  assert.equal(oldRow.hasAttribute('data-blackbaud-next-class-hidden'), false);
  assert.equal(menu.querySelectorAll('.bn-class-search').length, 1);
  assert.equal(menu.querySelector<HTMLInputElement>('.bn-class-search input')!.value, 'geometry');
  controller.abort();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
});

test('native class handlers receive unchanged normal and modified click events', () => {
  const win = fixture(desktopMenu());
  mount();
  const link = document.querySelector<HTMLAnchorElement>('a.group-page-link-1')!;
  const seen: Array<{ ctrl: boolean; meta: boolean; prevented: boolean; href: string | null }> = [];
  link.addEventListener('click', (event) => {
    seen.push({ ctrl: event.ctrlKey, meta: event.metaKey, prevented: event.defaultPrevented, href: link.getAttribute('href') });
    // Prevent JSDOM navigation after observing the event as a native handler.
    event.preventDefault();
  });
  for (const options of [{}, { ctrlKey: true }, { metaKey: true }]) {
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
  }
  assert.deepEqual(seen.map(({ ctrl, meta, prevented }) => ({ ctrl, meta, prevented })), [
    { ctrl: false, meta: false, prevented: false }, { ctrl: true, meta: false, prevented: false }, { ctrl: false, meta: true, prevented: false },
  ]);
  assert.ok(seen.every((event) => event.href?.endsWith('/123/0/assignments')));
});

test('mobile class search preserves the native heading, back action and other-classes action', () => {
  fixture(mobileMenu(), '#academicclass/999/0/roster');
  const { controller } = mount();
  const menu = document.querySelector<HTMLElement>('.app-mobile-level')!;
  const heading = menu.querySelector('h2')!;
  const back = menu.querySelector('.app-mobile-back')!;
  assert.equal(back.nextElementSibling?.className, 'bn-class-search');
  search('geometry', menu);
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 2 classes');
  assert.match(menu.querySelector('a.mobile-group-page-link-1')!.getAttribute('href') ?? '', /\/123\/0\/roster$/);
  assert.equal(menu.querySelector('[href="#otherclasses"]')!.closest('li')!.hasAttribute('data-blackbaud-next-class-hidden'), false);
  controller.abort();
  assert.equal(menu.querySelector('h2'), heading);
  assert.equal(menu.querySelector('.app-mobile-back'), back);
  assert.ok(menu.querySelector('[href="#otherclasses"]'));
});

test('native href and text updates are respected, including cleanup before observer delivery', async () => {
  fixture(desktopMenu());
  const { cleanup } = mount();
  const link = document.querySelector<HTMLAnchorElement>('a.group-page-link-1')!;
  const secondLink = document.querySelectorAll<HTMLAnchorElement>('a.group-page-link-1')[1]!;
  const newNative = '?svcid=edu#academicclass/321/77/bulletinboard';
  const secondNative = '?svcid=edu#academicclass/555/88/bulletinboard';
  link.setAttribute('href', newNative);
  secondLink.setAttribute('href', secondNative);
  link.firstChild!.textContent = 'New class name';
  await flush();
  assert.match(link.getAttribute('href') ?? '', /\/321\/77\/assignments$/);
  search('new class');
  assert.equal(document.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  link.setAttribute('href', '?svcid=edu#academicclass/654/55/bulletinboard');
  cleanup?.();
  assert.equal(link.getAttribute('href'), '?svcid=edu#academicclass/654/55/bulletinboard');
  assert.equal(secondLink.getAttribute('href'), secondNative);
});

test('late menu creation, replaced rows and whole-menu rerenders do not duplicate controls or lose the current query', async () => {
  fixture('<main></main>');
  const { controller } = mount();
  document.querySelector('main')!.innerHTML = desktopMenu();
  await flush();
  search('geometry');
  const menu = document.querySelector<HTMLElement>(NATIVE_CLASSES_MENU_SELECTOR)!;
  const oldLink = menu.querySelector('a.group-page-link-1')!;
  oldLink.parentElement!.outerHTML = classLink(111, 'Geometry II');
  await flush();
  assert.equal(document.querySelectorAll('.bn-class-search').length, 1);
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  assert.equal(oldLink.getAttribute('href'), '?svcid=edu#academicclass/123/0/bulletinboard');
  menu.outerHTML = '<div class="subnav"><ul>' + classLink(222, 'Geometry III') + '</ul><ul class="subnavfooter"><li><a href="#otherclasses">View Other Classes</a></li></ul></div>';
  await flush();
  assert.equal(document.querySelectorAll('.bn-class-search').length, 1);
  assert.equal(document.querySelector<HTMLInputElement>('.bn-class-search input')!.value, 'geometry');
  assert.equal(document.querySelector('.bn-tool-status')!.textContent, '1 of 1 classes');
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  controller.abort();
  assert.equal(document.querySelector('.bn-class-search'), null);
});

test('native hidden classes stay hidden and class search does not close the native menu on input clicks', () => {
  const win = fixture(desktopMenu(classLink(123, 'Geometry') + classLink(456, 'Hidden class', false, 'hidden')));
  const menu = document.querySelector<HTMLElement>(NATIVE_CLASSES_MENU_SELECTOR)!;
  let nativeClose = 0;
  menu.addEventListener('click', () => { nativeClose += 1; });
  mount();
  const input = search('geometry');
  input.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(nativeClose, 0);
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 1 classes');
  search('');
  assert.ok(menu.querySelector('li[hidden]'));
});

test('desktop and mobile menus share the current query without overwriting one another on native rerenders', async () => {
  fixture(desktopMenu() + mobileMenu());
  mount();
  const desktop = document.querySelector<HTMLElement>('.subnav')!;
  const mobile = document.querySelector<HTMLElement>('.app-mobile-level')!;
  search('geometry', desktop);
  assert.equal(mobile.querySelector<HTMLInputElement>('.bn-class-search input')!.value, 'geometry');
  assert.equal(desktop.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  assert.equal(mobile.querySelector('.bn-tool-status')!.textContent, '1 of 2 classes');
  mobile.querySelector('a.mobile-group-page-link-1')!.firstChild!.textContent = 'Geometry mobile';
  await flush();
  assert.equal(desktop.querySelector<HTMLInputElement>('.bn-class-search input')!.value, 'geometry');
  desktop.outerHTML = '<div class="subnav"><ul>' + classLink(222, 'Geometry replacement') + classLink(333, 'Other class') + '</ul></div>';
  await flush();
  const replacement = document.querySelector<HTMLElement>('.subnav')!;
  assert.equal(replacement.querySelector<HTMLInputElement>('.bn-class-search input')!.value, 'geometry');
  assert.equal(replacement.querySelector('.bn-tool-status')!.textContent, '1 of 2 classes');
  mobile.querySelector<HTMLButtonElement>('.bn-class-search button')!.click();
  assert.equal(replacement.querySelector<HTMLInputElement>('.bn-class-search input')!.value, '');
  assert.equal(document.querySelectorAll('[data-blackbaud-next-class-hidden]').length, 0);
});

test('Classes discovery stays inside native navigation during unrelated page mutations', async () => {
  const win = fixture(desktopMenu() + mobileMenu() + '<main id="site-main"><div id="coursesContainer"></div></main>');
  const scopes: ParentNode[] = [];
  const documentQuery = document.querySelectorAll.bind(document);
  document.querySelectorAll = ((selector: string) => {
    if (selector === NATIVE_CLASSES_MENU_SELECTOR) scopes.push(document);
    return documentQuery(selector);
  }) as typeof document.querySelectorAll;
  const elementQuery = win.Element.prototype.querySelectorAll;
  win.Element.prototype.querySelectorAll = function (this: Element, selector: string) {
    if (selector === NATIVE_CLASSES_MENU_SELECTOR) scopes.push(this);
    return elementQuery.call(this, selector);
  } as typeof elementQuery;
  mount();
  await flush();
  assert.ok(scopes.length > 0);
  assert.ok(scopes.every((scope) => scope === document.getElementById('site-nav-container') || scope === document.getElementById('site-mobile-sitenav')));
  scopes.length = 0;
  const courses = document.getElementById('coursesContainer')!;
  for (let index = 0; index < 20; index++) {
    courses.append(document.createComment(`Native update ${index}`));
    await flush();
  }
  courses.innerHTML = '<div class="native-row"><a href="#resourceboard">Resources</a></div>';
  await flush();
  courses.firstElementChild!.classList.add('updated');
  courses.firstElementChild!.setAttribute('hidden', '');
  await flush();
  assert.deepEqual(scopes, []);
  assert.equal(document.querySelectorAll('.bn-class-search').length, 2);
});

test('reused navigation IDs, delayed control IDs and menu classes preserve query and native cleanup', async () => {
  fixture(desktopMenu().replace('id="site-nav-container"', 'id="pending-navigation"'));
  const navigation = document.getElementById('pending-navigation')!;
  const control = navigation.querySelector<HTMLElement>('#group-header-Classes')!;
  const menu = navigation.querySelector<HTMLElement>('.subnav')!;
  const link = menu.querySelector<HTMLAnchorElement>('a.group-page-link-1')!;
  const nativeHref = link.getAttribute('href');
  const { controller } = mount();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  navigation.id = 'site-nav-container';
  await flush();
  search('geometry');
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  control.id = 'pending-classes';
  await flush();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  assert.equal(link.getAttribute('href'), nativeHref);
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  control.id = 'group-header-Classes';
  await flush();
  assert.equal(menu.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  menu.className = 'pending-menu';
  await flush();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  menu.className = 'subnav';
  await flush();
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  navigation.id = 'pending-navigation';
  await flush();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  assert.equal(link.getAttribute('href'), nativeHref);
  navigation.id = 'site-nav-container';
  await flush();
  assert.equal(menu.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  navigation.remove();
  await flush();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  assert.equal(link.getAttribute('href'), nativeHref);
  document.body.append(navigation);
  await flush();
  assert.equal(menu.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  controller.abort();
  navigation.id = 'pending-navigation';
  navigation.id = 'site-nav-container';
  await flush();
  assert.equal(menu.querySelector('.bn-class-search'), null);
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  assert.equal(link.getAttribute('href'), nativeHref);
});

test('modern validation reacts to controlling anchor and outside-root duplicate IDs', async () => {
  fixture(modernMenu(modernClassLink(100, 'Geometry') + modernClassLink(101, 'English')) + '<main id="site-main"><div id="outside"></div></main>');
  mount();
  const menu = document.querySelector<HTMLElement>('.subnav')!;
  const control = document.getElementById('group-header-Classes')!;
  const outside = document.getElementById('outside')!;
  search('geometry');
  const assertValid = () => {
    assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 2 classes');
    assert.equal(menu.querySelectorAll('[data-blackbaud-next-class-hidden]').length, 1);
  };
  const assertInvalid = () => {
    assert.equal(menu.querySelector('.bn-tool-status')!.textContent, 'No classes match your search (0 of 0).');
    assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  };
  assertValid();
  control.classList.remove('root-nav-item');
  await flush();
  assertInvalid();
  control.classList.add('root-nav-item');
  await flush();
  assertValid();
  control.setAttribute('href', '/other');
  await flush();
  assertInvalid();
  control.setAttribute('href', '#');
  await flush();
  assertValid();
  outside.id = 'group-header-Classes';
  await flush();
  assertInvalid();
  outside.removeAttribute('id');
  await flush();
  assertValid();
  outside.id = 'site-nav-container';
  await flush();
  assertInvalid();
  outside.removeAttribute('id');
  await flush();
  assertValid();
  const duplicate = control.cloneNode(true);
  document.body.append(duplicate);
  await flush();
  assertInvalid();
  duplicate.parentNode!.removeChild(duplicate);
  await flush();
  assertValid();
});

test('hidden navigation shells retain shared search while native row visibility changes remain respected', async () => {
  fixture(desktopMenu() + mobileMenu());
  const desktop = document.getElementById('site-nav-container')!;
  const mobile = document.getElementById('site-mobile-sitenav')!;
  mobile.hidden = true;
  mount();
  const menu = desktop.querySelector<HTMLElement>('.subnav')!;
  const mobileList = mobile.querySelector<HTMLElement>('.app-mobile-level')!;
  search('geometry', menu);
  assert.equal(mobileList.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  assert.equal(mobileList.querySelector('.bn-tool-status')!.textContent, '1 of 2 classes');
  const rows = menu.querySelector<HTMLElement>('ul:not(.subnavfooter)')!;
  rows.setAttribute('aria-hidden', 'true');
  await flush();
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, 'No classes match your search (0 of 0).');
  assert.equal(menu.querySelector('[data-blackbaud-next-class-hidden]'), null);
  rows.removeAttribute('aria-hidden');
  await flush();
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  desktop.hidden = true;
  mobile.hidden = false;
  await flush();
  assert.equal(menu.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  assert.equal(mobileList.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  search('cafe', mobileList);
  assert.equal(menu.querySelector('.bn-tool-status')!.textContent, '1 of 3 classes');
  assert.equal(menu.querySelector<HTMLInputElement>('input')!.value, 'cafe');
});

test('unexpected nested navigation roots share one menu and keep it mounted until all scopes release it', async () => {
  fixture(`<div id="site-mobile-sitenav">${desktopMenu()}</div>`);
  const outer = document.getElementById('site-mobile-sitenav')!;
  const inner = document.getElementById('site-nav-container')!;
  const { controller } = mount();
  search('geometry');
  assert.equal(document.querySelectorAll('.bn-class-search').length, 1);
  outer.id = 'pending-mobile';
  await flush();
  assert.equal(document.querySelectorAll('.bn-class-search').length, 1);
  assert.equal(inner.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  inner.id = 'pending-desktop';
  await flush();
  assert.equal(document.querySelector('.bn-class-search'), null);
  assert.equal(document.querySelector('[data-blackbaud-next-class-hidden]'), null);
  inner.id = 'site-nav-container';
  await flush();
  assert.equal(inner.querySelector<HTMLInputElement>('input')!.value, 'geometry');
  controller.abort();
  assert.equal(document.querySelector('.bn-class-search'), null);
});

test('class search yields to real timers and stops mutating after mount, input and Clear', { timeout: 5000 }, async () => {
  // A child deadline makes an observer loop fail without starving this runner.
  // Use real MutationObserver/timers rather than a bounded microtask flush.
  const script = `
    import { JSDOM } from 'jsdom';
    import { classNavigationFeature } from './src/features/class-navigation.ts';
    import { DEFAULT_SETTINGS } from './src/shared/settings.ts';
    const dom = new JSDOM(${JSON.stringify(desktopMenu())}, { url: 'https://example.myschoolapp.com/app/student?svcid=edu#academicclass/999/0/assignments' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver })) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    const controller = new AbortController();
    const cleanup = classNavigationFeature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: controller.signal });
    const menu = document.querySelector('.subnav');
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(menu, { childList: true, subtree: true, attributes: true, characterData: true });
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const beforeQuiet = mutations;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { beforeQuiet, afterQuiet: mutations };
    };
    const mounted = await settle();
    const input = menu.querySelector('input');
    input.value = 'geometry';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const searched = await settle();
    const searchedStatus = menu.querySelector('.bn-tool-status').textContent;
    menu.querySelector('.bn-class-search button').click();
    const cleared = await settle();
    const clearedStatus = menu.querySelector('.bn-tool-status').textContent;
    observer.disconnect();
    controller.abort();
    cleanup?.();
    dom.window.close();
    process.stdout.write(JSON.stringify({ mounted, searched, cleared, searchedStatus, clearedStatus }));
  `;
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), timeout: 3000,
  });
  const result = JSON.parse(stdout) as {
    mounted: { beforeQuiet: number; afterQuiet: number };
    searched: { beforeQuiet: number; afterQuiet: number };
    cleared: { beforeQuiet: number; afterQuiet: number };
    searchedStatus: string;
    clearedStatus: string;
  };
  for (const phase of [result.mounted, result.searched, result.cleared]) {
    assert.equal(phase.afterQuiet, phase.beforeQuiet);
    assert.ok(phase.afterQuiet < 100, 'Menu mutations should settle after each interaction.');
  }
  assert.equal(result.searchedStatus, '1 of 3 classes');
  assert.equal(result.clearedStatus, '3 classes');
});
