import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ElementHandle, HTTPRequest, Page } from 'puppeteer-core';
import {
  buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser,
  launchDevelopmentBrowser, parseDevelopmentOptions, reloadDevelopmentExtension,
} from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';
import { HEADER_LOWER_ITEMS as lowerNavigation, HEADER_PRIMARY_ITEMS as topNavigation, nativePrimaryDescription } from './fixtures/header.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://appearance-fixture.myschoolapp.com';
const legacyUrl = `${origin}/app/student?svcid=edu#studentmyday/progress`;
const modernUrl = `${origin}/lms-assignment/assignment-center/student?svcid=edu`;
const schoolLogos = {
  wide: { width: 600, height: 80 },
  square: { width: 80, height: 80 },
  tall: { width: 80, height: 160 },
  'ultra-wide': { width: 1000, height: 40 },
} as const;
type SchoolLogoShape = keyof typeof schoolLogos;
type SchoolLogoSizes = Record<SchoolLogoShape, { width: number; height: number }>;
type NativeSchoolLogo = {
  image: ElementHandle<HTMLImageElement>;
  link: ElementHandle<HTMLAnchorElement>;
};
function nativeMenu(id: string, modern: boolean): string {
  const item = (label: string, href: string) => `<li><a href="${href}">${label}</a></li>`;
  const menu = (items: string) => `<div class="subnavtop"></div><div class="subnav sec-75-bordercolor white-bgc sky-nav" data-native-menu="${id}"><ul>${items}</ul></div>`;
  if (id === 'group-header-Classes') {
    const column = (offset: number) => `<ul>${Array.from({ length: 20 }, (_, index) => {
      const number = offset + index + 1;
      const label = number === 1 ? 'Geometry' : number === 2 ? 'Café Studies' : `Course ${number}: native course with a descriptive title`;
      return `<li><a ${modern ? '' : 'class="group-page-link-1"'} data-taskid="1853" href="/app/student?svcid=edu#academicclass/${100 + number}/0/bulletinboard">${label}</a></li>`;
    }).join('')}</ul>`;
    return `<div class="subnavtop"></div><div class="subnav sec-75-bordercolor white-bgc sky-nav subnav-multicol" data-native-menu="${id}">${column(0)}${column(20)}<ul class="subnavfooter"><li class="divider"></li>${item('View Other Classes', '/app/student?svcid=edu#otherclasses')}</ul></div>`;
  }
  if (id === 'myday') return menu(lowerNavigation.map(([, label, , href]) => item(label, href)).join(''));
  if (id === 'group-header-Groups') return menu(item('Student Council', '/app/student?svcid=edu#communitygroup/201/0/bulletinboard') + item('Robotics club', '/app/student?svcid=edu#communitygroup/202/0/bulletinboard') + '<li class="divider"></li>' + item('View Other Groups', '/app/student?svcid=edu#othergroups'));
  if (id === 'group-header-News') return menu('<li class="divider-label"><h6>School news</h6></li>' + item('Recent Activity', '/app/student?svcid=edu#news') + item('Announcements', '/app/student?svcid=edu#news/announcements'));
  if (id === 'directory-subnav') return menu(['Students', 'Parents and guardians', 'Faculty', 'Alumni', 'Staff'].map((label, index) => item(label, `/app/student?svcid=edu#directory/${index + 1}`)).join('') + '<li class="divider"></li>' + item('My Contacts', '/app/student?svcid=edu#mycontacts'));
  return '';
}

function tile(id: string, title: string): string {
  // Blackbaud repeats each widget ID on its outer wrapper and inner section.
  return `<div id="${id}"><div class="ch col-md-4"><section id="${id}" class="bb-tile">
    <div class="bb-tile-title"><div class="bb-tile-header-with-content"><h2 class="bb-tile-header">${title}</h2></div>
    <div class="bb-tile-header-column-tools"><div class="bb-tile-tools"><button class="bb-tile-chevron" aria-label="Toggle ${title}" aria-expanded="true">⌃</button></div></div></div>
    <div class="bb-tile-content"><div class="bb-tile-content-section"><p>Native ${title.toLowerCase()} information with a short summary of this school year.</p></div></div>
  </section></div></div>`;
}

function progressCourse(id: string, title: string, grade: string, options: { hidden?: boolean; hiddenColumn?: boolean; disabled?: boolean } = {}): string {
  return `<div id="${id}" class="row" data-native-course${options.hidden ? ' hidden' : ''}>
    <div class="col-md-3" data-native-course-column><h3><a id="${id}-course" href="/app/student?svcid=edu#academicclass/123/0/bulletinboard" data-native-course-action="course">${title}</a></h3><h5>Native section and reporting information</h5></div>
    <div class="col-md-2" data-native-course-column${options.hiddenColumn ? ' hidden' : ''}><button id="${id}-grade" class="btn btn-default" type="button" data-native-course-action="grade">View grade details</button></div>
    <div class="col-md-2" data-native-course-column><h5>Reporting term</h5><select id="${id}-term" class="form-control" aria-label="${title} reporting term" data-native-course-action="term"><option value="fall">Fall semester</option><option value="spring">Spring semester</option></select></div>
    <div class="col-md-2" data-native-course-column><div class="showGrade">${grade}</div><h5>Native grade description</h5></div>
    <div class="col-md-3" data-native-course-column><div class="bb-avatar-wrapper-medium pull-left"><img class="bb-avatar-image-medium" src="${origin}/fixture-avatar.svg" alt="Example teacher"></div><div class="clearfix"></div><h4 class="group-owner-name">Example teacher with a long family name</h4><p><a id="${id}-email" href="mailto:teacher.with.a.long.address@example.edu" data-native-course-action="email">teacher.with.a.long.address@example.edu</a></p><button id="${id}-message" class="btn btn-default sendmessage" type="button" data-native-course-action="message"${options.disabled ? ' disabled' : ''}>Send message</button></div>
  </div>`;
}

function progressCourses(): string {
  return progressCourse('course-one', 'Interdisciplinary Studies: Reading, Research, and Community Practice', 'A− (92.8%)') +
    progressCourse('course-two', 'Studio Practice', 'Not yet published for this reporting term', { hiddenColumn: true }) +
    progressCourse('course-three', 'Independent Research', 'Satisfactory — Credit only', { disabled: true }) +
    progressCourse('course-hidden', 'Native hidden course', 'B+', { hidden: true });
}

type NativeProgressContent = {
  list: HTMLElement;
  rows: Array<{ row: HTMLElement; columns: Element[]; text: string }>;
  controls: Array<{ element: HTMLElement; href: string | null; disabled: boolean; hidden: boolean }>;
};

function utilityHeader(modern: boolean): string {
  const studentPage = modern ? '/app/student?svcid=edu' : '?svcid=edu';
  const description = (text: string) => modern
    ? `<div class="desc"><div class="title"><div>${text}</div></div></div>`
    : `<span class="desc"><span class="title">${text}</span></span>`;
  const list = `<ul class="topnav${modern ? ' user-nav' : ''}">
    <li><a href="${studentPage}#searchresults" data-native-utility="search">${modern ? '<span class="search"><sky-icon iconname="search"></sky-icon></span><sky-icon iconname="caret-down"></sky-icon>' : '<i class="topnav-icon p3icon-search"></i><span class="caret for-search"></span>'}</a><div class="subnavtop"></div><div class="subnav" data-native-menu="search"><div><input id="site-search-input" type="text" aria-label="Search the portal"></div></div></li>
    <li><a ${modern ? 'id="official-notes"' : ''} href="${modern ? studentPage : ''}#message/officialnotes" data-native-utility="notes"><span class="site-badge ${modern ? 'site-badge-message' : 'site-badge-official-notes'}">2</span>&nbsp;${description('Official Notes')}</a></li>
    <li><a id="inbox-link" href="${modern ? studentPage : ''}#message/inbox" data-native-utility="messages"><span class="site-badge site-badge-message">0</span>&nbsp;${description('Messages')}</a></li>
    <li><a id="account-nav" href="#" data-native-utility="account"><div class="bb-avatar-wrapper-nav"><img class="bb-avatar-image-nav" src="${origin}/fixture-avatar.svg" alt=""></div>${description(modern ? 'Alex</div><div>Student' : 'Alex<br>Student')}${modern ? '<sky-icon iconname="caret-down"></sky-icon>' : '<span class="caret"></span>'}</a><div class="subnavtop"></div><div class="subnav" data-native-menu="account"><ul><li><a href="/app/student?svcid=edu#profile">Profile</a></li><li><a href="/app/student?svcid=edu#settings">Settings</a></li><li class="${modern ? 'sep' : 'divider'}"></li><li><a href="/app/SignOut">Sign out</a></li></ul></div></li>
  </ul>`;
  return `<div id="site-header-parent-container"><div id="site-header-container"><header id="site-header" class="${modern ? 'sky-container' : 'container'}"><div class="row"><div class="col-md-12">
    <div id="site-mobile-btn"><button class="btn" type="button" aria-label="Open navigation" aria-controls="fixture-native-drawer" aria-expanded="false">☰</button></div>
    <div id="site-logo" class="logoimg"><a href="http://school.example"><img src="${origin}/fixture-logo.svg?shape=wide" alt="Example School"></a></div>
    ${modern ? `<div id="site-user-container"><div id="site-user-nav" class="site-header-nav"><edu-user-nav>${list}</edu-user-nav></div></div>` : `<div id="site-user-nav" class="site-header-nav"><div>${list}</div></div>`}
  </div></div></header></div></div>`;
}

function nativeFixture(modern: boolean): string {
  const primaryDescription = (label: string) => nativePrimaryDescription(modern, label);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Appearance fixture</title><style>
    * { box-sizing: border-box; } body { margin: 0; font: 14px Arial,sans-serif; }
    #site-header, .container, #site-main { width: 1100px; max-width: calc(100% - 32px); margin: auto; }
    #site-header-parent-container { position: fixed; top: 0; width: 100%; height: 45px; z-index: 30; }
    #site-header-container { height: 45px; background: #30445c; color: white; } #site-header { height: 45px; padding: 0; }
    #site-header > .row > .col-md-12 { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    #site-logo img { display: block; width: 160px; height: 32px; }
    #site-mobile-btn { display: none; } #site-mobile-btn button { width: 44px; height: 44px; }
    #fixture-native-drawer { position: fixed; inset: 45px 0 0; z-index: 50; width: 240px; padding: 20px; background: #fff; border-right: 1px solid #ccc; }
    #site-user-nav .topnav { display: flex; align-items: center; flex-wrap: wrap; }
    #site-user-nav .topnav > li > a { display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 6px 10px; color: white; }
    #site-user-nav .topnav > li > a > .desc { float: none; padding: 0; }
    #site-user-nav .topnav .title { font-size: 13px; }
    ${modern ? '#site-user-nav .topnav.user-nav > li > a { margin-top: 2px; } #site-user-nav .topnav.user-nav > li > a > .desc { height: 31px; }' : ''}
    #site-user-nav .topnav-icon, #site-user-nav sky-icon[iconname="search"] { display: inline-block; width: 18px; height: 18px; }
    #site-user-nav .site-badge { min-width: 18px; padding: 2px; text-align: center; background: #e6edf3; color: #30445c; }
    .bb-avatar-image-nav { display: block; width: 26px; height: 26px; border-radius: 50%; }
    #site-user-nav .topnav > li { position: relative; }
    #site-user-nav .subnav { display: none; position: absolute; right: 0; top: 100%; z-index: 10; }
    #site-nav-container { position: fixed; top: 45px; width: 100%; height: 55px; z-index: 20; }
    #site-nav-container > .container { height: 55px; }
    .topnav { list-style: none; height: 55px; padding: 0; margin: 0; } .topnav > li { position: relative; ${modern ? 'display: inline' : 'float: left'}; }
    .topnav > li > a { display: inline-block; vertical-align: top; padding: 12px 16px; height: 64px; color: #222; text-decoration: none; }
    .desc { float: left; padding-left: 8px; } .title { display: block; font-weight: bold; }
    .topnav > li > a > img { float: left; width: 48px; height: 48px; }
    .dayicon { float: left; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px solid #777; }
    .caret, sky-icon[iconname="caret-down"] { display: inline-block; width: 0; height: 0; border: 4px solid transparent; border-top-color: currentColor; vertical-align: middle; }
    .topnav .subnav { display: none; position: absolute; top: 100%; left: 0; width: 260px; height: auto; padding: 12px; margin: 0; border: 1px solid #b97011; background: white; list-style: none; z-index: 40; }
    .topnav .subnav ul { padding: 0; margin: 0; } .topnav .subnav li { list-style: none; } .topnav .subnav a { display: block; padding: 4px; font-size: 16px; color: #111; text-decoration: none; }
    .topnav .subnav .divider { margin: 8px 0; border-top: 1px solid #bbb; }
    .topnav .subnav-multicol { width: 900px; } .topnav .subnav-multicol > ul { float: left; width: 50%; padding: 0; margin: 0; }
    .topnav .subnav-multicol > ul.subnavfooter { clear: both; width: 100%; }
    .topnav .subnavtop { display: none; position: absolute; top: 100%; left: 20px; border: 9px solid transparent; border-bottom-color: #b97011; }
    #site-user-nav .subnav { left: auto; right: 0; }
    #site-nav-lower { position: fixed; top: 100px; width: 100%; height: 52px; z-index: 10; }
    #site-top-spacer { height: 180px; }
    #site-nav-lower ul { list-style: none; padding: 0; margin: 0; } #site-nav-lower li { display: inline-block; }
    #site-nav-lower a { display: inline-block; padding: 12px; } #site-nav-lower i { display: inline-block; width: 14px; height: 14px; border: 1px solid currentColor; vertical-align: middle; }
    .topnav::after, .row::after, .bb-tile-title::after { content: ''; display: table; clear: both; }
    #site-main { padding-top: 20px; } .ch.col-md-4 { float: left; width: 33.333333%; padding: 0 12px; }
    .bb-tile { border: 1px solid #ccc; margin-bottom: 20px; } .bb-tile-title { padding: 12px; background: #eee; }
    .bb-tile-header-with-content { float: left; width: 85%; } .bb-tile-header-column-tools { float: left; width: 15%; }
    .bb-tile-header { font-size: 18px; margin: 0; } .bb-tile-tools { float: right; }
    .bb-tile-chevron { width: 28px; height: 28px; cursor: pointer; } .bb-tile-content { padding: 16px; }
    .bb-tile-content-section { padding: 15px; } .bb-tile-content-section p { margin: 0; }
    #coursesContainer > .row { margin: 0 0 18px; padding: 18px 0; border-bottom: 1px solid #ccc; }
    #coursesContainer > .row > div { padding: 0 15px; } #coursesContainer h3 { font-size: 20px; }
    #coursesContainer .btn { padding: 6px 10px; } #coursesContainer .form-control { max-width: 100%; padding: 6px; }
    .bb-avatar-wrapper-medium { width: 48px; height: 48px; } .bb-avatar-image-medium { width: 48px; height: 48px; }
    .pull-left { float: left; } .clearfix { clear: both; }
    [hidden]:not([data-native-course]):not([data-native-course-column]) { display: none !important; } app-root, sky-toolbar, sky-repeater, sky-repeater-item { display: block; }
    @media (min-width: 992px) { #coursesContainer > .row > .col-md-3 { float: left; width: 25%; } #coursesContainer > .row > .col-md-2 { float: left; width: 16.666667%; } }
    @media (max-width: 700px) { #site-nav-container { display: none; } .ch.col-md-4 { width: 100%; } }
    @media (max-width: 991px) { #site-mobile-btn { display: block; } #site-user-nav, #site-nav-container, #site-nav-lower { display: none; } #site-top-spacer { height: 73px; } }
  </style></head><body>${modern ? '<app-root>' : ''}
    ${utilityHeader(modern)}
    <aside id="fixture-native-drawer" hidden><a href="/app/student?svcid=edu#studentmyday/schedule">Native mobile Schedule</a><button type="button">Close navigation</button></aside>
    <nav id="site-nav-container"><div class="container"><ul class="topnav">
      <li${modern ? '' : ' class="active"'}><a id="myday" class="${modern ? 'root-nav-item' : ''}" href="/app/student?svcid=edu#studentmyday"><div class="dayicon"><span class="month">OCT</span><span class="day">10</span></div>${primaryDescription('My Day')}</a>${nativeMenu('myday', modern)}</li>
      ${topNavigation.map(([id, title, file, href]) => `<li><a id="${id}" class="${modern ? 'root-nav-item' : ''}" href="${modern && id === 'group-header-Groups' ? '#' : href}"><img src="https://polytechnic.myschoolapp.com/p3-cache/img/48x48/${file}" width="48" height="48">${primaryDescription(title)}${modern ? '<sky-icon iconname="caret-down" aria-hidden="true"></sky-icon>' : '<span class="caret" aria-hidden="true"></span>'}</a>${nativeMenu(id, modern)}</li>`).join('')}
    </ul></div></nav>
    <nav id="site-nav-lower"><div class="${modern ? 'container' : 'res-container'}"><ul class="${modern ? '' : 'nav nav-pills'}">${lowerNavigation.map(([id, title, icon, href], index) => `<li${index === 0 ? ' class="active"' : ''}><a ${modern ? '' : `id="${id}"`} href="${href}"><i class="${icon}" aria-hidden="true"></i>${title}</a></li>`).join('')}</ul></div></nav>
    <div id="site-top-spacer" class="${modern ? 'white-bg site-top-spacer-lower-nav' : 'site-top-spacer'}"></div>
    ${modern ? `<sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater><sky-repeater-item class="assignment-repeater-item">
      <app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/123">Native assignment</a></app-assignment-title-link>
      </sky-repeater-item></sky-repeater></app-root>` : `<main id="site-main"><div id="summary" class="row">${tile('performance', 'Performance')}${tile('attendance', 'Attendance')}</div><div id="coursesContainer">${progressCourses()}</div></main>`}
    <script>const mobileButton = document.querySelector('#site-mobile-btn button'); const drawer = document.getElementById('fixture-native-drawer');
    mobileButton.addEventListener('click', () => { drawer.hidden = !drawer.hidden; mobileButton.setAttribute('aria-expanded', String(!drawer.hidden)); document.body.dataset.drawerActions = String(Number(document.body.dataset.drawerActions || 0) + 1); });
    drawer.querySelector('button').addEventListener('click', () => { drawer.hidden = true; mobileButton.setAttribute('aria-expanded', 'false'); });
    const closeMenus = () => document.querySelectorAll('[data-native-menu], .subnavtop').forEach(menu => { menu.style.display = 'none'; menu.classList.remove('nav-visible'); });
    const showMenu = (link) => {
      closeMenus(); const menu = link.parentElement.querySelector('[data-native-menu]');
      if (menu) { menu.style.display = 'block'; menu.classList.add('nav-visible'); const pointer = link.parentElement.querySelector('.subnavtop'); if (pointer) pointer.style.display = 'block'; }
    };
    // Native legacy menus open on mouseover and close immediately when the pointer
    // leaves their owning LI. Click-to-open alone cannot expose gaps above a panel.
    if (!${modern}) document.querySelectorAll('#site-nav-container .topnav > li > a').forEach(link => {
      if (!link.parentElement.querySelector('[data-native-menu]')) return;
      link.addEventListener('mouseover', () => showMenu(link));
      link.parentElement.addEventListener('mouseleave', () => {
        link.parentElement.querySelectorAll('[data-native-menu], .subnavtop').forEach(menu => { menu.style.display = 'none'; menu.classList.remove('nav-visible'); });
      });
    });
    document.body.addEventListener('click', closeMenus);
    document.querySelectorAll('#site-nav-container .topnav > li > a, #site-nav-lower ul > li > a').forEach(link => link.addEventListener('click', event => {
      event.preventDefault(); document.body.dataset.navigationActions = String(Number(document.body.dataset.navigationActions || 0) + 1);
      document.body.dataset.lastNavigationAction = link.id || link.textContent.trim();
      const menu = link.parentElement.querySelector('[data-native-menu]'); showMenu(link); if (menu) event.stopPropagation();
    })); document.querySelectorAll('[data-native-utility]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault(); document.body.dataset.utilityActions = String(Number(document.body.dataset.utilityActions || 0) + 1);
      document.body.dataset.lastUtilityAction = link.dataset.nativeUtility;
      const badge = link.querySelector('.site-badge'); if (badge) badge.textContent = String(Number(badge.textContent) + 1);
      const menu = link.parentElement.querySelector('[data-native-menu]'); const wasOpen = menu && menu.style.display === 'block'; closeMenus();
      if (menu && !wasOpen) { event.stopPropagation(); menu.style.display = 'block'; menu.classList.add('nav-visible'); const pointer = link.parentElement.querySelector('.subnavtop'); if (pointer) pointer.style.display = 'block'; }
    })); document.querySelectorAll('[data-native-menu] a').forEach(link => link.addEventListener('click', event => {
      event.preventDefault(); document.body.dataset.menuActions = String(Number(document.body.dataset.menuActions || 0) + 1); document.body.dataset.lastMenuAction = link.getAttribute('href');
    })); document.querySelectorAll('.bb-tile-chevron').forEach(button => button.addEventListener('click', () => {
      const content = button.closest('section').querySelector('.bb-tile-content'); content.hidden = !content.hidden;
      button.setAttribute('aria-expanded', String(!content.hidden));
      document.body.dataset.nativeActions = String(Number(document.body.dataset.nativeActions || 0) + 1);
    }));
    const progressList = document.getElementById('coursesContainer');
    if (progressList) {
      window.nativeProgressContent = { list: progressList,
        rows: [...progressList.children].map(row => ({ row, columns: [...row.children], text: row.textContent })),
        controls: [...progressList.querySelectorAll('a,button,select')].map(element => ({ element, href: element.getAttribute('href'), disabled: element.disabled === true, hidden: element.hidden })) };
      progressList.querySelectorAll('[data-native-course-action]').forEach(control => control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'click', event => {
        if (control.tagName === 'A') event.preventDefault();
        const actions = JSON.parse(document.body.dataset.progressActions || '{}'); const action = control.dataset.nativeCourseAction;
        actions[action] = (actions[action] || 0) + 1; document.body.dataset.progressActions = JSON.stringify(actions);
      }));
    }</script>
  </body></html>`;
}

async function syntheticPage(browser: Awaited<ReturnType<typeof launchDevelopmentBrowser>>, modern: boolean): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    // All web requests, including subresources, stay inside this synthetic fixture.
    const url = new URL(request.url());
    if (url.pathname === '/fixture-logo.svg') {
      const shape = url.searchParams.get('shape') as SchoolLogoShape;
      const { width, height } = schoolLogos[shape] ?? schoolLogos.wide;
      void request.respond({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ddd"/></svg>` });
      return;
    }
    if (url.pathname.startsWith('/p3-cache/img/48x48/') || url.pathname === '/fixture-avatar.svg') {
      void request.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#ddd"/></svg>' });
      return;
    }
    void request.respond({ status: 200, contentType: 'text/html', body: nativeFixture(modern) });
  });
  return page;
}

type EarlyHeaderState = 'complete' | 'late' | 'missing-spacer' | 'ambiguous';

function earlyFixture(modern: boolean, state: EarlyHeaderState): { html: string; release: string } {
  const fixture = nativeFixture(modern);
  const bodyStart = fixture.indexOf('<body>') + '<body>'.length;
  const scriptStart = fixture.indexOf('<script>const mobileButton');
  const complete = fixture.slice(bodyStart, scriptStart);
  const spacer = complete.match(/<div id="site-top-spacer"[^>]*><\/div>/)![0];
  const content = state === 'late' ? '' : state === 'missing-spacer' ? complete.replace(spacer, '')
    : state === 'ambiguous' ? `${complete}<header id="site-header" data-fixture-ambiguous-header></header>` : complete;
  const release = state === 'late' ? `document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(complete)});
    requestAnimationFrame(() => { window.fixtureFirstHeaderFrame = {
      readyState: document.readyState,
      heights: ['site-header', 'site-nav-container', 'site-nav-lower', 'site-top-spacer'].map(id => document.getElementById(id).getBoundingClientRect().height),
      primaryCount: document.querySelectorAll('[data-bn-header-part="primary-item"]').length,
    }; });`
    : state === 'missing-spacer' ? `document.querySelector('${modern ? 'app-root' : 'body'}').insertAdjacentHTML('beforeend', ${JSON.stringify(spacer)});`
    : state === 'ambiguous' ? "document.querySelector('[data-fixture-ambiguous-header]').remove();" : '';
  // Two externally gated parser scripts keep DOMContentLoaded pending while the
  // original markup is checked, and again after a single native app render task.
  return {
    html: `${fixture.slice(0, bodyStart)}${content}<script src="/early-before-render.js"></script><script src="/early-after-render.js"></script>${fixture.slice(scriptStart)}`,
    release,
  };
}

async function earlyAppearance(
  browser: Awaited<ReturnType<typeof launchDevelopmentBrowser>>,
  setPreferences: (preferences: Record<string, boolean>) => Promise<unknown>,
): Promise<void> {
  const cases: { modern: boolean; state: EarlyHeaderState; enabled: boolean; appearance: boolean }[] = [
    ...[false, true].flatMap((modern) => (['complete', 'late', 'missing-spacer', 'ambiguous'] as const)
      .map((state) => ({ modern, state, enabled: true, appearance: true }))),
    { modern: false, state: 'complete', enabled: true, appearance: false },
    { modern: true, state: 'complete', enabled: false, appearance: true },
  ];
  for (const scenario of cases) {
    await setPreferences({ enabled: scenario.enabled, pageAppearance: scenario.appearance });
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.setViewport({ width: 1280, height: 900 });
    const fixture = earlyFixture(scenario.modern, scenario.state);
    const scriptRequests = new Map<string, HTTPRequest>();
    const released = new Set<string>();
    let notifyBefore!: (request: HTTPRequest) => void;
    let notifyAfter!: (request: HTTPRequest) => void;
    const before = new Promise<HTTPRequest>((resolve) => { notifyBefore = resolve; });
    const after = new Promise<HTTPRequest>((resolve) => { notifyAfter = resolve; });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      const url = new URL(request.url());
      if (url.pathname === '/early-before-render.js' || url.pathname === '/early-after-render.js') {
        scriptRequests.set(url.pathname, request);
        if (url.pathname === '/early-before-render.js') notifyBefore(request); else notifyAfter(request);
        return;
      }
      if (request.resourceType() === 'document') {
        void request.respond({ status: 200, contentType: 'text/html', body: fixture.html });
        return;
      }
      // This profile never fetches Blackbaud or any other real network resource.
      void request.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32"><rect width="160" height="32" fill="#ddd"/></svg>' });
    });
    const release = async (request: HTTPRequest, body = '') => {
      const path = new URL(request.url()).pathname;
      if (released.has(path)) return;
      released.add(path);
      await request.respond({ status: 200, contentType: 'application/javascript', body });
    };
    let navigationError: unknown;
    const navigation = page.goto(scenario.modern ? modernUrl : legacyUrl, { waitUntil: 'domcontentloaded' })
      .catch((error: unknown) => { navigationError = error; });
    const snapshot = () => page.evaluate(() => {
      const geometry = (id: string) => {
        const node = document.getElementById(id);
        if (!node) return null;
        const { top, height } = node.getBoundingClientRect();
        return { top, height, marker: node.getAttribute('data-bn-header-part') };
      };
      return {
        readyState: document.readyState,
        appearance: document.documentElement.hasAttribute('data-blackbaud-next-appearance'),
        shell: document.documentElement.getAttribute('data-bn-portal-shell'),
        header: geometry('site-header'), primary: geometry('site-nav-container'),
        tabs: geometry('site-nav-lower'), spacer: geometry('site-top-spacer'),
        primaryCount: document.querySelectorAll('[data-bn-header-part="primary-item"]').length,
        icons: document.querySelectorAll('[data-bn-navigation-icon]').length,
      };
    });
    const assertEnhanced = async () => {
      await page.waitForSelector('#site-top-spacer[data-bn-header-part="spacer"]');
      const current = await snapshot();
      const evidence = `${JSON.stringify(scenario)}: ${JSON.stringify(current)}`;
      assert.equal(current.readyState, 'loading', `Appearance applies before DOMContentLoaded: ${evidence}`);
      assert.equal(current.shell, scenario.modern ? 'modern' : 'legacy');
      assert.equal(current.appearance, true);
      assert.deepEqual(current.header && { top: current.header.top, height: current.header.height }, { top: 0, height: 52 }, `Preloaded CSS resizes the masthead before application startup finishes: ${evidence}`);
      assert.deepEqual(current.primary && { top: current.primary.top, height: current.primary.height }, { top: 52, height: 61 }, `The primary bar is coordinated with the early masthead: ${evidence}`);
      assert.deepEqual(current.tabs && { top: current.tabs.top, height: current.tabs.height }, { top: 113, height: 55 }, `The third bar has its final geometry before parsing ends: ${evidence}`);
      assert.equal(current.spacer?.height, 196, `The content spacer reserves the entire redesigned stack: ${evidence}`);
      assert.equal(current.primaryCount, 7, 'All verified native primary controls are ready before DOMContentLoaded');
      assert.equal(current.icons, 14, 'Inline icons are installed by the early runtime');
    };
    try {
      const first = await before;
      if (scenario.enabled && scenario.appearance) {
        if (scenario.state === 'complete') await assertEnhanced();
        else {
          await page.waitForSelector('html[data-blackbaud-next-appearance]');
          const current = await snapshot();
          const evidence = `${JSON.stringify(scenario)}: ${JSON.stringify(current)}`;
          assert.equal(current.readyState, 'loading');
          assert.equal(current.primaryCount, 0, `Incomplete or ambiguous native markup cannot resize the early stack: ${evidence}`);
          if (scenario.state !== 'late') {
            assert.equal(current.header?.height, 45, `The native masthead height remains intact until verification: ${evidence}`);
            assert.deepEqual(current.primary && { top: current.primary.top, height: current.primary.height }, { top: 45, height: 55 }, `The native primary bar does not jump ahead of its spacer: ${evidence}`);
            assert.deepEqual(current.tabs && { top: current.tabs.top, height: current.tabs.height }, { top: 100, height: 52 }, `The native third bar does not move while validation is incomplete: ${evidence}`);
          }
        }
      } else {
        const current = await snapshot();
        const evidence = `${JSON.stringify(scenario)}: ${JSON.stringify(current)}`;
        assert.equal(current.readyState, 'loading');
        assert.equal(current.appearance, false, `Disabled appearance stays inactive during document_start: ${evidence}`);
        assert.equal(current.shell, null);
        assert.equal(current.primaryCount, 0);
        assert.equal(current.header?.height, 45, `Preloaded CSS cannot style a disabled header: ${evidence}`);
        assert.equal(current.spacer?.height, 180);
      }
      await release(first, fixture.release);
      const second = await after;
      if (scenario.enabled && scenario.appearance) {
        await assertEnhanced();
        if (scenario.state === 'late') {
          await page.waitForFunction(() => (window as Window & { fixtureFirstHeaderFrame?: unknown }).fixtureFirstHeaderFrame !== undefined, { polling: 'raf' });
          const frame = await page.evaluate(() => (window as Window & { fixtureFirstHeaderFrame?: unknown }).fixtureFirstHeaderFrame);
          assert.deepEqual(frame, { readyState: 'loading', heights: [52, 61, 55, 196], primaryCount: 7 }, 'A complete header rendered in one native app task already has its final styling on the first frame that can paint it');
        }
      }
      await release(second);
      await navigation;
      if (navigationError) throw navigationError;
      assert.notEqual(await page.evaluate(() => document.readyState), 'loading', 'The synthetic parser resumes normally after the timing assertions');
      if (!scenario.enabled || !scenario.appearance) {
        const current = await snapshot();
        assert.equal(current.appearance, false, 'Disabled preferences remain inactive after the ordinary document_end runtime starts');
        assert.equal(current.header?.height, 45);
        assert.equal(current.spacer?.height, 180);
      }
    } finally {
      for (const request of scriptRequests.values()) await release(request).catch(() => undefined);
      await page.close();
      await navigation;
    }
  }
  await setPreferences({ enabled: true, pageAppearance: true });
}

async function horizontalNavigation(page: Page): Promise<void> {
  const bounds = await page.evaluate(() => ({
    viewport: innerWidth,
    links: [...document.querySelectorAll('#site-nav-container .topnav > li > a')].map((link) => {
      const { top, left, right, width } = link.getBoundingClientRect(); return { top, left, right, width };
    }),
  }));
  assert.equal(bounds.links.length, 7);
  for (const [index, link] of bounds.links.entries()) {
    assert.ok(link.width > 0 && link.left >= 0 && link.right <= bounds.viewport + 1, JSON.stringify(bounds));
    assert.ok(Math.abs(link.top - bounds.links[0]!.top) < 2, `Navigation must remain on one line: ${JSON.stringify(bounds)}`);
    if (index) assert.ok(link.left >= bounds.links[index - 1]!.right - 1, 'Navigation items must not overlap');
  }
}

async function cleanPrimaryNavigation(page: Page, enhanced: boolean): Promise<void> {
  const state = await page.evaluate(() => ({
    controls: [...document.querySelectorAll('#site-nav-container .topnav > li > a')].map((control) => {
      const title = document.createRange(); title.selectNodeContents(control.querySelector('.title')!);
      const count = control.querySelector('.desc > b, .desc > strong');
      return {
        width: control.getBoundingClientRect().width, title: title.getBoundingClientRect().height,
        count: count?.textContent, countDisplay: count ? getComputedStyle(count).display : null,
      };
    }),
  }));
  assert.deepEqual(state.controls.flatMap(({ count }) => count ? [count] : []), ['14', '4', '5'], 'The original native counts remain in the DOM');
  for (const control of state.controls.filter(({ count }) => count)) {
    if (enhanced) assert.equal(control.countDisplay, 'none', 'Primary destinations keep a clean label without totals');
    else assert.notEqual(control.countDisplay, 'none', 'Cleanup restores native destination totals');
  }
  if (enhanced) {
    assert.ok(Math.max(...state.controls.map(({ width }) => width)) - Math.min(...state.controls.map(({ width }) => width)) > 20, `Navigation items use their content widths: ${JSON.stringify(state)}`);
    assert.ok(state.controls.every(({ title }) => title > 0 && title < 24), `Primary labels stay on one line: ${JSON.stringify(state)}`);
  }
}

async function navigationLabels(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('#site-nav-container .topnav > li > a, #site-nav-lower ul > li > a')]
    .map((link) => ({ id: link.id, href: link.getAttribute('href'), label: link.textContent?.trim() })));
}

async function navigationIcons(page: Page, enhanced: boolean, expectedDay = '11'): Promise<void> {
  const icons = await page.evaluate(() => {
    const state = (control: Element) => {
      const original = control.querySelector(':scope > img, :scope > .dayicon, :scope > i[class*="p3icon-"]');
      const icon = control.querySelector(':scope > svg[data-bn-navigation-icon]');
      return {
        kind: icon?.getAttribute('data-bn-navigation-icon'),
        iconCount: control.querySelectorAll(':scope > svg[data-bn-navigation-icon]').length,
        iconHidden: icon?.getAttribute('aria-hidden'), iconFocusable: icon?.getAttribute('focusable'),
        iconWidth: icon?.getBoundingClientRect().width,
        originalMarker: original?.getAttribute('data-bn-native-icon'),
        originalDisplay: original ? getComputedStyle(original).display : null,
        originalWidth: original?.getBoundingClientRect().width,
        caretVisible: [...control.querySelectorAll(':scope > .caret, :scope > sky-icon')].every((caret) => getComputedStyle(caret).display !== 'none'),
      };
    };
    return {
      top: [...document.querySelectorAll('#site-nav-container .topnav > li > a')].map(state),
      lower: [...document.querySelectorAll('#site-nav-lower ul > li > a')].map(state),
      month: document.querySelector('#myday .dayicon .month')?.textContent,
      day: document.querySelector('#myday .dayicon .day')?.textContent,
      dateCount: document.querySelectorAll('#myday > .dayicon').length,
    };
  });
  assert.equal(icons.month, 'OCT');
  assert.equal(icons.day, expectedDay, 'The native live date remains in place beneath the decorative house replacement');
  assert.equal(icons.dateCount, 1, 'The original calendar badge is retained for cleanup');
  assert.equal(icons.top.length, 7);
  assert.equal(icons.lower.length, 4);
  if (enhanced) {
    assert.deepEqual(icons.top.map(({ kind }) => kind), ['house', ...topNavigation.map((item) => item[4])]);
    assert.deepEqual(icons.lower.map(({ kind }) => kind), lowerNavigation.map((item) => item[4]));
  }
  for (const [index, icon] of [...icons.top, ...icons.lower].entries()) {
    assert.ok(icon.caretVisible, 'Native dropdown affordances remain available');
    if (enhanced) {
      assert.equal(icon.iconCount, 1);
      assert.equal(icon.iconHidden, 'true');
      assert.equal(icon.iconFocusable, 'false');
      assert.equal(icon.iconWidth, index < 7 ? 20 : 18);
      assert.equal(icon.originalMarker, 'replaced');
      assert.equal(icon.originalDisplay, 'none', 'Only verified original decorations are hidden');
    } else {
      assert.equal(icon.iconCount, 0);
      assert.equal(icon.originalMarker, null);
      assert.notEqual(icon.originalDisplay, 'none');
      assert.ok(icon.originalWidth! > 0, 'Native decorations are visible after cleanup');
    }
  }
}

async function nativeNavigationActions(page: Page): Promise<void> {
  await page.bringToFront();
  await page.mouse.move(8, 800);
  await page.evaluate(() => document.body.click());
  const before = await page.evaluate(() => Number(document.body.dataset.navigationActions || 0));
  await page.click('#myday');
  await page.waitForFunction(() => document.body.dataset.lastNavigationAction === 'myday', { polling: 50 }).catch(async (error: unknown) => {
    const evidence = await page.evaluate(() => {
      const link = document.getElementById('myday')!;
      const bounds = link.getBoundingClientRect();
      return { url: location.href, action: document.body.dataset.lastNavigationAction, clicked: document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.outerHTML, bounds: bounds.toJSON(), open: [...document.querySelectorAll<HTMLElement>('[data-native-menu]')].filter((menu) => getComputedStyle(menu).display !== 'none').map((menu) => menu.dataset.nativeMenu) };
    });
    throw new Error(`Native My Day action did not receive its click: ${JSON.stringify(evidence)}`, { cause: error });
  });
  await page.evaluate(() => document.body.click());
  await page.click('#group-header-Classes');
  await page.waitForFunction(() => document.body.dataset.lastNavigationAction === 'group-header-Classes', { polling: 50 }).catch(async (error: unknown) => {
    const evidence = await page.evaluate(() => {
      const link = document.getElementById('group-header-Classes')!;
      const bounds = link.getBoundingClientRect();
      return { url: location.href, action: document.body.dataset.lastNavigationAction, clicked: document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.outerHTML, bounds: bounds.toJSON(), open: [...document.querySelectorAll<HTMLElement>('[data-native-menu]')].filter((menu) => getComputedStyle(menu).display !== 'none').map((menu) => menu.dataset.nativeMenu) };
    });
    throw new Error(`Native Classes action did not receive its click: ${JSON.stringify(evidence)}`, { cause: error });
  });
  await page.evaluate(() => document.body.click());
  await page.click('#site-nav-lower a[href*="#studentmyday/progress"]');
  await page.waitForFunction(() => ['progress-btn', 'Progress'].includes(document.body.dataset.lastNavigationAction ?? ''), { polling: 50 });
  assert.equal(await page.evaluate(() => Number(document.body.dataset.navigationActions)), before + 3, 'My Day and native navigation handlers survive icon replacement and cleanup');
}

async function fixedHeaderGeometry(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const bounds = (element: Element) => {
      const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    const rows = ['site-header-parent-container', 'site-nav-container', 'site-nav-lower'].map((id) => ({
      id, ...bounds(document.getElementById(id)!),
    })).filter(({ width, height }) => width > 0 && height > 0);
    const header = bounds(document.getElementById('site-header')!);
    const controls = [...document.querySelectorAll('[data-native-utility]')].map((control) => ({
      ...bounds(control), labels: [...control.querySelectorAll('.title')].map((label) => {
        const text = document.createRange(); text.selectNodeContents(label);
        const { top, bottom } = text.getBoundingClientRect(); return { top, bottom };
      }),
    })).filter(({ width, height }) => width > 0 && height > 0);
    const navigation = [...document.querySelectorAll('#site-nav-container .topnav > li > a')].map(bounds).filter(({ width }) => width > 0);
    const tabs = [...document.querySelectorAll('#site-nav-lower ul > li > a')].map(bounds).filter(({ width }) => width > 0);
    return {
      header, rows, controls, navigation, tabs,
      content: bounds(document.querySelector('#site-main, sky-toolbar')!),
      spacer: document.querySelector('#site-top-spacer')!.getAttribute('data-bn-header-part'),
      primary: document.querySelector('#site-nav-container .topnav')!.getAttribute('data-bn-header-part'),
    };
  });
  assert.equal(state.spacer, 'spacer', 'Both native spacer class variants are recognized');
  assert.equal(state.primary, 'primary-navigation', 'Only the complete verified native navigation receives the responsive row layout');
  for (const [index, row] of state.rows.entries()) {
    if (index) assert.ok(row.top >= state.rows[index - 1]!.bottom - 1, `Fixed header rows must not overlap: ${JSON.stringify(state)}`);
  }
  for (const control of state.controls) {
    assert.ok(control.top >= state.header.top - 1 && control.bottom <= state.header.bottom + 1, `Native utility heights must fit the masthead: ${JSON.stringify(state)}`);
    for (const label of control.labels) assert.ok(label.top >= control.top - 1 && label.bottom <= control.bottom + 1, `Native utility descriptions must not spill outside their controls: ${JSON.stringify(state)}`);
  }
  const primary = state.rows.find(({ id }) => id === 'site-nav-container');
  if (primary) for (const link of state.navigation) assert.ok(link.top >= primary.top - 1 && link.bottom <= primary.bottom + 1, `Primary links fit their resized native row: ${JSON.stringify(state)}`);
  const lower = state.rows.find(({ id }) => id === 'site-nav-lower');
  if (lower) for (const link of state.tabs) assert.ok(link.top >= lower.top - 1 && link.bottom <= lower.bottom + 1, `Secondary links fit their resized native row: ${JSON.stringify(state)}`);
  assert.ok(state.content.top >= Math.max(...state.rows.map(({ bottom }) => bottom)) - 1, `The native spacer must keep content below the fixed navigation: ${JSON.stringify(state)}`);
}

async function schoolLogoVariants(page: Page, native: NativeSchoolLogo, enhanced: boolean, baseline?: SchoolLogoSizes): Promise<SchoolLogoSizes> {
  const originalSource = await native.image.evaluate((image) => image.getAttribute('src')!);
  const originalDestination = await native.link.evaluate((link) => link.getAttribute('href'));
  const viewport = page.viewport()!;
  const sizes = {} as SchoolLogoSizes;
  try {
    for (const shape of Object.keys(schoolLogos) as SchoolLogoShape[]) {
      const source = `${origin}/fixture-logo.svg?shape=${shape}`;
      await native.image.evaluate(async (image, nextSource) => {
        image.setAttribute('src', nextSource);
        await image.decode();
      }, source);
      for (const width of enhanced ? [992, 1024, 1150, 1280, 320, 391] : [1280]) {
        await page.setViewport({ width, height: 900 });
        const state = await native.image.evaluate((image) => {
          const bounds = (element: Element) => {
            const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
            return { left, right, top, bottom, width, height };
          };
          const link = image.parentElement as HTMLAnchorElement;
          return {
            source: image.getAttribute('src'), destination: link.getAttribute('href'),
            sameImage: document.querySelector('#site-logo img') === image,
            logo: bounds(image), header: bounds(document.querySelector('#site-header')!),
            natural: { width: image.naturalWidth, height: image.naturalHeight },
            utilities: [...document.querySelectorAll('[data-native-utility]')].map(bounds).filter(({ width }) => width > 0),
            viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          };
        });
        const evidence = `${shape} at ${width}px: ${JSON.stringify(state)}`;
        assert.equal(state.sameImage, true, `The school retains its original image node: ${evidence}`);
        assert.equal(await native.link.evaluate((link) => document.querySelector('#site-logo > a') === link), true, 'The school retains its native logo link');
        assert.equal(state.source, source, 'Appearance does not replace the school-provided image');
        assert.equal(state.destination, originalDestination, 'Appearance preserves the school homepage destination');
        assert.deepEqual(state.natural, schoolLogos[shape]);
        if (width === 1280) sizes[shape] = { width: state.logo.width, height: state.logo.height };
        if (enhanced) {
          assert.ok(state.logo.width > 0 && state.logo.height > 0, evidence);
          const ratioError = Math.abs(state.logo.width * state.natural.height - state.logo.height * state.natural.width) / (state.logo.width * state.natural.height);
          assert.ok(ratioError < .005, `Wide, square, and tall school artwork retains its aspect ratio: ${evidence}`);
          assert.ok(state.logo.left >= state.header.left - 1 && state.logo.right <= state.header.right + 1 && state.logo.top >= state.header.top - 1 && state.logo.bottom <= state.header.bottom + 1, `School logos fit the compact masthead: ${evidence}`);
          for (const utility of state.utilities) assert.ok(state.logo.right <= utility.left + 1, `School artwork does not overlap native utility controls: ${evidence}`);
          assert.ok(state.documentWidth <= state.viewport + 1, `School logos do not make the page overflow: ${evidence}`);
        } else if (baseline) {
          assert.deepEqual(sizes[shape], baseline[shape], `Cleanup restores the native sizing of ${shape} school artwork`);
        }
      }
    }
  } finally {
    await native.image.evaluate(async (image, source) => { image.setAttribute('src', source); await image.decode(); }, originalSource);
    await page.setViewport(viewport);
  }
  return sizes;
}

async function selectedHeaderTab(page: Page, expected: string): Promise<void> {
  // Keep hover styling separate from the route's selected appearance.
  await page.mouse.move(0, 800);
  const tabs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('#site-nav-lower ul > li > a')].map((control) => {
    const style = getComputedStyle(control);
    return {
      label: control.textContent?.trim(), current: control.getAttribute('data-bn-header-current'),
      nativeActive: control.parentElement!.classList.contains('active'),
      background: style.backgroundColor, color: style.color, shadow: style.boxShadow, weight: Number(style.fontWeight),
    };
  }));
  assert.deepEqual(tabs.filter(({ current }) => current === 'true').map(({ label }) => label), [expected]);
  const selected = tabs.find(({ label }) => label === expected)!;
  assert.equal(selected.background, 'rgba(0, 0, 0, 0)', `The active local page uses an underline instead of a filled button: ${JSON.stringify(tabs)}`);
  assert.notEqual(selected.shadow, 'none', 'The current local page has a visible underline indicator');
  for (const tab of tabs.filter(({ label }) => label !== expected)) {
    assert.equal(tab.background, 'rgba(0, 0, 0, 0)', `Unselected tabs stay quiet: ${JSON.stringify(tabs)}`);
    assert.notEqual(tab.color, selected.color, `Stale native active classes must not retain the selected text color: ${JSON.stringify(tabs)}`);
    assert.ok(selected.weight > tab.weight, `The current page has stronger text: ${JSON.stringify(tabs)}`);
  }
  const progress = tabs.find(({ label }) => label === 'Progress')!;
  assert.ok(progress.nativeActive, 'Appearance preserves the original native Progress active class');
  if (expected !== 'Progress') assert.equal(progress.shadow, 'none', 'A stale native active class does not keep the selected indicator');
}

async function malformedPrimaryFallback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const action = document.createElement('button');
    action.id = 'unfamiliar-header-action';
    action.textContent = 'Native action';
    document.querySelector('#group-header-Classes [data-bn-header-part="primary-title"]')!.append(action);
  });
  await page.waitForFunction(() => !document.querySelector('[data-bn-header-part], [data-bn-header-current]'), { polling: 50 });
  const fallback = await page.evaluate(() => ({
    rows: ['site-header-parent-container', 'site-nav-container', 'site-nav-lower'].map((id) => {
      const { top, height } = document.getElementById(id)!.getBoundingClientRect(); return { top, height };
    }),
    spacer: document.getElementById('site-top-spacer')!.getBoundingClientRect().height,
    content: document.querySelector('#site-main, sky-toolbar')!.getBoundingClientRect().top,
  }));
  assert.deepEqual(fallback.rows, [{ top: 0, height: 45 }, { top: 45, height: 55 }, { top: 100, height: 52 }], 'An unfamiliar native primary label restores all coordinated fixed-row offsets together');
  assert.equal(fallback.spacer, 180, 'Fallback restores the native spacer height');
  assert.ok(fallback.content >= 152, 'Fallback content remains below the native fixed rows');
  await page.evaluate(() => document.getElementById('unfamiliar-header-action')!.remove());
  await page.waitForFunction(() => document.querySelector('#site-top-spacer')!.getAttribute('data-bn-header-part') === 'spacer' && document.querySelectorAll('[data-bn-navigation-icon]').length === 14, { polling: 50 });
  await fixedHeaderGeometry(page);
}

async function utilityLabels(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('[data-native-utility]')].map((control) => ({
    action: control.dataset.nativeUtility,
    href: control.getAttribute('href'),
    // The reversible account spacing preserves the native name's text.
    label: control.querySelector('.title')?.textContent?.replace(/\s/g, ''),
  })));
}

async function headerUtilities(page: Page, enhanced: boolean): Promise<void> {
  const state = await page.evaluate(() => ({
    lists: document.querySelectorAll('#site-header [data-bn-header-part="tools-list"]').length,
    controls: [...document.querySelectorAll<HTMLAnchorElement>('[data-native-utility]')].map((control) => {
      const icon = control.querySelector(':scope > svg[data-bn-navigation-icon]');
      const original = control.querySelector(':scope > i.p3icon-search, :scope > span.search');
      const badge = control.querySelector('.site-badge');
      const { left, right, top, bottom } = control.getBoundingClientRect();
      return {
        action: control.dataset.nativeUtility, marker: control.getAttribute('data-bn-header-part'),
        icon: icon?.getAttribute('data-bn-navigation-icon'),
        iconCount: control.querySelectorAll(':scope > svg[data-bn-navigation-icon]').length,
        iconHidden: icon?.getAttribute('aria-hidden'), iconFocusable: icon?.getAttribute('focusable'),
        originalMarker: original?.getAttribute('data-bn-native-icon'),
        originalDisplay: original ? getComputedStyle(original).display : null,
        badge: badge?.textContent, badgeMarker: badge?.getAttribute('data-bn-header-part'),
        badgeDisplay: badge ? getComputedStyle(badge).display : null,
        badgeEmpty: badge?.getAttribute('data-bn-header-count-empty'),
        caretDisplay: [...control.querySelectorAll(':scope > .caret, :scope > sky-icon[iconname="caret-down"]')]
          .map((caret) => getComputedStyle(caret).display),
        left, right, top, bottom,
      };
    }),
    markers: document.querySelectorAll('#site-header [data-bn-header-part]').length,
    searchLabels: document.querySelectorAll('[data-native-utility="search"] > .bn-header-search-label').length,
    avatars: document.querySelectorAll('#account-nav .bb-avatar-image-nav').length,
    accountTitle: document.querySelector('#account-nav .title')!.innerHTML,
    modern: !!document.querySelector('#site-user-nav edu-user-nav'),
    viewport: innerWidth,
  }));
  assert.equal(state.controls.length, 4);
  assert.equal(state.avatars, 1, 'The native account avatar remains intact');
  assert.equal(state.lists, enhanced ? 1 : 0);
  assert.equal(state.searchLabels, enhanced ? 1 : 0, 'Search gains one readable label that is removed during cleanup');
  if (!enhanced) {
    assert.equal(state.markers, 0, 'Disabling appearance restores all header markers');
    assert.equal(state.accountTitle, state.modern ? '<div>Alex</div><div>Student</div>' : 'Alex<br>Student', 'Cleanup removes inserted spacing and restores the native account name structure');
  }
  const glyphs = { search: 'search', notes: 'file-text', messages: 'mail' } as const;
  for (const control of state.controls) {
    assert.ok(control.caretDisplay.every((display) => display !== 'none'), 'Native utility menu affordances remain visible');
    if (control.badge != null) {
      assert.match(control.badge, /^\d+$/, 'The native count text is retained');
      const empty = Number(control.badge) === 0;
      assert.equal(control.badgeEmpty, enhanced ? String(empty) : null, 'Zero-count state is reversible and follows native values');
      if (enhanced && empty) assert.equal(control.badgeDisplay, 'none', 'Empty unread badges stay out of the utility row');
      else assert.notEqual(control.badgeDisplay, 'none', 'Positive unread counts and native fallback counts remain visible');
      assert.equal(control.badgeMarker, enhanced ? 'tool-count' : null);
    }
    const expected = glyphs[control.action as keyof typeof glyphs];
    if (enhanced) {
      assert.equal(control.marker, `tool-${control.action}`);
      assert.equal(control.iconCount, expected ? 1 : 0);
      if (expected) {
        assert.equal(control.icon, expected);
        assert.equal(control.iconHidden, 'true');
        assert.equal(control.iconFocusable, 'false');
      }
      if (state.viewport >= 992) assert.ok(control.left >= 0 && control.right <= state.viewport + 1 && control.bottom > control.top, `Header utilities fit: ${JSON.stringify(state)}`);
      if (control.action === 'search') {
        assert.equal(control.originalMarker, 'replaced');
        assert.equal(control.originalDisplay, 'none');
      }
    } else {
      assert.equal(control.iconCount, 0);
      assert.equal(control.marker, null);
      if (control.action === 'search') {
        assert.equal(control.originalMarker, null);
        assert.notEqual(control.originalDisplay, 'none', 'Cleanup restores the original native Search graphic');
      }
    }
  }
}

async function liveUtilityCounts(page: Page): Promise<void> {
  const badges = await page.$$('[data-native-utility] > .site-badge') as ElementHandle<HTMLSpanElement>[];
  const original = await Promise.all(badges.map((badge) => badge.evaluate((element) => element.textContent!)));
  try {
    for (const value of ['0', '12', '0']) {
      for (const badge of badges) await badge.evaluate((element, text) => { element.textContent = text; }, value);
      await page.waitForFunction((text) => [...document.querySelectorAll('[data-native-utility] > .site-badge')]
        .every((badge) => badge.getAttribute('data-bn-header-count-empty') === String(Number(text) === 0)), { polling: 50 }, value);
      for (const [index, badge] of badges.entries()) {
        const state = await badge.evaluate((element, position) => ({
          sameNode: document.querySelectorAll('[data-native-utility] > .site-badge')[position] === element,
          text: element.textContent, display: getComputedStyle(element).display,
        }), index);
        assert.ok(state.sameNode, 'Native asynchronous count updates retain their original badge nodes');
        assert.equal(state.text, value, 'Appearance never rewrites native unread count values');
        assert.equal(state.display === 'none', value === '0', `Only zero unread counts are hidden: ${JSON.stringify(state)}`);
      }
    }
  } finally {
    for (const [index, badge] of badges.entries()) await badge.evaluate((element, value) => { element.textContent = value; }, original[index]!);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-native-utility] > .site-badge')]
      .every((badge) => badge.getAttribute('data-bn-header-count-empty') === String(Number(badge.textContent) === 0)), { polling: 50 });
    for (const badge of badges) await badge.dispose();
  }
}

async function longAccountName(page: Page, logo: NativeSchoolLogo): Promise<void> {
  const viewport = page.viewport()!;
  const account = (await page.$('#account-nav .title'))!;
  const originalSource = await logo.image.evaluate((image) => image.getAttribute('src')!);
  const original = await account.evaluate((title) => {
    const lines = title.children.length === 2 ? [...title.children] : [...title.childNodes].filter((node) => node.nodeType === 3 && node.textContent?.trim());
    const text = lines.map((node) => node.textContent!);
    lines[0]!.textContent = 'Alexandria-Catherine'; lines[1]!.textContent = 'Van der Montgomery-Wellington';
    return text;
  });
  try {
    await logo.image.evaluate(async (image) => { image.src = `${location.origin}/fixture-logo.svg?shape=ultra-wide`; await image.decode(); });
    await page.waitForSelector('#account-nav [data-bn-header-part="account-name"]');
    for (const width of [992, 1150, 1280]) {
      await page.setViewport({ width, height: 900 });
      const state = await account.evaluate((title) => {
        const bounds = (element: Element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom };
        };
        const controls = [...document.querySelectorAll('[data-native-utility]')].map(bounds);
        const style = getComputedStyle(title);
        return {
          sameNode: title === document.querySelector('#account-nav .title'), text: title.textContent?.replace(/\s/g, ''),
          name: bounds(title), overflow: style.overflowX, ellipsis: style.textOverflow,
          controls, logo: bounds(document.querySelector('#site-logo img')!), header: bounds(document.querySelector('#site-header')!),
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
        };
      });
      const evidence = `${width}px: ${JSON.stringify(state)}`;
      assert.ok(state.sameNode, 'A long account name preserves the native title node');
      assert.equal(state.text, 'Alexandria-CatherineVanderMontgomery-Wellington', 'The complete school-provided name remains in the DOM');
      assert.equal(state.ellipsis, 'ellipsis', `Long names receive a visual ellipsis: ${evidence}`);
      assert.equal(state.overflow, 'hidden', `Long names are clipped within their own label: ${evidence}`);
      assert.ok(state.documentWidth <= state.viewport + 1, `Long names and wide school logos do not widen the page: ${evidence}`);
      for (const [index, control] of state.controls.entries()) {
        assert.ok(control.left >= state.header.left - 1 && control.right <= state.header.right + 1 && control.top >= state.header.top - 1 && control.bottom <= state.header.bottom + 1, `Utilities fit the compact masthead: ${evidence}`);
        assert.ok(control.left >= (index ? state.controls[index - 1]!.right : state.logo.right) - 1, `The wide school logo and utility controls do not overlap: ${evidence}`);
      }
      await fixedHeaderGeometry(page);
    }
    await page.bringToFront();
    await page.click('#account-nav');
    await page.waitForFunction(() => document.body.dataset.lastUtilityAction === 'account' && getComputedStyle(document.querySelector('[data-native-menu="account"]')!).display !== 'none', { polling: 50 });
  } finally {
    await page.evaluate(() => document.body.click());
    await account.evaluate((title, text) => {
      const lines = title.children.length === 2 ? [...title.children] : [...title.childNodes].filter((node) => node.nodeType === 3 && node.textContent?.trim());
      lines.forEach((node, index) => { node.textContent = text[index]!; });
    }, original);
    await logo.image.evaluate(async (image, source) => { image.src = source; await image.decode(); }, originalSource);
    await page.setViewport(viewport);
    await account.dispose();
  }
}

async function longSecondaryNavigation(page: Page, setAppearance: (enabled: boolean) => Promise<void>): Promise<void> {
  const viewport = page.viewport()!;
  const labels = await page.evaluate(() => [...document.querySelectorAll('#site-nav-lower ul > li > a')].map((link, index) => {
    const text = [...link.childNodes].find((node) => node.nodeType === 3 && node.textContent?.trim())!;
    const original = text.textContent!;
    text.textContent = `${original} and extended school planning information for this academic year ${index + 1}`;
    return original;
  }));
  try {
    await page.waitForSelector('[data-bn-header-part="tabs-navigation"]');
    for (const width of [992, 1150, 1280]) {
      await page.setViewport({ width, height: 900 });
      await page.bringToFront();
      const state = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-bn-header-part="tabs-navigation"]')!;
        const controls = [...list.querySelectorAll<HTMLAnchorElement>(':scope > li > a')];
        const style = getComputedStyle(list);
        return {
          height: list.getBoundingClientRect().height, rowHeight: document.getElementById('site-nav-lower')!.getBoundingClientRect().height,
          overflow: style.overflowX, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth,
          controls: controls.map((control) => {
            const { top, bottom } = control.getBoundingClientRect();
            const text = document.createRange(); text.selectNodeContents(control);
            return { top, bottom, whiteSpace: getComputedStyle(control).whiteSpace, textHeight: text.getBoundingClientRect().height };
          }),
        };
      });
      const evidence = `${width}px: ${JSON.stringify(state)}`;
      assert.equal(state.rowHeight, 55, `Long secondary labels retain the fixed third-bar height: ${evidence}`);
      assert.equal(state.height, 55, `Secondary controls remain in a single row: ${evidence}`);
      assert.ok(/auto|scroll/.test(state.overflow) && state.scrollWidth > state.clientWidth, `Overflowing labels use an internal horizontal scroller: ${evidence}`);
      assert.ok(state.controls.every((control) => control.whiteSpace === 'nowrap' && Math.abs(control.top - state.controls[0]!.top) < 1 && control.bottom - control.top <= 55), `Long labels do not wrap or grow the bar: ${evidence}`);
      await page.focus('#site-nav-lower ul > li:first-child > a');
      for (let index = 0; index < 3; index += 1) await page.keyboard.press('Tab');
      await page.waitForFunction(() => {
        const list = document.querySelector<HTMLElement>('[data-bn-header-part="tabs-navigation"]')!;
        const row = list.getBoundingClientRect(); const control = list.querySelector(':scope > li:last-child > a')!.getBoundingClientRect();
        return control.left >= row.left - 1 && control.right <= row.right + 1;
      }, { polling: 'raf', timeout: 2_000 });
      const focused = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-bn-header-part="tabs-navigation"]')!;
        const control = list.querySelector<HTMLAnchorElement>(':scope > li:last-child > a')!;
        const row = list.getBoundingClientRect(); const target = control.getBoundingClientRect(); const style = getComputedStyle(control);
        return { active: document.activeElement === control, scroll: list.scrollLeft, left: target.left, right: target.right, rowLeft: row.left, rowRight: row.right, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
      });
      assert.ok(focused.active && focused.scroll > 0, `Native keyboard navigation scrolls the final tab into view: ${JSON.stringify(focused)}`);
      assert.ok(focused.left >= focused.rowLeft - 1 && focused.right <= focused.rowRight + 1, `The focused action is fully visible inside its scroller: ${JSON.stringify(focused)}`);
      assert.equal(focused.outlineWidth, '2px', 'Secondary tabs retain a visible keyboard focus outline');
      assert.notEqual(focused.outlineStyle, 'none');
      const before = await page.evaluate(() => Number(document.body.dataset.navigationActions || 0));
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => Number(document.body.dataset.navigationActions || 0)), before + 1, 'The scrolled tab keeps its original native action');
    }
    await page.setViewport({ width: 1280, height: 900 });
    await setAppearance(false);
    const native = await page.evaluate(() => {
      const list = document.querySelector('#site-nav-lower ul')!;
      return { marker: list.getAttribute('data-bn-header-part'), overflow: getComputedStyle(list).overflowX, rowHeight: document.getElementById('site-nav-lower')!.getBoundingClientRect().height, labels: [...list.querySelectorAll('a')].map((link) => link.textContent) };
    });
    assert.equal(native.marker, null, 'Disabling appearance removes the tab scroller marker');
    assert.equal(native.overflow, 'visible', 'Cleanup restores the native list overflow');
    assert.equal(native.rowHeight, 52, 'Cleanup restores the native third-bar height');
    assert.ok(native.labels.every((label) => label?.includes('extended school planning information')), 'Cleanup preserves the complete native long labels');
    await setAppearance(true);
  } finally {
    await page.evaluate((original) => [...document.querySelectorAll('#site-nav-lower ul > li > a')].forEach((link, index) => {
      const text = [...link.childNodes].find((node) => node.nodeType === 3 && node.textContent?.trim())!;
      text.textContent = original[index]!;
    }), labels);
    await page.evaluate(() => { document.querySelector('#site-nav-lower ul')!.scrollLeft = 0; document.body.click(); });
    await page.setViewport(viewport);
  }
}

async function nativeMobileDrawer(page: Page, enhanced: boolean): Promise<void> {
  const viewport = page.viewport()!;
  const button = (await page.$('#site-mobile-btn button'))!;
  const drawer = (await page.$('#fixture-native-drawer'))!;
  try {
    await page.setViewport({ width: 391, height: 844 });
    await page.bringToFront();
    const before = await page.evaluate(() => Number(document.body.dataset.drawerActions || 0));
    await button.click();
    await page.waitForSelector('#fixture-native-drawer:not([hidden])');
    assert.equal(await button.evaluate((element) => element.getAttribute('aria-expanded')), 'true', 'The original native mobile handler opens its drawer');
    assert.equal(await drawer.evaluate((element) => element === document.getElementById('fixture-native-drawer') && !element.hasAttribute('data-bn-header-part')), true, 'Appearance leaves the native mobile drawer node and structure intact');
    assert.equal(await page.evaluate(() => Number(document.body.dataset.drawerActions)), before + 1);
    assert.deepEqual(await page.evaluate(() => ['site-user-nav', 'site-nav-container', 'site-nav-lower'].map((id) => getComputedStyle(document.getElementById(id)!).display)), ['none', 'none', 'none'], 'The mobile drawer retains control while desktop bars stay hidden');
    if (enhanced) {
      const geometry = await button.evaluate((element) => {
        const button = element.getBoundingClientRect(); const logo = document.querySelector('#site-logo img')!.getBoundingClientRect();
        return { width: button.width, height: button.height, buttonRight: button.right, logoLeft: logo.left, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      assert.ok(geometry.width >= 44 && geometry.height >= 44 && geometry.buttonRight <= geometry.logoLeft + 1, `The mobile trigger stays comfortably sized beside the school logo: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.documentWidth <= geometry.viewport + 1, 'The native drawer does not widen the mobile page');
    }
    await page.click('#fixture-native-drawer button');
    await page.waitForSelector('#fixture-native-drawer[hidden]');
    assert.equal(await button.evaluate((element) => element.getAttribute('aria-expanded')), 'false', 'The original native drawer close handler is preserved');
  } finally {
    await page.setViewport(viewport); await button.dispose(); await drawer.dispose();
  }
}

async function nativeUtilityActions(page: Page): Promise<void> {
  await page.bringToFront();
  const before = await page.evaluate(() => ({
    actions: Number(document.body.dataset.utilityActions || 0),
    notes: Number(document.querySelector('[data-native-utility="notes"] .site-badge')!.textContent),
    messages: Number(document.querySelector('[data-native-utility="messages"] .site-badge')!.textContent),
  }));
  for (const action of ['search', 'notes', 'messages', 'account']) {
    await page.click(`[data-native-utility="${action}"]`);
    await page.waitForFunction((expected) => document.body.dataset.lastUtilityAction === expected, { polling: 50 }, action);
    if (action === 'search') assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#site-search-input')!.closest('.subnav')!).display), 'block', 'The native Search submenu still opens');
  }
  const after = await page.evaluate(() => ({
    actions: Number(document.body.dataset.utilityActions || 0),
    notes: Number(document.querySelector('[data-native-utility="notes"] .site-badge')!.textContent),
    messages: Number(document.querySelector('[data-native-utility="messages"] .site-badge')!.textContent),
  }));
  assert.deepEqual(after, { actions: before.actions + 4, notes: before.notes + 1, messages: before.messages + 1 }, 'Native utility handlers and live count updates survive the header enhancement');
  // The native outside-click handler closes the menu without replacing any action.
  await page.mouse.click(8, 800);
}

async function menuLabels(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-native-menu] a')].map((link) => ({
    label: link.textContent, href: link.getAttribute('href'),
  })));
}

async function openNativeMenu(page: Page, id: string): Promise<void> {
  await page.bringToFront();
  await page.click(id === 'search' || id === 'account' ? `[data-native-utility="${id}"]` : `#${id}`);
  await page.waitForFunction((menuId) => {
    const menu = document.querySelector(`[data-native-menu="${menuId}"]`)!;
    return getComputedStyle(menu).display !== 'none' && menu.getBoundingClientRect().height > 0;
  }, { polling: 50 }, id);
}

async function keyboardFocusStyle(page: Page, selector: string): Promise<void> {
  await page.focus(selector);
  // Keyboard input enables Chrome's focus-visible state even after a pointer click.
  await page.keyboard.press('Tab');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  const state = await page.$eval(selector, (control) => {
    const style = getComputedStyle(control);
    return { focused: document.activeElement === control, outline: style.outlineStyle, width: style.outlineWidth, background: style.backgroundColor };
  });
  assert.ok(state.focused, `Keyboard focus returns to the original native control: ${JSON.stringify(state)}`);
  assert.equal(state.width, '2px', `Native header controls have visible keyboard focus: ${JSON.stringify(state)}`);
  assert.notEqual(state.outline, 'none');
}

async function nativeDropdowns(page: Page, enhanced: boolean): Promise<void> {
  const viewport = page.viewport()!;
  const ids = ['myday', 'group-header-Classes', 'group-header-Groups', 'group-header-News', 'directory-subnav', 'account', 'search'];
  try {
    for (const [width, height] of enhanced ? [[992, 500], [1280, 900]] : [[1280, 900]]) {
      await page.setViewport({ width: width!, height: height! });
      for (const id of ids) {
        await openNativeMenu(page, id);
        const state = await page.evaluate((menuId) => {
          const menu = document.querySelector<HTMLElement>(`[data-native-menu="${menuId}"]`)!;
          const { left, right, top, bottom, height } = menu.getBoundingClientRect();
          const link = menu.querySelector<HTMLAnchorElement>('a');
          const label = link?.getBoundingClientRect();
          const pointer = menu.parentElement!.querySelector('.subnavtop')!;
          const scrollable = [menu, ...menu.querySelectorAll<HTMLElement>('ul')].filter((element) => element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY));
          return {
            marker: menu.getAttribute('data-bn-header-part'), left, right, top, bottom, height,
            viewport: { width: innerWidth, height: innerHeight },
            pointer: getComputedStyle(pointer).display,
            firstLink: label && { left: label.left, right: label.right, height: label.height },
            scrollable: scrollable.length,
          };
        }, id);
        const evidence = `${id}: ${JSON.stringify(state)}`;
        if (enhanced) {
          assert.equal(state.marker, id === 'group-header-Classes' ? 'dropdown-classes' : 'dropdown', `Verified native menu is enhanced: ${evidence}`);
          assert.ok(state.left >= -1 && state.right <= state.viewport.width + 1 && state.top >= -1 && state.bottom <= state.viewport.height + 1, `Open dropdown stays inside a short viewport: ${evidence}`);
          assert.equal(state.pointer, 'none', 'Native triangle decorations do not protrude from redesigned menus');
          if (state.firstLink) {
            assert.ok(state.firstLink.left >= state.left - 1 && state.firstLink.right <= state.right + 1, `Native menu actions fit the panel: ${evidence}`);
            assert.ok(state.firstLink.height >= 36, `Menu actions have comfortable click targets: ${evidence}`);
          }
          if (id === 'group-header-Classes') assert.ok(state.scrollable > 0, `Long class lists scroll inside the panel: ${evidence}`);
          if (id === 'group-header-Classes') {
            const trigger = await page.$eval('#group-header-Classes', (control) => ({
              color: getComputedStyle(control.querySelector('[data-bn-header-part="primary-title"]')!).color,
              background: getComputedStyle(control).backgroundColor,
            }));
            assert.equal(trigger.color, 'rgb(27, 93, 137)', 'An open primary menu gives its native trigger the active blue text');
            assert.notEqual(trigger.background, 'rgba(0, 0, 0, 0)', 'An open primary menu has a quiet visible trigger state');
          }
        } else {
          assert.equal(state.marker, null, 'Cleanup returns native dropdown markup');
          assert.equal(state.pointer, 'block', 'Cleanup restores the native menu pointer');
        }
        if (id !== 'search') {
          const before = await page.evaluate(() => Number(document.body.dataset.menuActions || 0));
          const selector = `[data-native-menu="${id}"] a`;
          const destination = await page.$eval(selector, (link) => link.getAttribute('href'));
          if (enhanced) {
            await keyboardFocusStyle(page, selector);
            assert.equal(await page.$eval(selector, (control) => getComputedStyle(control).backgroundColor), 'rgb(237, 244, 250)', 'Keyboard focus receives the same readable menu-row tint as hover');
          }
          if (id === 'account') {
            await page.focus(selector);
            await page.keyboard.press('Enter');
          } else await page.click(selector);
          await page.waitForFunction((expected) => document.body.dataset.lastMenuAction === expected, { polling: 50 }, destination);
          assert.equal(await page.evaluate(() => Number(document.body.dataset.menuActions)), before + 1, 'Native menu link handlers remain attached');
        }
        await page.mouse.click(8, height! - 10);
      }
    }
  } finally {
    await page.evaluate(() => document.body.click());
    await page.setViewport(viewport);
  }
}

async function nativeDropdownHover(page: Page, enhanced: boolean): Promise<void> {
  const viewport = page.viewport()!;
  const ids = ['myday', 'group-header-Classes', 'group-header-Groups', 'group-header-News', 'directory-subnav'];
  try {
    await page.bringToFront();
    for (const width of enhanced ? [992, 1280] : [1280]) {
      await page.setViewport({ width, height: 900 });
      for (const id of ids) {
        await page.mouse.move(8, 800);
        const anchor = await page.$eval(`#${id}`, (link) => {
          const { left, bottom, width } = link.getBoundingClientRect();
          return { x: left + width / 2, y: bottom - 2 };
        });
        await page.mouse.move(anchor.x, anchor.y);
        await page.waitForFunction((menuId) => getComputedStyle(document.querySelector(`[data-native-menu="${menuId}"]`)!).display !== 'none', { polling: 50 }, id);
        const menu = await page.evaluate((menuId) => {
          const control = document.getElementById(menuId)!;
          const panel = control.parentElement!.querySelector(`[data-native-menu="${menuId}"]`)!;
          // My Day's second row catches moving all the way into the menu, beyond
          // the first Progress row and the six-pixel gap above the panel.
          const action = panel.querySelector<HTMLAnchorElement>(menuId === 'myday' ? 'a[href*="#studentmyday/schedule"]' : 'a')!;
          const bounds = action.getBoundingClientRect();
          return {
            top: panel.getBoundingClientRect().top,
            parentBottom: control.parentElement!.getBoundingClientRect().bottom,
            left: bounds.left, right: bounds.right, y: bounds.top + bounds.height / 2,
            destination: action.getAttribute('href'),
            nativeActive: control.parentElement!.classList.contains('active'),
            bridge: getComputedStyle(control.parentElement!, '::after').content,
          };
        }, id);
        const evidence = `${id} at ${width}px: ${JSON.stringify({ anchor, menu })}`;
        if (id === 'myday' && page.url().includes('/app/student')) assert.ok(menu.nativeActive, `The regression covers Blackbaud's native active My Day item: ${evidence}`);
        if (enhanced) assert.ok(menu.top - menu.parentBottom >= 5 && menu.top - menu.parentBottom <= 7, `The redesigned panel retains its visual gap: ${evidence}`);
        else {
          assert.ok(Math.abs(menu.top - menu.parentBottom) < 1, `Cleanup restores the native panel position: ${evidence}`);
          assert.equal(menu.bridge, 'none', 'Cleanup removes the transparent hover bridge');
        }
        assert.ok(anchor.x > menu.left && anchor.x < menu.right, `The straight pointer path reaches the native submenu action: ${evidence}`);
        const crossed = [];
        // Move one pixel at a time across the visual gap. A teleport from trigger
        // to panel would miss the native mouseleave that caused the reported bug.
        for (let y = anchor.y + 1; y <= menu.top + 2; y += 1) {
          await page.mouse.move(anchor.x, y);
          const point = await page.evaluate((menuId, x, y) => {
            const control = document.getElementById(menuId)!;
            const panel = control.parentElement!.querySelector(`[data-native-menu="${menuId}"]`)!;
            return {
              x, y, open: getComputedStyle(panel).display !== 'none',
              ownsPointer: control.parentElement!.contains(document.elementFromPoint(x, y)),
            };
          }, id, anchor.x, y);
          crossed.push(point);
          assert.ok(point.open && point.ownsPointer, `Native hover stays open while crossing into the panel: ${evidence}; ${JSON.stringify(crossed)}`);
        }
        await page.mouse.move(anchor.x, menu.y, { steps: Math.max(1, Math.ceil((menu.y - menu.top - 2) / 3)) });
        const target = await page.evaluate((menuId, x, y) => {
          const panel = document.querySelector(`[data-native-menu="${menuId}"]`)!;
          const link = document.elementFromPoint(x, y)?.closest('a');
          return { open: getComputedStyle(panel).display !== 'none', hit: link?.getAttribute('href') };
        }, id, anchor.x, menu.y);
        assert.deepEqual(target, { open: true, hit: menu.destination }, `The native action remains hit-testable after crossing the gap: ${evidence}`);
        const before = await page.evaluate(() => Number(document.body.dataset.menuActions || 0));
        await page.mouse.click(anchor.x, menu.y);
        assert.deepEqual(await page.evaluate(() => ({ actions: Number(document.body.dataset.menuActions), destination: document.body.dataset.lastMenuAction })), { actions: before + 1, destination: menu.destination }, 'A real pointer click reaches the original native submenu handler');
      }
    }
  } finally {
    await page.mouse.move(8, 800);
    await page.evaluate(() => document.body.click());
    await page.setViewport(viewport);
  }
}

async function unfamiliarDropdownFallback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const row = document.createElement('li');
    const control = document.createElement('button');
    row.id = 'unfamiliar-dropdown-row';
    control.textContent = 'Native group action';
    control.addEventListener('click', () => { document.body.dataset.unfamiliarGroupAction = 'used'; });
    row.append(control);
    document.querySelector('[data-native-menu="group-header-Groups"] > ul')!.append(row);
  });
  await page.waitForFunction(() => !document.querySelector('[data-native-menu="group-header-Groups"]')!.hasAttribute('data-bn-header-part'), { polling: 50 });
  assert.equal(await page.$eval('#site-top-spacer', (spacer) => spacer.getAttribute('data-bn-header-part')), 'spacer', 'An unfamiliar menu does not remove the independently verified header layout');
  assert.equal(await page.$eval('[data-native-menu="directory-subnav"]', (menu) => menu.getAttribute('data-bn-header-part')), 'dropdown', 'Other verified dropdowns keep their appearance');
  await openNativeMenu(page, 'group-header-Groups');
  await page.click('#unfamiliar-dropdown-row button');
  assert.equal(await page.evaluate(() => document.body.dataset.unfamiliarGroupAction), 'used', 'An unfamiliar native menu control remains usable');
  await page.evaluate(() => document.getElementById('unfamiliar-dropdown-row')!.remove());
  await page.waitForFunction(() => document.querySelector('[data-native-menu="group-header-Groups"]')!.getAttribute('data-bn-header-part') === 'dropdown', { polling: 50 });
}

async function classSearchMenu(page: Page): Promise<void> {
  await page.setViewport({ width: 992, height: 500 });
  await openNativeMenu(page, 'group-header-Classes');
  const input = '[data-native-menu="group-header-Classes"] .bn-class-search input';
  await page.waitForSelector(input);
  await page.click(input);
  await page.type(input, 'cafe studies');
  await page.waitForFunction(() => document.querySelector('[data-native-menu="group-header-Classes"] .bn-tool-status')!.textContent === '1 of 40 classes', { polling: 50 }).catch(async (error: unknown) => {
    const evidence = await page.evaluate(() => ({
      url: location.href, focused: document.activeElement?.outerHTML,
      input: document.querySelector<HTMLInputElement>('.bn-class-search input')?.value,
      status: document.querySelector('.bn-tool-status')?.textContent,
      hidden: document.querySelectorAll('[data-blackbaud-next-class-hidden]').length,
      menu: getComputedStyle(document.querySelector('[data-native-menu="group-header-Classes"]')!).display,
    }));
    throw new Error(`Class filtering did not finish: ${JSON.stringify(evidence)}`, { cause: error });
  });
  const filtered = await page.evaluate(() => {
    const menu = document.querySelector('[data-native-menu="group-header-Classes"]')!;
    return {
      open: getComputedStyle(menu).display,
      rows: [...menu.querySelectorAll<HTMLAnchorElement>('a[data-taskid="1853"]')].filter((link) => getComputedStyle(link.parentElement!).display !== 'none').map((link) => link.textContent),
      footer: getComputedStyle(menu.querySelector('.subnavfooter')!).display,
    };
  });
  assert.notEqual(filtered.open, 'none', 'Typing and clicking class search do not close the native menu');
  assert.deepEqual(filtered.rows, ['Café Studies'], 'Class search filters the native course rows');
  assert.notEqual(filtered.footer, 'none', 'Native class footer actions remain visible while filtering');
  await page.click('[data-native-menu="group-header-Classes"] .bn-class-search button');
  await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-class-hidden]'), { polling: 50 });
  assert.equal(await page.$eval(input, (element) => (element as HTMLInputElement).value), '', 'Clear restores the whole native class list');
  const scrolled = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[data-native-menu="group-header-Classes"]')!;
    const scrollable = [menu, ...menu.querySelectorAll<HTMLElement>('ul')].find((element) => element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY))!;
    scrollable.scrollTop = scrollable.scrollHeight;
    const bounds = menu.getBoundingClientRect();
    const toolbar = menu.querySelector('.bn-class-search')!.getBoundingClientRect();
    return { scrollTop: scrollable.scrollTop, menuTop: bounds.top, menuBottom: bounds.bottom, searchTop: toolbar.top, searchBottom: toolbar.bottom };
  });
  assert.ok(scrolled.scrollTop > 0, 'Long class lists can be scrolled');
  assert.ok(scrolled.searchTop >= scrolled.menuTop - 1 && scrolled.searchBottom <= scrolled.menuBottom + 1, `Class search stays accessible while scrolling: ${JSON.stringify(scrolled)}`);
  // Leave a filtered state so disabling class switching must restore native rows.
  await page.click(input);
  await page.type(input, 'geometry');
  await page.waitForFunction(() => document.querySelectorAll('[data-blackbaud-next-class-hidden]').length === 39, { polling: 50 });
  await page.evaluate(() => document.body.click());
  await page.setViewport({ width: 1280, height: 900 });
}

async function preservedNativeProgressContent(page: Page): Promise<void> {
  const preserved = await page.evaluate(() => {
    const expected = (window as Window & { nativeProgressContent?: NativeProgressContent }).nativeProgressContent;
    if (!expected) throw new Error('The fixture must capture its native Progress content before styling.');
    return {
      list: document.getElementById('coursesContainer') === expected.list,
      rows: expected.rows.every(({ row, columns, text }) => row.isConnected && row.children.length === 5 &&
        [...row.children].every((column, index) => column === columns[index]) && row.textContent === text),
      controls: expected.controls.every(({ element, href, disabled, hidden }) => element.isConnected &&
        document.getElementById(element.id) === element && element.getAttribute('href') === href &&
        ('disabled' in element && element.disabled === true) === disabled && element.hidden === hidden),
      count: expected.list.querySelectorAll('a,button,select').length === expected.controls.length,
    };
  });
  assert.deepEqual(preserved, { list: true, rows: true, controls: true, count: true }, 'Cards preserve native content, column order, and control nodes');
}

async function nativeProgressCourseActions(page: Page): Promise<void> {
  await page.bringToFront();
  const counts = () => page.evaluate(() => JSON.parse(document.body.dataset.progressActions || '{}') as Record<string, number>);
  const before = await counts();
  for (const action of ['course', 'grade', 'email', 'message']) await page.click(`#course-one-${action}`);
  const current = await page.$eval('#course-one-term', (select) => (select as HTMLSelectElement).value);
  await page.select('#course-one-term', current === 'fall' ? 'spring' : 'fall');
  const after = await counts();
  for (const action of ['course', 'grade', 'email', 'message', 'term']) assert.equal(after[action], (before[action] ?? 0) + 1, `Native ${action} handler remains attached`);
  await page.click('#course-three-message');
  assert.deepEqual(await counts(), after, 'The native disabled message control stays disabled');
  await preservedNativeProgressContent(page);
}

async function progressCourseGeometry(page: Page, columns: number): Promise<void> {
  const layout = await page.evaluate(() => {
    const list = document.getElementById('coursesContainer')!;
    const bounds = (element: Element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height };
    };
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > .row')].filter((row) => !row.hidden);
    const overflow: string[] = [];
    const outside: string[] = [];
    for (const row of rows) {
      const card = bounds(row);
      for (const element of [row, ...row.querySelectorAll<HTMLElement>('div,h3,h4,h5,p,a,button,select,img')]) {
        if (element.closest('[hidden]') || getComputedStyle(element).visibility === 'hidden') continue;
        const box = bounds(element);
        if (!box.width || !box.height) continue;
        if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2) overflow.push(element.id || element.className);
        if (box.left < card.left - 1 || box.right > card.right + 1 || box.top < card.top - 1 || box.bottom > card.bottom + 1) outside.push(element.id || element.className);
      }
    }
    const style = getComputedStyle(list);
    return {
      display: style.display, columns: style.gridTemplateColumns.split(' ').length, cards: rows.map(bounds),
      hiddenRow: bounds(document.getElementById('course-hidden')!).height,
      hiddenColumn: bounds(document.querySelector('#course-two > [hidden]')!).height,
      disabled: (document.getElementById('course-three-message') as HTMLButtonElement).disabled,
      overflow, outside, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(layout.display, 'grid');
  assert.equal(layout.columns, columns, JSON.stringify(layout));
  assert.equal(layout.cards.length, 3);
  assert.equal(layout.hiddenRow, 0, 'Native hidden rows must stay hidden');
  assert.equal(layout.hiddenColumn, 0, 'Native hidden columns must stay hidden');
  assert.equal(layout.disabled, true);
  assert.deepEqual(layout.overflow, [], `Native course contents must wrap without clipping: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.outside, [], `All native controls and labels must fit inside their card: ${JSON.stringify(layout)}`);
  assert.ok(layout.documentWidth <= layout.viewport + 1, JSON.stringify(layout));
  if (columns === 2) {
    assert.ok(Math.abs(layout.cards[0]!.top - layout.cards[1]!.top) < 1, JSON.stringify(layout));
    assert.ok(layout.cards[1]!.left >= layout.cards[0]!.right, JSON.stringify(layout));
  } else assert.ok(layout.cards[1]!.top >= layout.cards[0]!.bottom, JSON.stringify(layout));
  await preservedNativeProgressContent(page);
}

async function nativeProgressCards(page: Page): Promise<void> {
  await page.waitForSelector('#coursesContainer[data-bn-progress-courses="cards"]');
  for (const width of [1280, 1100, 1099, 850, 390, 320]) {
    await page.setViewport({ width, height: 900 });
    await progressCourseGeometry(page, width >= 1100 ? 2 : 1);
  }
  await nativeProgressCourseActions(page);
  await page.evaluate(() => {
    const status = document.createElement('p'); status.id = 'unexpected-course-content'; status.textContent = 'Native loading status';
    document.getElementById('coursesContainer')!.append(status);
  });
  await page.waitForFunction(() => !document.getElementById('coursesContainer')!.hasAttribute('data-bn-progress-courses'), { polling: 50 });
  assert.notEqual(await page.$eval('#coursesContainer', (list) => getComputedStyle(list).display), 'grid', 'Unknown direct native content returns to the native list layout');
  assert.equal(await page.$$eval('#coursesContainer > [data-bn-course-row="true"]', (rows) => rows.length), 4, 'Known rows retain their individual markers during list fallback');
  await preservedNativeProgressContent(page);
  await page.evaluate(() => document.getElementById('unexpected-course-content')!.remove());
  await page.waitForSelector('#coursesContainer[data-bn-progress-courses="cards"]');
  await progressCourseGeometry(page, 1);
  await page.setViewport({ width: 1280, height: 900 });
  await progressCourseGeometry(page, 2);
}

async function summaryBounds(page: Page) {
  return page.evaluate(() => {
    const bounds = (element: Element) => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect(); return { left, right, top, bottom, width };
    };
    return {
      row: bounds(document.querySelector('#summary')!),
      cards: [...document.querySelectorAll('#summary section')].map(bounds),
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    };
  });
}

async function cardContentBounds(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('#summary section')].map((card) => {
    const bounds = card.getBoundingClientRect();
    const heading = card.querySelector('h2')!.getBoundingClientRect();
    const paragraph = card.querySelector('p')!.getBoundingClientRect();
    return { heading: heading.left, body: paragraph.left, leftGutter: paragraph.left - bounds.left, rightGutter: bounds.right - paragraph.right };
  }));
}

async function consistentCardContent(page: Page, gutter: number): Promise<void> {
  for (const card of await cardContentBounds(page)) {
    assert.ok(Math.abs(card.heading - card.body) < 1, `Card heading and body should share an edge: ${JSON.stringify(card)}`);
    // The card's native one-pixel border surrounds its content gutter.
    assert.ok(Math.abs(card.leftGutter - gutter - 1) < 1 && Math.abs(card.rightGutter - gutter - 1) < 1, JSON.stringify(card));
  }
}

async function viewportGutters(page: Page, gutter: number): Promise<void> {
  const edges = await page.evaluate(() => {
    const mobile = document.querySelector('#site-mobile-btn')!;
    const brand = mobile.getBoundingClientRect().width ? mobile : document.querySelector('#site-logo img')!;
    const row = document.querySelector('#summary')?.getBoundingClientRect();
    return { header: brand.getBoundingClientRect().left, left: row?.left, right: row?.right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(edges.documentWidth <= edges.viewport + 1, `The page should fit the viewport: ${JSON.stringify(edges)}`);
  assert.ok(Math.abs(edges.header - gutter) < 1, `The header should use one page gutter: ${JSON.stringify(edges)}`);
  if (edges.left !== undefined) assert.ok(Math.abs(edges.left - gutter) < 1 && Math.abs(edges.viewport - edges.right! - gutter) < 1, `Page content should use matching gutters: ${JSON.stringify(edges)}`);
}

async function nativeCollapse(page: Page): Promise<void> {
  // Native clicks need a foreground tab for Chrome's scroll/intersection work.
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await page.evaluate(() => Number(document.body.dataset.nativeActions || 0));
  await page.click('#summary #performance section button');
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#summary #performance section .bb-tile-content')!.hidden, { polling: 50 });
  await page.click('#summary #performance section button');
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('#summary #performance section .bb-tile-content')!.hidden, { polling: 50 });
  assert.equal(await page.evaluate(() => Number(document.body.dataset.nativeActions)), before + 2, 'Native collapse handler survives appearance changes');
}

async function nativeSchedule(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `#schedule-header > .container-fluid { padding-inline: 15px; }
      #schedule-header .row { margin-inline: -15px; } #schedule-header .col-md-12 { padding-inline: 15px; }
      #schedule-header .pull-right { float: right; } #schedule-header button { min-height: 36px; padding: 8px; }
      #schedule-header :is(.chCal-button-prev,.chCal-button-next) { float: left; width: 36px; }
      #schedule-header h2 { display: inline; margin: 0; }`;
    document.head.append(style);
    document.querySelector('#site-main')!.innerHTML = `<section class="bb-tile"><div class="bb-tile-title"><div><h2 class="bb-tile-header">Schedule</h2></div></div>
      <div class="bb-tile-content"><div class="bb-tile-content-section"><div id="schedule-header"><div class="container-fluid"><div class="row"><div class="col-md-12">
      <div class="pull-right"><button>Day</button><button>Week</button><button>Month</button></div><div><div>
      <button class="chCal-button-prev" aria-label="Previous day">‹</button><button class="chCal-button-next" aria-label="Next day">›</button>
      <h2 class="chCal-header-title">Friday, October 9, 2026</h2></div></div></div></div></div></div>
      <table><tbody id="accordionSchedules"><tr><td>Native schedule</td></tr></tbody></table></div></div></section>`;
    for (const [selector, direction] of [['.chCal-button-prev', -1], ['.chCal-button-next', 1]] as const) {
      document.querySelector(selector)!.addEventListener('click', () => {
        document.body.dataset.scheduleOffset = String(Number(document.body.dataset.scheduleOffset || 0) + direction);
        document.body.dataset.scheduleActions = String(Number(document.body.dataset.scheduleActions || 0) + 1);
      });
    }
    location.hash = '#studentmyday/schedule';
  });
  await page.waitForSelector('#site-main[data-bn-page="schedule"]');
  await selectedHeaderTab(page, 'Schedule');
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844 });
    const layout = await page.evaluate(() => {
      const bounds = (element: Element) => {
        const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom };
      };
      return {
        date: bounds(document.querySelector('#schedule-header h2')!), heading: bounds(document.querySelector('.bb-tile-header')!),
        controls: [...document.querySelectorAll('#schedule-header button')].map(bounds),
        viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(layout.documentWidth <= layout.viewport + 1, JSON.stringify(layout));
    assert.ok(Math.abs(layout.date.left - layout.heading.left) < 1, `The date and card heading should align: ${JSON.stringify(layout)}`);
    assert.ok(layout.date.top >= Math.max(...layout.controls.map((control) => control.bottom)), `The date should flow below the native controls: ${JSON.stringify(layout)}`);
  }
  await page.bringToFront();
  await page.click('.chCal-button-next');
  await page.click('.chCal-button-prev');
  assert.deepEqual(await page.evaluate(() => ({ offset: document.body.dataset.scheduleOffset, actions: document.body.dataset.scheduleActions })), { offset: '0', actions: '2' }, 'Native day navigation handlers remain attached');
}

test('compiled appearance preserves native navigation/icons, responsive cards, actions, and reversible layout', { timeout: 120_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-next-appearance-'));
  let browser: Awaited<ReturnType<typeof launchDevelopmentBrowser>> | undefined;
  try {
    for (const name of ['src', 'assets', 'extension']) await cp(resolve(root, name), resolve(fixture, name), { recursive: true });
    await mkdir(resolve(fixture, 'scripts'));
    await cp(resolve(root, 'scripts/build.ts'), resolve(fixture, 'scripts/build.ts'));
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
    const options = parseDevelopmentOptions(['--headless', '--url', legacyUrl], fixture);
    browser = await launchDevelopmentBrowser(options, await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const legacy = await syntheticPage(browser, false);
    const modern = await syntheticPage(browser, true);
    const signal = new AbortController().signal;
    await buildDevelopmentExtension(fixture, signal);
    const { id } = await reloadDevelopmentExtension(browser, developmentPaths(fixture).extension, legacyUrl, signal);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#enabled:not(:disabled)');
    const setPreferences = async (preferences: Record<string, boolean>) => popup.evaluate(async (update) => {
      const chrome = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await chrome.storage.sync.set(update);
    }, preferences);
    await setPreferences({ enabled: true, ...Object.fromEntries(FEATURE_DEFINITIONS.map(({ key }) => [key, key === 'pageAppearance'])) });
    await earlyAppearance(browser, setPreferences);
    await legacy.goto(legacyUrl, { waitUntil: 'domcontentloaded' });
    await modern.goto(modernUrl, { waitUntil: 'domcontentloaded' });
    const mounted = async () => {
      await legacy.waitForSelector('html[data-bn-portal-shell="legacy"] #summary[data-bn-progress-summary="true"]');
      await legacy.waitForSelector('#coursesContainer[data-bn-progress-courses="cards"]');
      await modern.waitForSelector('html[data-bn-portal-shell="modern"] body[data-bn-page="assignments"]');
      for (const page of [legacy, modern]) await page.waitForFunction(() => document.querySelectorAll('[data-bn-navigation-icon]').length === 14, { polling: 50 });
    };
    const unmounted = async () => {
      for (const page of [legacy, modern]) await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-appearance], [data-bn-portal-shell], [data-bn-page], [data-bn-progress-summary], [data-bn-progress-courses], [data-bn-course-row], [data-bn-navigation-icon], [data-bn-native-icon], [data-bn-header-part], [data-bn-header-current], [data-bn-header-count-empty]'), { polling: 50 });
    };
    const setAppearance = async (enabled: boolean) => {
      await setPreferences({ pageAppearance: enabled });
      if (enabled) await mounted(); else await unmounted();
    };
    await mounted();
    const logoNodes = new Map<Page, NativeSchoolLogo>();
    for (const page of [legacy, modern]) logoNodes.set(page, {
      image: (await page.$('#site-logo img')) as ElementHandle<HTMLImageElement>,
      link: (await page.$('#site-logo > a')) as ElementHandle<HTMLAnchorElement>,
    });
    const nativeLogoSizes = new Map<Page, SchoolLogoSizes>();
    await setPreferences({ pageAppearance: false });
    await unmounted();
    for (const page of [legacy, modern]) nativeLogoSizes.set(page, await schoolLogoVariants(page, logoNodes.get(page)!, false));
    await setPreferences({ pageAppearance: true });
    await mounted();
    const labels = new Map<Page, Awaited<ReturnType<typeof navigationLabels>>>();
    const utilities = new Map<Page, Awaited<ReturnType<typeof utilityLabels>>>();
    const menus = new Map<Page, Awaited<ReturnType<typeof menuLabels>>>();
    for (const page of [legacy, modern]) {
      await schoolLogoVariants(page, logoNodes.get(page)!, true);
      await longAccountName(page, logoNodes.get(page)!);
      await liveUtilityCounts(page);
      await longSecondaryNavigation(page, setAppearance);
      await nativeMobileDrawer(page, true);
      await navigationIcons(page, true, '10');
      await page.evaluate(() => { document.querySelector('#myday > .dayicon > .day')!.textContent = '11'; });
      await navigationIcons(page, true);
      labels.set(page, await navigationLabels(page));
      utilities.set(page, await utilityLabels(page));
      menus.set(page, await menuLabels(page));
      await navigationIcons(page, true);
      for (const width of [992, 1024, 1150, 1280]) {
        await page.setViewport({ width, height: 900 });
        await horizontalNavigation(page);
        await cleanPrimaryNavigation(page, true);
        await headerUtilities(page, true);
        await fixedHeaderGeometry(page);
      }
      await selectedHeaderTab(page, page === legacy ? 'Progress' : 'Assignment Center');
      await keyboardFocusStyle(page, '#group-header-Classes');
      await nativeNavigationActions(page);
      await nativeUtilityActions(page);
      await headerUtilities(page, true);
      await nativeDropdowns(page, true);
      if (page === legacy) await nativeDropdownHover(page, true);
      await unfamiliarDropdownFallback(page);
    }
    await setPreferences({ classSwitching: true });
    for (const page of [legacy, modern]) await classSearchMenu(page);
    await setPreferences({ classSwitching: false });
    for (const page of [legacy, modern]) {
      await page.waitForFunction(() => !document.querySelector('.bn-class-search, [data-blackbaud-next-class-hidden], [data-blackbaud-next-class-menu]'), { polling: 50 });
      assert.deepEqual(await menuLabels(page), menus.get(page), 'Class search cleanup restores native rows and destinations');
    }
    await nativeProgressCards(legacy);
    const desktop = await summaryBounds(legacy);
    assert.equal(desktop.cards.length, 2);
    assert.ok(Math.abs(desktop.cards[0]!.width - desktop.cards[1]!.width) < 2, JSON.stringify(desktop));
    assert.ok(Math.abs(desktop.cards[0]!.top - desktop.cards[1]!.top) < 2, JSON.stringify(desktop));
    assert.ok(desktop.cards.reduce((sum, card) => sum + card.width, 0) > desktop.row.width * .85, 'Summary cards use both halves of the row');
    await consistentCardContent(legacy, 16);
    for (const page of [legacy, modern]) await viewportGutters(page, 48);
    await nativeCollapse(legacy);

    for (const width of [320, 390]) {
      for (const page of [legacy, modern]) {
        await page.setViewport({ width, height: 844 });
        await viewportGutters(page, 16);
        await headerUtilities(page, true);
        await fixedHeaderGeometry(page);
      }
      const narrow = await summaryBounds(legacy);
      assert.ok(narrow.cards[1]!.top >= narrow.cards[0]!.bottom, 'Narrow summary cards stack');
      assert.ok(Math.abs(narrow.cards[0]!.width - narrow.cards[1]!.width) < 2, JSON.stringify(narrow));
      await consistentCardContent(legacy, 16);
      await nativeCollapse(legacy);
    }
    for (const page of [legacy, modern]) await page.setViewport({ width: 1280, height: 900 });

    // An unfamiliar content hierarchy retains its native inner spacing.
    await legacy.evaluate(() => {
      const extra = document.createElement('div'); extra.id = 'unexpected-content';
      document.querySelector('#summary section .bb-tile-content')!.append(extra);
    });
    const unfamiliarContent = (await cardContentBounds(legacy))[0]!;
    assert.ok(unfamiliarContent.body - unfamiliarContent.heading >= 14, 'Multiple native sections keep their original indentation');
    await legacy.evaluate(() => document.querySelector('#unexpected-content')!.remove());
    await consistentCardContent(legacy, 16);

    // A new native widget structure falls back instead of being forced into two columns.
    await legacy.evaluate(() => { const extra = document.createElement('div'); extra.id = 'unexpected-widget'; document.querySelector('#summary')!.append(extra); });
    await legacy.waitForFunction(() => !document.querySelector('#summary')!.hasAttribute('data-bn-progress-summary'), { polling: 50 });
    const fallback = await summaryBounds(legacy);
    assert.ok(fallback.cards.reduce((sum, card) => sum + card.width, 0) < fallback.row.width * .75, 'Unknown summary structure keeps native one-third widths');
    await legacy.evaluate(() => document.querySelector('#unexpected-widget')!.remove());
    await mounted();
    for (const page of [legacy, modern]) await malformedPrimaryFallback(page);

    const disabledPreferences: Record<string, boolean>[] = [{ pageAppearance: false }, { enabled: false }];
    for (const preferences of disabledPreferences) {
      await setPreferences(preferences);
      await unmounted();
      await preservedNativeProgressContent(legacy);
      await nativeProgressCourseActions(legacy);
      const native = await summaryBounds(legacy);
      assert.ok(native.cards.reduce((sum, card) => sum + card.width, 0) < native.row.width * .75, 'Disabling restores native summary geometry');
      for (const card of await cardContentBounds(legacy)) assert.ok(card.body - card.heading > 15, 'Cleanup restores the native nested content indentation');
      await horizontalNavigation(legacy);
      await horizontalNavigation(modern);
      for (const page of [legacy, modern]) {
        await schoolLogoVariants(page, logoNodes.get(page)!, false, nativeLogoSizes.get(page)!);
        await navigationIcons(page, false);
        await cleanPrimaryNavigation(page, false);
        assert.deepEqual(await navigationLabels(page), labels.get(page), 'Cleanup retains native labels and destinations');
        await nativeNavigationActions(page);
        await headerUtilities(page, false);
        assert.deepEqual(await utilityLabels(page), utilities.get(page), 'Cleanup retains native utility names and destinations');
        await nativeUtilityActions(page);
        await nativeDropdowns(page, false);
        if (page === legacy) await nativeDropdownHover(page, false);
        await nativeMobileDrawer(page, false);
        assert.deepEqual(await menuLabels(page), menus.get(page), 'Disabling appearance retains native menu labels and destinations');
      }
      await nativeCollapse(legacy);
      await setPreferences({ enabled: true, pageAppearance: true });
      await mounted();
      await progressCourseGeometry(legacy, 2);
      const restored = await summaryBounds(legacy);
      assert.ok(Math.abs(restored.cards[0]!.width - desktop.cards[0]!.width) < 2, 'Reenabling restores the enhanced summary layout');
      await consistentCardContent(legacy, 16);
      await horizontalNavigation(modern);
      for (const page of [legacy, modern]) {
        await navigationIcons(page, true);
        await headerUtilities(page, true);
        await cleanPrimaryNavigation(page, true);
        assert.deepEqual(await utilityLabels(page), utilities.get(page), 'Reenabling preserves native utility names and destinations');
        assert.deepEqual(await navigationLabels(page), labels.get(page), 'Reenabling does not duplicate or change native labels');
      }
    }
    await nativeSchedule(legacy);
  } finally {
    await browser?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
