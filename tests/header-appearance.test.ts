import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { nativeHeaderAppearanceTargets } from '../src/blackbaud/header-appearance.ts';
import { createHeaderAppearance, HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE, HEADER_APPEARANCE_CURRENT_ATTRIBUTE, HEADER_APPEARANCE_PART_ATTRIBUTE } from '../src/features/header-appearance.ts';
import { HEADER_LOWER_ITEMS as lower, nativeHeaderFixtureHtml } from './fixtures/header.ts';

const origin = 'https://example.myschoolapp.com';
function fixture(modern = false, path = modern ? '/lms-assignment/assignment-center/student?svcid=edu' : '/app/student?svcid=edu#studentmyday/progress') {
  const dom = new JSDOM(nativeHeaderFixtureHtml(modern), { url: origin + path });
  return { dom, page: dom.window.document, url: new URL(dom.window.location.href) };
}

function dropdownFixture(page: Document) {
  const row = (label: string, href = '#native-destination') => `<li><a href="${href}"><span class="desc"><span class="title">${label}</span></span></a></li>`;
  const append = (control: Element, contents: string, classes = '') => {
    control.parentElement!.insertAdjacentHTML('beforeend', `<div class="subnavtop"></div><div class="subnav sec-75-bordercolor white-bgc sky-nav ${classes}">${contents}</div>`);
  };
  append(page.querySelector('#my-day')!, `<ul>${row('Progress')}<li class="divider"></li>${row('Schedule')}</ul>`);
  append(page.querySelector('#group-header-Classes')!, `<ul>${row('Algebra II', '#academicclass/111/0/bulletinboard')}</ul><ul>${row('Creative Writing', '#academicclass/222/0/bulletinboard')}</ul><ul class="subnavfooter"><li class="divider"></li>${row('<b>View Other Classes <i class="native-footer-icon"></i></b>', '#otherclasses')}</ul>`, 'subnav-multicol');
  append(page.querySelector('#group-header-Groups')!, `<ul><li class="divider-label"><h6>Teams</h6></li>${row('Team A')}<li class="divider"></li><li class="divider-label"><h6>Advisory</h6></li>${row('Advisory B')}</ul>`);
  append(page.querySelector('#group-header-News')!, `<ul>${row('Announcements')}</ul>`);
  append(page.querySelector('#directory-subnav')!, `<ul>${row('Students')}<li class="divider"></li>${row('My Contacts')}</ul>`);
  append(page.querySelector('#account-nav')!, `<ul>${row('Profile')}<li class="divider"></li>${row('Sign out', '/app/SignOut')}</ul>`);
  append(page.querySelector('a[href$="#searchresults"]')!, '<div style="padding:5px;color:black"><input id="site-search-input" type="text" aria-label="Search the portal"></div>');
}

function tabFocusFixture() {
  const native = fixture();
  const { dom, page } = native;
  const list = page.querySelector<HTMLElement>('#site-nav-lower > ul')!;
  const controls = [...list.querySelectorAll<HTMLAnchorElement>('a')];
  const frames = new Map<number, FrameRequestCallback>();
  const canceled: number[] = [];
  const scrolls: ScrollToOptions[] = [];
  let sequence = 0;
  dom.window.requestAnimationFrame = (callback) => { frames.set(++sequence, callback); return sequence; };
  dom.window.cancelAnimationFrame = (id) => { canceled.push(id); frames.delete(id); };
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: 300 });
  list.getBoundingClientRect = () => new dom.window.DOMRect(100, 0, 300, 55);
  list.scrollBy = ((options: ScrollToOptions) => { scrolls.push(options); }) as typeof list.scrollBy;
  list.style.scrollPaddingLeft = '4px';
  list.style.scrollPaddingRight = '4px';
  const layout = (control: HTMLElement, left: number, width = 100) => {
    control.getBoundingClientRect = () => new dom.window.DOMRect(left, 0, width, 55);
  };
  for (const control of controls) layout(control, 150);
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  };
  return { ...native, list, controls, frames, canceled, scrolls, layout, flush };
}

test('keyboard focus reveals clipped tabs after native scrolling without replacing native actions', () => {
  const { dom, page, url, list, controls, frames, scrolls, layout, flush } = tabFocusFixture();
  const appearance = createHeaderAppearance();
  try {
    const control = controls[3]!;
    const href = control.getAttribute('href');
    let actions = 0;
    control.addEventListener('click', (event) => { event.preventDefault(); actions++; });
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    layout(control, 470);
    control.focus();
    assert.equal(frames.size, 1);
    assert.deepEqual(scrolls, [], 'focus first leaves native scrolling alone');
    layout(control, 350);
    flush();
    assert.deepEqual(scrolls, [{ left: 54, behavior: 'instant' }], 'only the remaining clipped distance plus padding scrolls');
    assert.equal(page.activeElement, control);
    assert.equal(list.querySelectorAll('a')[3], control);
    assert.equal(control.getAttribute('href'), href);
    control.click();
    assert.equal(actions, 1);
    controls[0]!.focus();
    layout(controls[0]!, 90);
    flush();
    assert.deepEqual(scrolls[1], { left: -14, behavior: 'instant' });
    appearance.clear();
    control.click();
    assert.equal(actions, 2, 'cleanup keeps native listeners');
  } finally { appearance.clear(); dom.window.close(); }
});

test('tab focus scrolling ignores fitting links, stale focus, and foreign nested controls', () => {
  const { dom, page, url, controls, frames, scrolls, layout, flush } = tabFocusFixture();
  const appearance = createHeaderAppearance();
  try {
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    controls[0]!.focus();
    flush();
    assert.deepEqual(scrolls, [], 'a fitting link does not move its list');
    layout(controls[1]!, 350);
    controls[1]!.focus();
    const outside = page.createElement('button');
    page.body.append(outside);
    outside.focus();
    flush();
    assert.deepEqual(scrolls, [], 'focus moved before the scheduled correction');
    const nested = page.createElement('button');
    controls[1]!.append(nested);
    nested.focus();
    assert.equal(frames.size, 0, 'an unfamiliar nested control never schedules tab scrolling');
    assert.equal(page.activeElement, nested);
  } finally { appearance.clear(); dom.window.close(); }
});

test('tab focus scrolling aligns too-wide links at their reading-direction start', () => {
  const { dom, page, url, list, controls, scrolls, layout, flush } = tabFocusFixture();
  const appearance = createHeaderAppearance();
  try {
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    list.style.direction = 'ltr';
    layout(controls[0]!, 140, 400);
    controls[0]!.focus();
    flush();
    assert.deepEqual(scrolls[0], { left: 36, behavior: 'instant' });
    list.style.direction = 'rtl';
    layout(controls[1]!, 50, 400);
    controls[1]!.focus();
    flush();
    assert.deepEqual(scrolls[1], { left: 54, behavior: 'instant' });
  } finally { appearance.clear(); dom.window.close(); }
});

test('tab focus scrolling cancels scheduled work and removes listeners when verification or ownership ends', () => {
  const { dom, page, url, list, controls, frames, canceled, scrolls, layout, flush } = tabFocusFixture();
  const appearance = createHeaderAppearance();
  try {
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    layout(controls[0]!, 350);
    controls[0]!.focus();
    assert.equal(frames.size, 1);
    controls[0]!.parentElement!.append(page.createElement('button'));
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(frames.size, 0, 'unfamiliar native actions invalidate the list and cancel its correction');
    assert.equal(canceled.length, 1);
    controls[1]!.focus();
    assert.equal(frames.size, 0, 'invalidated list has no listener');
    controls[0]!.parentElement!.querySelector('button')!.remove();
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    controls[0]!.focus();
    assert.equal(frames.size, 1, 'a verified list recovers');
    const replacement = list.cloneNode(true);
    list.replaceWith(replacement);
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(frames.size, 0, 'a detached list cancels pending work');
    assert.equal(canceled.length, 2);
    list.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
    assert.equal(frames.size, 0);
    const next = page.querySelector<HTMLAnchorElement>('#progress-btn')!;
    next.focus();
    assert.equal(frames.size, 1);
    appearance.clear();
    assert.equal(frames.size, 0);
    assert.equal(canceled.length, 3);
    page.querySelector<HTMLAnchorElement>('#schedule-btn')!.focus();
    assert.equal(frames.size, 0, 'cleared list has no listener');
    flush();
    assert.deepEqual(scrolls, []);
  } finally { appearance.clear(); dom.window.close(); }
});

for (const modern of [false, true]) {
  test(`${modern ? 'modern' : 'legacy'} dropdown markers identify only menus belonging to verified native header actions`, () => {
    const { dom, page, url } = fixture(modern);
    try {
      dropdownFixture(page);
      page.body.insertAdjacentHTML('beforeend', '<div class="subnav"><ul><li><a href="#body-action">Unrelated body menu</a></li></ul></div>');
      const before = page.body.innerHTML;
      const targets = nativeHeaderAppearanceTargets(page, url);
      assert.equal(targets.filter(({ part }) => part === 'dropdown').length, 6);
      assert.equal(targets.filter(({ part }) => part === 'dropdown-classes').length, 1);
      assert.equal(targets.filter(({ part }) => part === 'dropdown-pointer').length, 7);
      assert.equal(targets.filter(({ part }) => part === 'dropdown-heading').length, 2);
      assert.equal(targets.filter(({ part }) => part === 'dropdown-footer').length, 1);
      assert.equal(targets.find(({ part }) => part === 'dropdown-search')?.element.querySelector('input')?.id, 'site-search-input');
      assert.equal(targets.some(({ element }) => element.textContent?.includes('Unrelated body menu')), false);
      assert.equal(page.body.innerHTML, before, 'the adapter does not alter native menu content');
    } finally { dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} dropdown updates retain native links, input state and listeners and restore existing attributes`, () => {
    const { dom, page, url } = fixture(modern);
    const appearance = createHeaderAppearance();
    try {
      dropdownFixture(page);
      const menu = page.querySelector<HTMLElement>('#group-header-Classes + .subnavtop + .subnav')!;
      menu.setAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE, 'native-original');
      const before = page.body.innerHTML;
      const link = menu.querySelector<HTMLAnchorElement>('a')!;
      const originalContent = [...link.childNodes];
      const input = page.querySelector<HTMLInputElement>('#site-search-input')!;
      input.value = 'unfinished search';
      let clicks = 0;
      link.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(menu.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown-classes');
      assert.equal(link.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown-link');
      assert.ok(originalContent.every((node) => node.parentNode === link));
      assert.equal(input.value, 'unfinished search');
      link.click();
      assert.equal(clicks, 1);
      appearance.clear();
      assert.equal(page.body.innerHTML, before);
      assert.equal(input.value, 'unfinished search');
      link.click();
      assert.equal(clicks, 2);
    } finally { appearance.clear(); dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} dropdowns recover from native rerenders and fall back per menu for unfamiliar content`, () => {
    const { dom, page, url } = fixture(modern);
    const appearance = createHeaderAppearance();
    try {
      dropdownFixture(page);
      const menu = page.querySelector<HTMLElement>('#group-header-Groups + .subnavtop + .subnav')!;
      const classes = page.querySelector<HTMLElement>('#group-header-Classes + .subnavtop + .subnav')!;
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      const oldLink = menu.querySelector<HTMLAnchorElement>('a')!;
      const known = '<ul><li><a href="#new-group"><span class="desc"><span class="title">New group</span></span></a></li></ul>';
      menu.innerHTML = known;
      const link = menu.querySelector<HTMLAnchorElement>('a')!;
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(oldLink.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false, 'detached nodes have their markers restored');
      assert.equal(link.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown-link');
      for (const unknown of [
        '<button type="button">New native action</button>',
        '<p>New menu layout</p>',
        '<ul><li><a href="#new">New row</a><button type="button">Row action</button></li></ul>',
        '<ul><li><a href="#new">Nested action <span role="button">More</span></a></li></ul>',
        '<ul><li class="divider-label"><h6>Heading <span tabindex="0">New focus target</span></h6></li></ul>',
        '<ul><li class="divider-label"><h6>Heading <span onclick="nativeAction()">New action</span></h6></li></ul>',
        '<ul>New native caption<li><a href="#new">New row</a></li></ul>',
      ]) {
        menu.innerHTML = known + unknown;
        appearance.update(nativeHeaderAppearanceTargets(page, url));
        assert.equal(menu.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false, unknown);
        assert.equal(menu.querySelector(`[${HEADER_APPEARANCE_PART_ATTRIBUTE}]`), null);
        assert.equal(classes.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown-classes', 'other verified menus continue');
        menu.innerHTML = known;
        appearance.update(nativeHeaderAppearanceTargets(page, url));
        assert.equal(menu.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown');
      }
      menu.after(menu.cloneNode(true));
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(menu.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false, 'duplicate sibling menus are ambiguous');
    } finally { appearance.clear(); dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} class-search toolbar does not invalidate native dropdown columns`, () => {
    const { dom, page, url } = fixture(modern);
    try {
      dropdownFixture(page);
      const menu = page.querySelector<HTMLElement>('#group-header-Classes + .subnavtop + .subnav')!;
      menu.setAttribute('data-blackbaud-next-class-menu', '');
      menu.insertAdjacentHTML('afterbegin', '<div class="bn-class-search" role="search"><label for="fixture-class-search">Find a class</label><input id="fixture-class-search" type="search"><button type="button" hidden>Clear</button><span class="bn-tool-status"></span></div>');
      let targets = nativeHeaderAppearanceTargets(page, url);
      assert.equal(targets.find(({ element }) => element === menu)?.part, 'dropdown-classes');
      assert.equal(targets.filter(({ element, part }) => part === 'dropdown-list' && menu.contains(element)).length, 2);
      assert.equal(targets.some(({ element }) => element.classList.contains('bn-class-search')), false, 'the class feature owns its toolbar');
      menu.removeAttribute('data-blackbaud-next-class-menu');
      targets = nativeHeaderAppearanceTargets(page, url);
      assert.equal(targets.some(({ element }) => menu.contains(element)), false, 'an unowned injected toolbar retains its layout');
    } finally { dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} header exposes only verified native cosmetics and keeps raw count data`, () => {
    const { dom, page, url } = fixture(modern);
    try {
      const targets = nativeHeaderAppearanceTargets(page, url);
      const roles = targets.map(({ part }) => part);
      assert.equal(roles.filter((part) => part === 'masthead-column').length, 1);
      assert.equal(roles.filter((part) => part === 'primary-navigation').length, 1);
      assert.equal(roles.filter((part) => part === 'primary-item').length, 7);
      assert.equal(roles.filter((part) => part === 'primary-title').length, 7);
      assert.equal(roles.filter((part) => part === 'primary-count').length, 3);
      assert.equal(roles.filter((part) => part === 'tool-count').length, 2);
      assert.equal(roles.filter((part) => part === 'tabs-navigation').length, 1);
      assert.equal(roles.filter((part) => part === 'tab-item').length, 4);
      assert.equal(roles.filter((part) => part === 'spacer').length, 1);
      assert.deepEqual(targets.flatMap(({ icon }) => icon ? [icon.kind] : []), ['search', 'file-text', 'mail']);
      assert.deepEqual(targets.filter(({ part }) => part === 'primary-count').map(({ element }) => element.textContent), ['14', '4', '5']);
      assert.equal(targets.find(({ part, current }) => part === 'primary-item' && current)?.element.id, 'my-day');
      const selected = targets.find(({ part, current }) => part === 'tab-item' && current)?.element;
      assert.equal(selected?.getAttribute('href'), lower[modern ? 2 : 0]![3]);
      assert.equal(page.querySelector('#site-user-container')!.hasAttribute('hidden'), !modern);
      assert.equal(page.querySelectorAll(`[${HEADER_APPEARANCE_PART_ATTRIBUTE}]`).length, 0, 'adapter is read-only');
    } finally { dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} update preserves native actions, labels and original nodes, then restores exactly`, () => {
    const { dom, page, url } = fixture(modern);
    const appearance = createHeaderAppearance();
    try {
      const before = page.body.innerHTML;
      const account = page.querySelector<HTMLAnchorElement>('#account-nav')!;
      const name = account.querySelector('.title')!;
      const originalNodes = [...name.childNodes];
      const search = page.querySelector<HTMLAnchorElement>('a[href$="#searchresults"]')!;
      const searchOriginal = search.querySelector<HTMLElement>(modern ? '.search' : 'i')!;
      let clicks = 0;
      account.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(page.querySelectorAll('[data-bn-navigation-icon]').length, 3);
      assert.equal(page.querySelectorAll('.bn-header-search-label').length, 1);
      assert.equal(search.textContent, 'Search');
      assert.equal(searchOriginal.getAttribute('data-bn-native-icon'), 'replaced');
      assert.equal(name.textContent, 'Alex Student');
      assert.ok(originalNodes.every((node) => node.parentNode === name));
      account.click();
      assert.equal(clicks, 1);
      const count = page.querySelector<HTMLElement>('[data-bn-header-part="tool-count"]')!;
      count.firstChild!.textContent = '3';
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(count.textContent, '3');
      assert.equal(count.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'tool-count');
      count.firstChild!.textContent = '2';
      appearance.clear();
      assert.equal(page.body.innerHTML, before);
      account.click();
      assert.equal(clicks, 2, 'native action remains attached after cleanup');
    } finally { appearance.clear(); dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} unread badge visibility follows native counts and falls back for unknown values`, () => {
    const { dom, page, url } = fixture(modern);
    const appearance = createHeaderAppearance();
    try {
      const count = page.querySelector<HTMLElement>('#inbox-link > .site-badge')!;
      const text = count.firstChild!;
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'true');
      assert.equal(count.textContent, '0');
      assert.equal(count.firstChild, text, 'visibility never replaces native count content');

      text.textContent = '7';
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'false');
      assert.equal(count.textContent, '7');
      text.textContent = ' 0 ';
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'true');
      assert.equal(count.textContent, ' 0 ', 'native whitespace is preserved');

      for (const unknown of ['99+', '', 'Loading', '-1']) {
        text.textContent = unknown;
        appearance.update(nativeHeaderAppearanceTargets(page, url));
        assert.equal(count.hasAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), false, unknown);
        assert.equal(count.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false, 'unknown badge values retain native layout');
        assert.equal(count.textContent, unknown);
        text.textContent = '0';
        appearance.update(nativeHeaderAppearanceTargets(page, url));
        assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'true', 'known counts recover');
      }

      const observer = new dom.window.MutationObserver(() => {});
      observer.observe(count, { attributes: true, attributeFilter: [HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE] });
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(observer.takeRecords().length, 0, 'unchanged counts do not mutate the visibility attribute');
      observer.disconnect();
      appearance.clear();
      assert.equal(count.hasAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), false);
      assert.equal(count.firstChild, text);
      assert.equal(count.textContent, '0');
    } finally { appearance.clear(); dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} unread badges restore previous attributes on cleanup and native replacements`, () => {
    const { dom, page, url } = fixture(modern);
    const appearance = createHeaderAppearance();
    try {
      const count = page.querySelector<HTMLElement>('#inbox-link > .site-badge')!;
      count.textContent = '4';
      count.setAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE, 'true');
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'false', 'a previous empty marker cannot hide a nonzero active count');
      const replacement = page.createElement('span');
      replacement.className = count.className;
      replacement.textContent = '0';
      count.replaceWith(replacement);
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'true', 'detached count restores its original attribute');
      assert.equal(count.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
      assert.equal(count.textContent, '4');
      assert.equal(replacement.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'true');
      appearance.clear();
      assert.equal(replacement.hasAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), false);
      assert.equal(replacement.textContent, '0');
      assert.equal(count.getAttribute(HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE), 'true');
    } finally { appearance.clear(); dom.window.close(); }
  });
}

test('unknown hosts, routes and ambiguous shells expose no header targets', () => {
  const { dom, page, url } = fixture();
  try {
    for (const path of ['https://foreign.example/app/student', `${origin}/login.aspx`, `${origin}/app/faculty`, `https://user:pass@example.myschoolapp.com/app/student`]) {
      assert.deepEqual(nativeHeaderAppearanceTargets(page, new URL(path)), []);
    }
    page.body.insertAdjacentHTML('beforeend', '<header id="site-header"></header>');
    assert.deepEqual(nativeHeaderAppearanceTargets(page, url), []);
  } finally { dom.window.close(); }
});

test('a lazily mounted modern account menu recognizes passive native separators and restores when their semantics change', () => {
  const { dom, page, url } = fixture(true);
  const appearance = createHeaderAppearance();
  try {
    const item = page.querySelector('#account-nav')!.parentElement!;
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(item.querySelector('[data-bn-header-part="dropdown"]'), null);
    item.insertAdjacentHTML('beforeend', '<div class="subnavtop"></div><div class="subnav"><ul><li><a href="/app/student#profile">Profile</a></li><li class="sep gray-bgc-ultradark"></li><li><a href="/app/SignOut">Sign out</a></li></ul></div>');
    const menu = item.querySelector<HTMLElement>('.subnav')!;
    const divider = menu.querySelector<HTMLElement>('.sep')!;
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(menu.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown');
    assert.equal(divider.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown-divider');
    divider.setAttribute('tabindex', '0');
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(menu.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
    assert.equal(divider.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
    assert.equal(divider.getAttribute('tabindex'), '0');
    divider.removeAttribute('tabindex');
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(menu.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'dropdown');
    appearance.clear();
    assert.equal(menu.querySelector(`[${HEADER_APPEARANCE_PART_ATTRIBUTE}]`), null);
    assert.equal(divider.className, 'sep gray-bgc-ultradark');
  } finally { appearance.clear(); dom.window.close(); }
});

test('modern spacer needs the observed empty class shape and a parent containing the verified header and navigation', () => {
  const { dom, page, url } = fixture(true);
  try {
    const spacer = page.querySelector<HTMLElement>('#site-top-spacer')!;
    assert.equal(spacer.classList.contains('site-top-spacer'), false);
    assert.equal(nativeHeaderAppearanceTargets(page, url).find(({ part }) => part === 'spacer')?.element, spacer);
    spacer.classList.remove('white-bg');
    assert.equal(nativeHeaderAppearanceTargets(page, url).some(({ part }) => part === 'spacer'), false);
    spacer.classList.add('white-bg');
    spacer.textContent = 'New native content';
    assert.equal(nativeHeaderAppearanceTargets(page, url).some(({ part }) => part === 'spacer'), false);
    spacer.textContent = '';
    const unrelated = page.createElement('section');
    page.body.append(unrelated);
    unrelated.append(spacer);
    assert.equal(nativeHeaderAppearanceTargets(page, url).some(({ part }) => part === 'spacer'), false);
  } finally { dom.window.close(); }
});

for (const modern of [false, true]) {
  test(`${modern ? 'modern' : 'legacy'} unknown lower navigation prevents fixed header layout and restores when known tabs return`, () => {
    const { dom, page, url } = fixture(modern);
    try {
      const lower = page.querySelector<HTMLElement>('#site-nav-lower')!;
      const original = lower.innerHTML;
      const spacer = () => nativeHeaderAppearanceTargets(page, url).some(({ part }) => part === 'spacer');
      assert.equal(spacer(), true);
      for (const unknown of [
        '<button type="button">New native lower action</button>',
        '<ul><li><a href="/app/student#unknown-page">New native page</a></li></ul>',
        '<p>Additional native navigation context</p>',
        '<input type="search" aria-label="New native lower search">',
      ]) {
        lower.innerHTML = original + unknown;
        assert.equal(spacer(), false, unknown);
        lower.innerHTML = original;
        assert.equal(spacer(), true, 'known four-tab structure recovers');
      }
      lower.querySelector('li')!.insertAdjacentHTML('beforeend', '<button type="button" aria-label="New native tab action"></button>');
      assert.equal(spacer(), false, 'unknown action inside a tab item also invalidates its list');
      lower.innerHTML = original;
      assert.equal(spacer(), true);
      const bottom = page.createElement('nav');
      bottom.id = 'site-nav-bottom';
      bottom.innerHTML = '<div><span></span></div>';
      page.body.append(bottom);
      lower.innerHTML = '<div><ul></ul></div>';
      assert.equal(spacer(), true, 'empty native wrappers and borders require no layout assumptions');
      bottom.insertAdjacentHTML('beforeend', '<span>Unknown lower caption</span>');
      assert.equal(spacer(), false);
      bottom.replaceChildren();
      lower.innerHTML = original;
      assert.equal(spacer(), true);
      const duplicate = bottom.cloneNode(true);
      page.body.append(duplicate);
      assert.equal(spacer(), false, 'ambiguous lower root cannot establish a safe stack height');
      duplicate.parentNode!.removeChild(duplicate);
      assert.equal(spacer(), true);
    } finally { dom.window.close(); }
  });

  test(`${modern ? 'modern' : 'legacy'} new native Notes or Messages graphics remove injected glyphs and preserve the original graphic`, () => {
    for (const action of ['notes', 'messages']) {
      for (const tag of ['img', 'i', 'svg', 'sky-icon']) {
        const { dom, page, url } = fixture(modern);
        const appearance = createHeaderAppearance();
        try {
          const control = page.querySelector<HTMLAnchorElement>(action === 'notes' ? 'a[href$="#message/officialnotes"]' : '#inbox-link')!;
          appearance.update(nativeHeaderAppearanceTargets(page, url));
          assert.equal(control.querySelectorAll('[data-bn-navigation-icon]').length, 1);
          const graphic = tag === 'svg' ? page.createElementNS('http://www.w3.org/2000/svg', tag) : page.createElement(tag);
          graphic.setAttribute('aria-label', 'New native utility graphic');
          control.prepend(graphic);
          const changed = nativeHeaderAppearanceTargets(page, url);
          assert.equal(changed.some(({ element }) => element === control), false, `${action}/${tag} must fall back`);
          appearance.update(changed);
          assert.equal(control.querySelector('[data-bn-navigation-icon]'), null);
          assert.equal(graphic.parentElement, control);
          assert.equal(graphic.getAttribute('aria-label'), 'New native utility graphic');
          assert.equal(graphic.hasAttribute('data-bn-native-icon'), false);
          graphic.remove();
          appearance.update(nativeHeaderAppearanceTargets(page, url));
          assert.equal(control.querySelectorAll('[data-bn-navigation-icon]').length, 1);
        } finally { appearance.clear(); dom.window.close(); }
      }
    }
  });
}

test('Calendar infers My Day and Schedule in the modern app and the Calendar destination in the legacy app', () => {
  const modern = fixture(true, '/sis-scheduling/user-calendar');
  const legacy = fixture(false, '/app/student#calendar');
  try {
    let targets = nativeHeaderAppearanceTargets(modern.page, modern.url);
    assert.equal(targets.find(({ part, current }) => part === 'primary-item' && current)?.element.id, 'my-day');
    assert.equal(targets.find(({ part, current }) => part === 'tab-item' && current)?.element.getAttribute('href'), lower[1]![3]);
    targets = nativeHeaderAppearanceTargets(legacy.page, legacy.url);
    assert.equal(targets.find(({ part, current }) => part === 'primary-item' && current)?.element.id, 'calendar-subnav');
    assert.equal(targets.some(({ part, current }) => part === 'tab-item' && current), false);
  } finally { modern.dom.window.close(); legacy.dom.window.close(); }
});

test('malformed or ambiguous native utility actions fall back independently and never reshape the masthead', () => {
  const { dom, page, url } = fixture();
  try {
    const search = page.querySelector<HTMLAnchorElement>('a[href$="#searchresults"]')!;
    search.parentElement!.after(search.parentElement!.cloneNode(true));
    const targets = nativeHeaderAppearanceTargets(page, url);
    assert.equal(targets.some(({ part }) => part === 'tool-search' || part === 'tools-list' || part === 'masthead-column' || part === 'spacer'), false);
    assert.equal(targets.filter(({ part }) => part === 'tool-count').length, 2);
    page.querySelector('#inbox-link')!.setAttribute('href', 'https://foreign.example/app/student#message/inbox');
    assert.equal(nativeHeaderAppearanceTargets(page, url).some(({ part }) => part === 'tool-messages'), false);
    page.querySelector('#account-nav .title')!.append(page.createElement('button'));
    assert.equal(nativeHeaderAppearanceTargets(page, url).some(({ part }) => part === 'tool-account'), false);
  } finally { dom.window.close(); }
});

test('changed count descriptions and interactive captions retain their entire native item layout', () => {
  const { dom, page, url } = fixture();
  try {
    const control = page.querySelector('#group-header-Classes')!;
    control.querySelector('b')!.setAttribute('onclick', 'nativeCountAction()');
    let targets = nativeHeaderAppearanceTargets(page, url);
    assert.equal(targets.some(({ element, part }) => part === 'primary-count' && control.contains(element)), false);
    assert.equal(targets.some(({ element, part }) => part === 'primary-description' && control.contains(element)), false);
    assert.equal(targets.some(({ element }) => control.contains(element)), false);
    assert.equal(targets.some(({ part }) => part === 'primary-navigation'), false);
    control.querySelector('b')!.removeAttribute('onclick');
    control.querySelector('.desc')!.append(' Additional native context');
    targets = nativeHeaderAppearanceTargets(page, url);
    assert.equal(targets.some(({ element, part }) => part === 'primary-description' && control.contains(element)), false);
    assert.equal(targets.some(({ element }) => control.contains(element)), false);
    const original = page.querySelector('#group-header-News img')!;
    original.setAttribute('aria-label', 'Meaningful native graphic');
    targets = nativeHeaderAppearanceTargets(page, url);
    assert.equal(targets.some(({ part }) => part === 'primary-navigation'), false);
    assert.equal(targets.filter(({ part }) => part === 'primary-item').length, 5);
  } finally { dom.window.close(); }
});

for (const modern of [false, true]) {
  test(`${modern ? 'modern' : 'legacy'} changed primary titles disable the whole grid and restore the affected item without altering native actions`, () => {
    const { dom, page, url } = fixture(modern);
    const appearance = createHeaderAppearance();
    try {
      const control = page.querySelector<HTMLAnchorElement>('#group-header-Classes')!;
      const list = control.closest('ul')!;
      const label = control.querySelector(modern ? '.title > div' : '.title')!;
      const spacer = page.querySelector('#site-top-spacer')!;
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(list.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'primary-navigation');
      const action = page.createElement('button');
      action.type = 'button';
      action.textContent = 'Native title action';
      let clicks = 0;
      action.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
      label.append(action);
      const changed = nativeHeaderAppearanceTargets(page, url);
      assert.equal(changed.some(({ part }) => part === 'primary-navigation'), false);
      assert.equal(changed.some(({ element }) => control.contains(element)), false);
      assert.equal(changed.filter(({ part }) => part === 'primary-item').length, 6);
      appearance.update(changed);
      assert.equal(list.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
      assert.equal(spacer.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
      assert.equal(control.querySelector(`[${HEADER_APPEARANCE_PART_ATTRIBUTE}]`), null);
      assert.equal(control.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
      assert.equal(action.parentElement, label);
      action.click();
      assert.equal(clicks, 1);
      action.remove();
      appearance.update(nativeHeaderAppearanceTargets(page, url));
      assert.equal(list.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'primary-navigation');
      assert.equal(control.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'primary-item');
    } finally { appearance.clear(); dom.window.close(); }
  });
}

test('route inference changes cosmetic current markers without overwriting native ARIA or active classes', () => {
  const { dom, page } = fixture();
  const appearance = createHeaderAppearance();
  try {
    const progress = page.querySelector('#progress-btn')!;
    progress.setAttribute('aria-current', 'page');
    progress.classList.add('active');
    appearance.update(nativeHeaderAppearanceTargets(page, new URL(origin + '/app/student#studentmyday/progress')));
    assert.equal(progress.getAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE), 'true');
    appearance.update(nativeHeaderAppearanceTargets(page, new URL(origin + '/app/student#studentmyday/schedule')));
    assert.equal(progress.hasAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE), false);
    assert.equal(page.querySelector('#schedule-btn')!.getAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE), 'true');
    assert.equal(progress.getAttribute('aria-current'), 'page');
    assert.ok(progress.classList.contains('active'));
    appearance.update(nativeHeaderAppearanceTargets(page, new URL(origin + '/app/student#resourceboard')));
    assert.equal(page.querySelector('#group-header-Resources')!.getAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE), 'true');
    assert.equal(page.querySelector('#my-day')!.hasAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE), false);
    appearance.clear();
    assert.equal(page.querySelectorAll(`[${HEADER_APPEARANCE_CURRENT_ATTRIBUTE}]`).length, 0);
  } finally { appearance.clear(); dom.window.close(); }
});

test('rerenders and invalidated native semantics restore detached nodes and previous marker values', () => {
  const { dom, page, url } = fixture();
  const appearance = createHeaderAppearance();
  try {
    const account = page.querySelector<HTMLAnchorElement>('#account-nav')!;
    account.setAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE, 'native-value');
    account.setAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE, 'native-current');
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    const oldName = account.querySelector('.title')!;
    account.querySelector('.desc')!.innerHTML = '<span class="title">New<br>Person</span>';
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(oldName.hasAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), false);
    assert.equal(oldName.textContent, 'AlexStudent');
    assert.equal(account.querySelector('.title')!.textContent, 'New Person');
    account.querySelector('.title')!.append(page.createElement('button'));
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(account.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'native-value');
    assert.equal(account.getAttribute(HEADER_APPEARANCE_CURRENT_ATTRIBUTE), 'native-current');
    assert.equal(account.querySelector('.title')!.textContent, 'NewPerson');
    const search = page.querySelector<HTMLAnchorElement>('a[href$="#searchresults"]')!;
    search.append('Native Search');
    appearance.update(nativeHeaderAppearanceTargets(page, url));
    assert.equal(search.querySelector('.bn-header-search-label'), null);
    appearance.clear();
    assert.equal(account.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE), 'native-value');
  } finally { appearance.clear(); dom.window.close(); }
});
