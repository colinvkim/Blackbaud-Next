import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { formatNativePageTitle, isResourceBoard, nativePageTitle, nativeResourceOuterWidth, resourceSearchTerms } from '../src/blackbaud/navigation.ts';
import { helpfulTabTitlesFeature, resourceSearchFeature } from '../src/features/navigation.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Cleanup, Feature } from '../src/shared/types.ts';

let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function fixture(html: string, route = '#studentmyday/progress') {
  dom = new JSDOM(html, { url: `https://example.myschoolapp.com/app/student?svcid=edu${route}` });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return dom.window;
}

function mount(feature: Feature) {
  const controller = new AbortController();
  const cleanup = feature.mount({ url: new URL(window.location.href), settings: DEFAULT_SETTINGS, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  return { controller, cleanup };
}

async function flush() {
  for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('tab title routes use meaningful labels and leave unsupported pages native', () => {
  fixture('<title>Native LMS</title>');
  const page = (route: string) => new URL(`https://example.myschoolapp.com/app/student${route}`);
  assert.equal(formatNativePageTitle(nativePageTitle(page('#studentmyday/progress'))!), 'Progress — Blackbaud');
  assert.equal(formatNativePageTitle(nativePageTitle(page('#studentmyday/schedule'))!), 'Schedule — Blackbaud');
  assert.equal(formatNativePageTitle(nativePageTitle(page('#studentmyday/assignment-center'))!), 'Assignment Center — Blackbaud');
  assert.equal(formatNativePageTitle(nativePageTitle(page('#resourceboard'))!), 'Resources — Blackbaud');
  assert.equal(nativePageTitle(page('#login')), null);
  assert.equal(nativePageTitle(page('#directory/123')), null);
  assert.equal(nativePageTitle(new URL('https://foreign.example/app/student#studentmyday/progress')), null);
  assert.equal(isResourceBoard(page('#resourceboard-extra')), false);
});

test('helpful titles retain the latest native title and restore it on disable', async () => {
  fixture('<title>Original native title</title>');
  const { controller } = mount(helpfulTabTitlesFeature);
  assert.equal(document.title, 'Progress — Blackbaud');
  document.title = 'New native title';
  await flush();
  assert.equal(document.title, 'Progress — Blackbaud');
  controller.abort();
  assert.equal(document.title, 'New native title');
  document.title = 'Native update after disabling';
  await flush();
  assert.equal(document.title, 'Native update after disabling');
});

test('late course headings, direct text changes, and replacements update the title', async () => {
  const win = fixture('<title>Native LMS</title><main id="site-main"><div id="academicclassnavmenu"><div class="section-heading"></div></div></main>', '#academicclass/123/undefined/assignments');
  const { controller } = mount(helpfulTabTitlesFeature);
  assert.equal(document.title, 'Assignments — Blackbaud');
  document.querySelector('.section-heading')!.insertAdjacentHTML('beforeend', '<div class="bb-page-heading">Geometry<a id="section-description-toggle">View details</a></div>');
  await flush();
  assert.equal(document.title, 'Geometry · Assignments — Blackbaud');
  document.querySelector('.bb-page-heading')!.firstChild!.textContent = 'Algebra';
  await flush();
  assert.equal(document.title, 'Algebra · Assignments — Blackbaud');
  const replacement = win.document.createElement('div');
  replacement.className = 'bb-page-heading';
  replacement.textContent = 'Biology';
  document.querySelector('.bb-page-heading')!.replaceWith(replacement);
  await flush();
  assert.equal(document.title, 'Biology · Assignments — Blackbaud');
  controller.abort();
  assert.equal(document.title, 'Native LMS');
});

test('hidden class headings are ignored and a native title written just before cleanup survives', async () => {
  fixture('<title>Native LMS</title><div id="academicclassnavmenu"><div class="section-heading"><div class="bb-page-heading" hidden>Old class</div><div class="bb-page-heading">Current class<a id="section-description-toggle">View details</a><span style="display:none">Another class in a dropdown</span></div></div></div>', '#academicclass/123/roster');
  const { cleanup } = mount(helpfulTabTitlesFeature);
  assert.equal(document.title, 'Current class · Roster — Blackbaud');
  document.querySelector('.bb-page-heading:not([hidden])')!.setAttribute('hidden', '');
  await flush();
  assert.equal(document.title, 'Roster — Blackbaud');
  document.title = 'Native title during teardown';
  cleanup?.();
  assert.equal(document.title, 'Native title during teardown');
});

test('assignment detail titles use the visible native breadcrumb title and follow detail changes', async () => {
  fixture('<title>Native LMS</title><h1 class="sky-theme-font-heading-1 display-inline"><a href="/assignments">Assignments</a><span>&gt; Chapter review</span></h1>');
  const url = new URL('https://example.myschoolapp.com/lms-assignment/assignment/assignment-student-view/123');
  const controller = new AbortController();
  const cleanup = helpfulTabTitlesFeature.mount({ url, settings: DEFAULT_SETTINGS, signal: controller.signal });
  cleanups.push(() => controller.abort());
  if (cleanup) cleanups.push(cleanup);
  assert.equal(document.title, 'Chapter review · Assignments — Blackbaud');
  document.querySelector('h1 > span')!.firstChild!.textContent = '> Unit assessment';
  await flush();
  assert.equal(document.title, 'Unit assessment · Assignments — Blackbaud');
  controller.abort();
  assert.equal(document.title, 'Native LMS');
});

test('resource search normalizes accents and divides multiple terms', () => {
  assert.deepEqual(resourceSearchTerms('  CAFÉ   financial  aid  '), ['cafe', 'financial', 'aid']);
});

const resourceFixture = `
<main id="site-main"><h1>Resource Board</h1><div id="board-container">
<div class="board-container isotope" style="position:relative;overflow:hidden;height:957px">
  <div class="container-container boxTopic isotope-item" id="library" style="position:absolute;left:0;top:0;transform:translate3d(0px, 0px, 0px);width:300px">
    <div class="containerFull whiteContainer1 wBtn"><h3>Library</h3><p>Research tools and books</p></div>
  </div>
  <div class="container-container boxTopic isotope-item" id="cafe" style="position:absolute;left:0;top:0;transform:translate3d(300px, 200px, 0px);width:300px">
    <div class="containerFull whiteContainer1 wBtn"><h3>Café</h3><p>Menus and meal plans</p></div>
  </div>
  <div class="container-container boxTopic isotope-item" id="aid" hidden style="position:absolute;left:0;top:0;transform:translate3d(0px, 400px, 0px)">
    <div class="containerFull whiteContainer1 wBtn"><h3>Financial Aid</h3></div>
  </div>
</div></div></main>`;

function search(query: string) {
  const input = document.querySelector<HTMLInputElement>('.bn-resource-search input')!;
  input.value = query;
  input.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
  return input;
}

test('resource search preserves native card actions and compacts the native absolute layout only while filtering', () => {
  const win = fixture(resourceFixture, '#resourceboard');
  const layout = document.querySelector<HTMLElement>('.board-container.isotope')!;
  const cafe = document.querySelector<HTMLElement>('#cafe')!;
  const originalLayoutStyle = layout.style.cssText;
  const originalCardStyle = cafe.getAttribute('style');
  let opened = 0;
  cafe.addEventListener('click', () => { opened += 1; });
  const { controller } = mount(resourceSearchFeature);
  const input = search('cafe meal');
  assert.equal(input.labels?.[0]?.textContent, 'Search resources');
  assert.equal(document.querySelector('.bn-resource-search [role="status"]')!.textContent, '1 of 2 resources');
  assert.equal(document.querySelector('#library')!.hasAttribute('data-blackbaud-next-resource-hidden'), true);
  assert.equal(cafe.hasAttribute('data-blackbaud-next-resource-hidden'), false);
  assert.equal(layout.hasAttribute('data-blackbaud-next-resource-filtered'), true);
  assert.equal(win.getComputedStyle(layout).display, 'grid');
  // JSDOM does not cascade stylesheet !important over inline positioning.
  // Verify preserved native geometry here; Chrome verifies the grid rendering.
  assert.equal(layout.style.height, '957px');
  assert.equal(layout.style.overflow, 'hidden');
  assert.equal(cafe.getAttribute('style'), originalCardStyle);
  cafe.click();
  assert.equal(opened, 1);
  document.querySelector<HTMLButtonElement>('.bn-resource-search button')!.click();
  assert.equal(input.value, '');
  assert.equal(document.activeElement, input);
  assert.equal(layout.hasAttribute('data-blackbaud-next-resource-filtered'), false);
  assert.equal(layout.style.cssText, originalLayoutStyle);
  assert.equal(cafe.getAttribute('style'), originalCardStyle);
  assert.equal(win.getComputedStyle(cafe).position, 'absolute');
  assert.equal(document.querySelector('#aid')!.hasAttribute('hidden'), true);
  search('nothing matches');
  assert.match(document.querySelector('.bn-resource-search [role="status"]')!.textContent ?? '', /No resources match/);
  controller.abort();
  assert.equal(document.querySelector('.bn-resource-search'), null);
  assert.equal(document.querySelector('[data-blackbaud-next-resource-hidden]'), null);
  assert.equal(document.querySelector('[data-blackbaud-next-resource-filtered]'), null);
  assert.equal(document.querySelector('#aid')!.hasAttribute('hidden'), true);
  assert.equal(layout.style.cssText, originalLayoutStyle);
  assert.equal(cafe.getAttribute('style'), originalCardStyle);
});

test('resource filtering follows new cards, native visibility, text changes, and layout replacement', async () => {
  fixture(resourceFixture, '#resourceboard');
  mount(resourceSearchFeature);
  search('library');
  const layout = document.querySelector<HTMLElement>('.board-container.isotope')!;
  layout.insertAdjacentHTML('beforeend', '<div id="new-card" class="container-container boxTopic isotope-item"><h3>Library help</h3></div>');
  await flush();
  assert.equal(document.querySelector('.bn-resource-search [role="status"]')!.textContent, '2 of 3 resources');
  document.querySelector('#new-card h3')!.firstChild!.textContent = 'Counseling';
  await flush();
  assert.equal(document.querySelector('#new-card')!.hasAttribute('data-blackbaud-next-resource-hidden'), true);
  document.querySelector('#library')!.setAttribute('hidden', '');
  await flush();
  assert.match(document.querySelector('.bn-resource-search [role="status"]')!.textContent ?? '', /0 of 2/);
  search('');
  assert.equal(document.querySelector('#library')!.hasAttribute('hidden'), true);
  const board = document.querySelector<HTMLElement>('#board-container')!;
  search('library');
  board.innerHTML = '<div class="board-container isotope" style="height:200px"><div id="replacement" class="container-container boxTopic isotope-item"><h3>Library reopened</h3></div></div>';
  await flush();
  assert.equal(document.querySelector('.bn-resource-search [role="status"]')!.textContent, '1 of 1 resources');
  assert.equal(layout.hasAttribute('data-blackbaud-next-resource-filtered'), false);
  assert.equal(document.querySelectorAll('.bn-resource-search').length, 1);
});

test('replacing the Resource Board removes the old toolbar and restores old native cards', async () => {
  fixture(resourceFixture, '#resourceboard');
  mount(resourceSearchFeature);
  search('cafe');
  const oldBoard = document.querySelector<HTMLElement>('#board-container')!;
  const newBoard = document.createElement('div');
  newBoard.id = 'board-container';
  newBoard.innerHTML = '<div class="board-container isotope"><div class="container-container boxTopic isotope-item"><h3>New resources</h3></div></div>';
  oldBoard.replaceWith(newBoard);
  await flush();
  assert.equal(document.querySelectorAll('.bn-resource-search').length, 1);
  assert.equal(oldBoard.querySelector('[data-blackbaud-next-resource-hidden]'), null);
  assert.equal(oldBoard.querySelector('[data-blackbaud-next-resource-filtered]'), null);
  assert.equal(document.querySelector<HTMLInputElement>('.bn-resource-search input')!.value, '');
});

test('native Isotope hiding and opacity remain authoritative while filtering and after clearing', async () => {
  fixture(resourceFixture, '#resourceboard');
  const { controller } = mount(resourceSearchFeature);
  search('library');
  const library = document.querySelector<HTMLElement>('#library')!;
  const cafe = document.querySelector<HTMLElement>('#cafe')!;
  library.style.opacity = '0';
  await flush();
  assert.match(document.querySelector('.bn-resource-search [role="status"]')!.textContent ?? '', /0 of 1/);
  cafe.classList.add('isotope-hidden');
  await flush();
  assert.match(document.querySelector('.bn-resource-search [role="status"]')!.textContent ?? '', /0 of 0/);
  assert.equal(library.hasAttribute('data-blackbaud-next-resource-hidden'), true);
  assert.equal(cafe.hasAttribute('data-blackbaud-next-resource-hidden'), true);
  search('');
  assert.equal(library.style.opacity, '0');
  assert.equal(cafe.classList.contains('isotope-hidden'), true);
  library.style.removeProperty('opacity');
  cafe.classList.remove('isotope-hidden');
  await flush();
  assert.equal(document.querySelector('.bn-resource-search [role="status"]')!.textContent, '2 resources');
  controller.abort();
  assert.equal(document.querySelector('[data-blackbaud-next-resource-hidden]'), null);
});

test('resource search preserves measurable native widths and margins across resize and restores custom layout properties', () => {
  const win = fixture(resourceFixture, '#resourceboard');
  const library = document.querySelector<HTMLElement>('#library')!;
  const cafe = document.querySelector<HTMLElement>('#cafe')!;
  const layout = document.querySelector<HTMLElement>('.board-container.isotope')!;
  library.style.marginRight = '8px';
  cafe.style.marginRight = '8px';
  layout.style.setProperty('--blackbaud-next-resource-column-width', '123px', 'important');
  const { controller } = mount(resourceSearchFeature);
  search('cafe');
  assert.equal(nativeResourceOuterWidth(library), 308);
  assert.equal(nativeResourceOuterWidth(cafe), 308);
  assert.equal(win.getComputedStyle(library).display, 'block');
  assert.equal(win.getComputedStyle(library).visibility, 'hidden');
  assert.equal(win.getComputedStyle(library).position, 'absolute');
  assert.equal(layout.style.getPropertyValue('--blackbaud-next-resource-column-width'), '308px');
  // A responsive native stylesheet changes widths at the viewport breakpoint.
  library.style.width = '269px';
  cafe.style.width = '269px';
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(nativeResourceOuterWidth(library), 277);
  assert.equal(nativeResourceOuterWidth(cafe), 277);
  assert.equal(layout.style.getPropertyValue('--blackbaud-next-resource-column-width'), '277px');
  search('');
  assert.equal(library.style.width, '269px');
  assert.equal(cafe.style.marginRight, '8px');
  assert.equal(layout.style.getPropertyValue('--blackbaud-next-resource-column-width'), '123px');
  assert.equal(layout.style.getPropertyPriority('--blackbaud-next-resource-column-width'), 'important');
  search('cafe');
  controller.abort();
  assert.equal(layout.style.getPropertyValue('--blackbaud-next-resource-column-width'), '123px');
  assert.equal(library.style.width, '269px');
});
