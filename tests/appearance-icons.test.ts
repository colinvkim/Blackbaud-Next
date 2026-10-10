import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { nativeNavigationIconTargets } from '../src/blackbaud/appearance-icons.ts';

const origin = 'https://example.myschoolapp.com';
const legacyUrl = `${origin}/app/student?svcid=edu#studentmyday/progress`;
const modernUrl = `${origin}/lms-assignment/assignment-center/student?svcid=edu`;
const top = [
  ['group-header-Classes', 'Classes', 'classes_48.png', '#'],
  ['group-header-Groups', 'Groups', 'groups.png', '/app/SignOut'],
  ['group-header-Resources', 'Resources', 'resources.png', '/app/student?svcid=edu#resourceboard'],
  ['group-header-News', 'News', 'news.png', '#'],
  ['calendar-subnav', 'Calendar', 'calendar.png', '/app/student?svcid=edu#calendar'],
  ['directory-subnav', 'Directories', 'directory.png', '#'],
] as const;
const lower = [
  ['progress-btn', 'p3icon-progress', '/app/student?svcid=edu#studentmyday/progress'],
  ['schedule-btn', 'p3icon-schedule', '/app/student?svcid=edu#studentmyday/schedule'],
  ['assignment-center-btn', 'p3icon-assignments', '/lms-assignment/assignment-center/student/?svcid=edu'],
  ['course-requests-btn', 'p3icon-courseRequest', '/edu-self-registration/student-course-requests?svcid=edu'],
] as const;

function html(modern = false): string {
  return `<header id="site-header"></header><nav id="site-nav-container"><ul class="topnav">
    <li><a id="myday" class="${modern ? 'root-nav-item' : ''}" href="/app/student#studentmyday"><span class="dayicon">9</span><span class="desc"><span class="title">My Day</span></span></a></li>
    ${top.map(([id, title, file, href]) => `<li><a id="${id}" class="${modern ? 'root-nav-item' : ''}" href="${modern && id === 'group-header-Groups' ? '#' : !modern ? href.replace('/app/student', '') : href}"><img src="//libs-w2.myschoolapp.com/p3-cache/img/48x48/${file}"><${modern ? 'div' : 'span'} class="desc"><${modern ? 'div' : 'span'} class="title">${modern ? `<div>${title}</div>` : title}</${modern ? 'div' : 'span'}></${modern ? 'div' : 'span'}><${modern ? 'sky-icon iconname="caret-down"' : 'span class="caret"'}></${modern ? 'sky-icon' : 'span'}></a></li>`).join('')}
    </ul></nav><nav id="site-nav-lower"><ul>${lower.map(([id, icon, href]) => `<li><a ${modern ? '' : `id="${id}"`} href="${href}"><i class="${icon}"></i>Native navigation</a></li>`).join('')}</ul></nav>
    ${modern ? '<app-root></app-root>' : '<main id="site-main"></main>'}`;
}

function fixture(modern: boolean, inspect: (page: Document, url: URL) => void, path = modern ? modernUrl : legacyUrl): void {
  const dom = new JSDOM(html(modern), { url: path });
  try { inspect(dom.window.document, new URL(path)); } finally { dom.window.close(); }
}

test('known legacy and modern navigation map decorative originals while preserving native date content, carets, text, and actions', () => {
  for (const modern of [false, true]) fixture(modern, (page, url) => {
    const before = page.documentElement.outerHTML;
    const group = page.querySelector<HTMLAnchorElement>('#group-header-Groups')!;
    const href = group.getAttribute('href');
    let clicks = 0;
    group.addEventListener('click', (event) => { event.preventDefault(); clicks++; });
    const targets = nativeNavigationIconTargets(page, url);
    assert.deepEqual(targets.map(({ kind }) => kind), ['house', 'book-open', 'users-round', 'folder-closed', 'newspaper', 'calendar-outline', 'book-user', 'chart-column', 'clock-3', 'clipboard-check', 'graduation-cap']);
    assert.ok(targets.every(({ control, original }) => original?.parentElement === control));
    assert.equal(targets.find(({ kind }) => kind === 'house')?.original, page.querySelector('#myday .dayicon'));
    assert.ok(targets.every(({ original }) => !original?.matches('.caret, sky-icon')));
    assert.equal(page.documentElement.outerHTML, before, 'The adapter never changes native content, attributes, or navigation');
    assert.equal(targets.find(({ kind }) => kind === 'users-round')!.control, group);
    group.click();
    assert.equal(clicks, 1);
    assert.equal(group.getAttribute('href'), href);
  });
});

test('stable native IDs work with localized titles instead of guessing translated labels', () => {
  fixture(true, (page, url) => {
    page.querySelector('#group-header-Classes .title')!.textContent = 'Cours';
    assert.equal(nativeNavigationIconTargets(page, url).find(({ control }) => control.id === 'group-header-Classes')?.kind, 'book-open');
    page.querySelector('#group-header-Classes')!.id = 'unknown-classes';
    page.querySelector('#unknown-classes .title')!.textContent = 'Classes';
    assert.equal(nativeNavigationIconTargets(page, url).some(({ control }) => control.id === 'unknown-classes'), false);
  });
});

test('My Day needs one safe native root destination and an unambiguous passive day badge', () => {
  const invalidLinks = [
    '/app/faculty#studentmyday', '/app/student#studentmyday/unknown',
    'https://foreign.example/app/student#studentmyday',
    'https://user:pass@example.myschoolapp.com/app/student#studentmyday',
  ];
  for (const href of invalidLinks) fixture(false, (page, url) => {
    page.querySelector('#myday')!.setAttribute('href', href);
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'house'), false, href);
  });
  const changes: ((control: Element) => void)[] = [
    (control) => control.append(control.querySelector('.dayicon')!.cloneNode(true)),
    (control) => control.querySelector('.dayicon')!.remove(),
    (control) => { control.querySelector('.dayicon')!.textContent = '0'; },
    (control) => { control.querySelector('.dayicon')!.textContent = '32'; },
    (control) => control.querySelector('.dayicon')!.setAttribute('aria-label', 'Open today'),
    (control) => control.querySelector('.dayicon')!.setAttribute('role', 'button'),
    (control) => control.querySelector('.dayicon')!.setAttribute('onclick', 'openDay()'),
    (control) => { control.querySelector('.dayicon')!.innerHTML = '<button>9</button>'; },
    (control) => control.querySelector('.desc')!.remove(),
    (control) => control.append(control.querySelector('.desc')!.cloneNode(true)),
    (control) => control.prepend(control.ownerDocument.createElement('img')),
  ];
  for (const modern of [false, true]) for (const change of changes) fixture(modern, (page, url) => {
    change(page.querySelector('#myday')!);
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'house'), false);
    assert.equal(nativeNavigationIconTargets(page, url).filter(({ kind }) => kind !== 'house').length, 10);
  });
  fixture(false, (page, url) => {
    const control = page.querySelector('#myday')!;
    control.parentElement!.parentElement!.append(control.parentElement!.cloneNode(true));
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'house'), false, 'Two native My Day controls are ambiguous');
  });
  fixture(true, (page, url) => {
    page.querySelector('#myday')!.classList.remove('root-nav-item');
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'house'), false);
  });
});

test('My Day recognizes a live native date and rerendered badge without rewriting content or its accessible label', () => {
  for (const modern of [false, true]) fixture(modern, (page, url) => {
    const control = page.querySelector<HTMLAnchorElement>('#myday')!;
    control.setAttribute('aria-label', 'My Day');
    control.querySelector('.title')!.textContent = 'Ma journée';
    const badge = control.querySelector('.dayicon')!;
    const before = control.outerHTML;
    assert.equal(nativeNavigationIconTargets(page, url).find(({ kind }) => kind === 'house')?.original, badge);
    assert.equal(control.outerHTML, before);
    badge.textContent = '10';
    badge.setAttribute('data-bn-native-icon', 'replaced');
    const ours = page.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ours.setAttribute('data-bn-navigation-icon', 'house');
    control.prepend(ours);
    assert.equal(nativeNavigationIconTargets(page, url).find(({ kind }) => kind === 'house')?.original, badge);
    const replacement = badge.cloneNode(true) as Element;
    replacement.textContent = '11';
    replacement.removeAttribute('data-bn-native-icon');
    badge.replaceWith(replacement);
    const target = nativeNavigationIconTargets(page, url).find(({ kind }) => kind === 'house')!;
    assert.equal(target.original, replacement);
    assert.equal(target.original?.textContent, '11');
    assert.equal(control.getAttribute('aria-label'), 'My Day');
    assert.equal(control.querySelector('.title')!.textContent, 'Ma journée');
    assert.equal(badge.textContent, '10');
  });
});

test('native My Day month/day badges work without an ID across the known My Day destinations and reject changed structure', () => {
  for (const modern of [false, true]) for (const path of ['studentmyday', 'studentmyday/progress', 'studentmyday/schedule', 'studentmyday/assignment-center']) fixture(modern, (page, url) => {
    const control = page.querySelector<HTMLAnchorElement>('#myday')!;
    control.removeAttribute('id');
    control.setAttribute('href', `?svcid=edu#${path}`);
    if (modern) control.setAttribute('href', `/app/student?svcid=edu#${path}`);
    control.querySelector('.dayicon')!.outerHTML = '<div class="dayicon pri-50-bgc"><span class="month white-fgc">OCT</span><span class="day white-bgc">10</span></div>';
    const badge = control.querySelector('.dayicon')!;
    const before = control.outerHTML;
    assert.equal(nativeNavigationIconTargets(page, url).find(({ kind }) => kind === 'house')?.original, badge);
    assert.equal(control.outerHTML, before);
    badge.querySelector('.day')!.textContent = '11';
    assert.equal(nativeNavigationIconTargets(page, url).find(({ kind }) => kind === 'house')?.original, badge);
    badge.querySelector('.month')!.textContent = '';
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'house'), false, 'An incomplete native badge remains unchanged');
    badge.querySelector('.month')!.textContent = 'OCT';
    badge.append(page.createElement('span'));
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'house'), false, 'Unexpected badge content falls back');
  });
});

test('unverified, foreign, login, and ambiguous native shells are untouched', () => {
  for (const path of ['https://foreign.example/app/student#studentmyday/progress', `${origin}/signin`, `${origin}/app/faculty#studentmyday/progress`, `${origin}/lms-assignment/unknown`]) {
    fixture(false, (page, url) => assert.deepEqual(nativeNavigationIconTargets(page, url), []), path);
  }
  for (const id of ['site-header', 'site-nav-container', 'site-main']) fixture(false, (page, url) => {
    page.body.append(page.querySelector(`#${id}`)!.cloneNode(true));
    assert.deepEqual(nativeNavigationIconTargets(page, url), [], id);
  });
  fixture(true, (page, url) => {
    page.querySelector('#site-nav-lower')!.remove();
    assert.deepEqual(nativeNavigationIconTargets(page, url), []);
  });
});

test('top links require safe expected native destinations and keep unsupported targets native', () => {
  const invalid = ['https://foreign.example/app/student#resourceboard', '/app/faculty#resourceboard', '/app/student#resourceboard/unknown', 'javascript:void(0)', 'https://user:pass@example.myschoolapp.com/app/student#resourceboard'];
  for (const href of invalid) fixture(false, (page, url) => {
    page.querySelector('#group-header-Resources')!.setAttribute('href', href);
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'folder-closed'), false, href);
  });
  fixture(true, (page, url) => {
    page.querySelector('#directory-subnav')!.setAttribute('href', '#unknown');
    page.querySelector('#calendar-subnav')!.setAttribute('href', '/app/student#calendar/unknown');
    page.querySelector('#group-header-Groups')!.setAttribute('href', '/app/delete-account');
    assert.deepEqual(nativeNavigationIconTargets(page, url).filter(({ control }) => ['directory-subnav', 'calendar-subnav', 'group-header-Groups'].includes(control.id)), []);
  });
});

test('top title/image ambiguity, meaningful alternate text, unexpected files, and action icons fall back individually', () => {
  const changes: ((control: Element) => void)[] = [
    (control) => control.querySelector('.desc')!.remove(),
    (control) => control.append(control.querySelector('.desc')!.cloneNode(true)),
    (control) => control.querySelector('.desc')!.append(control.querySelector('.title')!.cloneNode(true)),
    (control) => { control.querySelector('.title')!.textContent = ''; },
    (control) => control.append(control.querySelector('img')!.cloneNode(true)),
    (control) => control.querySelector('img')!.setAttribute('src', '//libs-w2.myschoolapp.com/p3-cache/img/48x48/unknown.png'),
    (control) => control.querySelector('img')!.setAttribute('src', '//foreign.example/p3-cache/img/48x48/classes_48.png'),
    (control) => control.querySelector('img')!.setAttribute('alt', 'Student photo'),
    (control) => control.querySelector('img')!.setAttribute('role', 'button'),
    (control) => control.querySelector('img')!.setAttribute('tabindex', '0'),
    (control) => control.querySelector('img')!.classList.add('caret'),
    (control) => control.querySelector('img')!.setAttribute('aria-controls', 'native-panel'),
  ];
  for (const change of changes) fixture(false, (page, url) => {
    change(page.querySelector('#group-header-Classes')!);
    const targets = nativeNavigationIconTargets(page, url);
    assert.equal(targets.some(({ control }) => control.id === 'group-header-Classes'), false);
    assert.equal(targets.length, 10, 'An unsupported item does not suppress the other verified icons');
  });
});

test('only verified modern top items can add an icon when Blackbaud omits the large image', () => {
  fixture(true, (page, url) => {
    const control = page.querySelector<HTMLAnchorElement>('#group-header-Classes')!;
    control.querySelector('img')!.remove();
    const caret = control.querySelector('sky-icon')!;
    assert.equal(nativeNavigationIconTargets(page, url).find((target) => target.control === control)?.original, null);
    assert.equal(caret.getAttribute('iconname'), 'caret-down');
    caret.setAttribute('iconname', 'warning');
    assert.equal(nativeNavigationIconTargets(page, url).some((target) => target.control === control), false);
    caret.setAttribute('iconname', 'caret-down');
    const unexpected = page.createElementNS('http://www.w3.org/2000/svg', 'svg');
    control.prepend(unexpected);
    assert.equal(nativeNavigationIconTargets(page, url).some((target) => target.control === control), false, 'An unexpected native graphic must not receive a duplicate icon');
    unexpected.setAttribute('data-bn-navigation-icon', 'book-open');
    assert.equal(nativeNavigationIconTargets(page, url).find((target) => target.control === control)?.original, null, 'Our already mounted icon remains a stable target');
    control.classList.remove('root-nav-item');
    assert.equal(nativeNavigationIconTargets(page, url).some((target) => target.control === control), false);
  });
  fixture(false, (page, url) => {
    page.querySelector('#group-header-Classes img')!.remove();
    assert.equal(nativeNavigationIconTargets(page, url).some(({ control }) => control.id === 'group-header-Classes'), false);
  });
});

test('duplicate native top identities are skipped and navigation discovery stays inside verified roots', () => {
  fixture(false, (page, url) => {
    const control = page.querySelector('#group-header-Classes')!;
    control.parentElement!.parentElement!.append(control.parentElement!.cloneNode(true));
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'book-open'), false);
    const outside = page.querySelector('#group-header-Resources')!.parentElement!.cloneNode(true);
    page.body.append(outside);
    assert.equal(nativeNavigationIconTargets(page, url).filter(({ kind }) => kind === 'folder-closed').length, 1);
  });
});

test('lower navigation needs both a known decorative icon and a verified route, with no ambiguous duplicates', () => {
  fixture(true, (page, url) => {
    const progress = page.querySelector<HTMLAnchorElement>('#site-nav-lower a')!;
    const icon = progress.querySelector('i')!;
    icon.className = 'p3icon-schedule';
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'chart-column'), false);
    icon.className = 'p3icon-progress p3icon-warning';
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'chart-column'), false);
    icon.className = 'p3icon-progress';
    icon.setAttribute('role', 'button');
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'chart-column'), false);
    icon.removeAttribute('role');
    progress.setAttribute('href', 'https://foreign.example/app/student#studentmyday/progress');
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'chart-column'), false);
    progress.setAttribute('href', '/app/student#studentmyday/progress');
    progress.parentElement!.parentElement!.append(progress.parentElement!.cloneNode(true));
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'chart-column'), false);
  });
  fixture(false, (page, url) => {
    page.querySelector('#progress-btn')!.setAttribute('href', '#studentmyday/progress');
    page.querySelector('#schedule-btn')!.setAttribute('href', '#studentmyday/schedule');
    assert.equal(nativeNavigationIconTargets(page, url).length, 11);
    page.querySelector('#progress-btn i')!.setAttribute('aria-label', 'Open chart');
    page.querySelector('#schedule-btn')!.id = 'unknown-schedule';
    assert.equal(nativeNavigationIconTargets(page, url).some(({ kind }) => kind === 'chart-column'), false);
    assert.equal(nativeNavigationIconTargets(page, url).some(({ control }) => control.id === 'unknown-schedule'), false);
    page.querySelector('#assignment-center-btn')!.setAttribute('href', '#studentmyday/assignment-center');
    assert.equal(nativeNavigationIconTargets(page, url).find(({ control }) => control.id === 'assignment-center-btn')?.kind, 'clipboard-check');
  });
});

test('rerendered navigation returns new native elements and still recognizes reversibly hidden originals', () => {
  fixture(false, (page, url) => {
    const old = page.querySelector<HTMLAnchorElement>('#group-header-Resources')!;
    const replacement = old.cloneNode(true) as HTMLAnchorElement;
    old.replaceWith(replacement);
    const image = replacement.querySelector<HTMLImageElement>('img')!;
    image.hidden = true;
    image.style.display = 'none';
    replacement.prepend(page.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    const target = nativeNavigationIconTargets(page, url).find(({ kind }) => kind === 'folder-closed')!;
    assert.equal(target.control, replacement);
    assert.equal(target.original, image);
    assert.equal(nativeNavigationIconTargets(page, url).some(({ control }) => control === old), false);
  });
});

test('known legacy lower navigation remains scoped when mounted in its older bottom container', () => {
  fixture(false, (page, url) => {
    page.querySelector('#site-nav-lower')!.id = 'site-nav-bottom';
    assert.equal(nativeNavigationIconTargets(page, url).length, 11);
    const outside = page.querySelector('#progress-btn')!.parentElement!.cloneNode(true);
    page.querySelector('#site-main')!.append(outside);
    assert.equal(nativeNavigationIconTargets(page, url).filter(({ kind }) => kind === 'chart-column').length, 1);
  });
});

test('modern calendar and assignment detail keep verified top icons without inventing lower navigation', () => {
  for (const path of [`${origin}/sis-scheduling/user-calendar?date=2026-10-09`, `${origin}/lms-assignment/assignment/assignment-student-view/123`]) fixture(true, (page, url) => {
    page.querySelector('#site-nav-lower')!.remove();
    assert.equal(nativeNavigationIconTargets(page, url).length, 7);
    page.querySelector('#myday')!.setAttribute('href', '/app/faculty#studentmyday');
    assert.deepEqual(nativeNavigationIconTargets(page, url), []);
  }, path);
});
