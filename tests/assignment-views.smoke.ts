import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { Browser, HTTPRequest } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(import.meta.dirname, '..');
const origin = 'https://views-fixture.myschoolapp.com';
const center = `${origin}/lms-assignment/assignment-center/student?svcid=edu`;
const classic = `${origin}/app/student?svcid=edu#studentmyday/assignment-center`;
const detail = `${origin}/lms-assignment/assignment/assignment-student-view/123`;
const radios = `<fieldset role="radiogroup" aria-label="Assignment center view" aria-owns="calendar list"><div class="sky-switch-icon-group">
  <sky-radio><label><input type="radio" name="viewMode" value="1" id="calendar" aria-label="Calendar"><span class="sky-switch-control">Calendar</span></label></sky-radio>
  <sky-radio><label><input type="radio" name="viewMode" value="0" id="list" aria-label="List" checked><span class="sky-switch-control">List</span></label></sky-radio>
</div></fieldset>`;
const modernHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  * { box-sizing:border-box; } body { margin:0; font:15px Arial; } sky-toolbar, sky-toolbar-item, sky-split-view { display:block; }
  sky-toolbar { padding:16px; } .sky-switch-icon-group { display:flex; } sky-radio label { display:flex; align-items:center; height:35px; }
  fieldset { border:0; margin:0; padding:0; } sky-split-view { padding:16px; } [hidden] { display:none; }
</style></head><body><app-student-assignment-center><div><div class="hide-for-print"><h3>Assignments</h3>
  <sky-toolbar><div><div id="native-actions"><button>Native action</button></div><sky-toolbar-item><sky-radio-group name="viewMode"></sky-radio-group></sky-toolbar-item></div></sky-toolbar>
</div><sky-split-view id="modern-content"><label>Native search <input id="native-search" value="Preserved search"></label><p id="native-view">List</p></sky-split-view></div></app-student-assignment-center>
<script>
  setTimeout(() => {
    document.querySelector('sky-radio-group').innerHTML = ${JSON.stringify(radios.replace(' checked', ''))};
    const mask = document.createElement('div');
    mask.className = 'sky-wait-mask sky-wait-mask-loading-fixed sky-wait-mask-loading-blocking';
    document.body.append(mask);
    setTimeout(() => {
      document.querySelector('input[name="viewMode"][value="0"]').checked = true;
      mask.remove();
      document.body.dataset.nativeReady = 'true';
    }, 100);
  }, 50);
  document.addEventListener('change', e => { if (e.target.name === 'viewMode' && e.target.value !== 'classic') document.querySelector('#native-view').textContent = e.target.value === '0' ? 'List' : 'Calendar'; });
</script></body></html>`;
const classicHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  * { box-sizing:border-box; } body { margin:0; } #site-header-parent-container { height:100px; } .container { width:1100px; }
  .bb-tile-content { padding:20px; } #native-dialog { position:fixed; inset:40px; background:#fff; border:1px solid #777; }
  .row { margin-inline:-15px; } .col-md-12 { padding-inline:15px; }
  [hidden] { display:none; } td { padding:20px; } table { width:100%; } @media(max-width:600px) { td { display:block; } }
</style></head><body><div id="app"><div id="site-header-parent-container">Duplicate native navigation</div><div id="site-top-spacer"></div>
  <div class="site-main-wrap"><div id="site-main" class="container"><div id="assignment-center"><section class="bb-tile"><div class="bb-tile-title">Duplicate title</div><div class="bb-tile-content">
    <div class="row"><div id="assignment-center-header-view" class="col-md-12"><div class="assignment-calendar-header"><button id="filter-status">Filter status</button><button id="native-refresh">Refresh native rows</button><button id="native-grid">Grid</button></div></div></div>
    <div class="row"><div id="assignment-center-content-view" class="col-md-12"><div id="assignment-center-list-view"><table class="table"><tbody id="assignment-center-assignment-items"><tr><td><a id="assignment-link" class="assignment-detail-link" href="${detail}">Reading assignment</a><a id="discussion-link" class="assignment-detail-link" href="#discussiondetail/456/789/Assignments">Native discussion</a></td><td>To do</td><td><button class="assignment-status-update">Change status</button></td></tr></tbody></table></div></div></div>
    <div style="height:900px"></div><button id="last-action">Last native action</button>
  </div></section></div></div></div>
  <div id="native-dialog" hidden><label>Native draft <input id="native-draft"></label><button id="cancel">Cancel</button></div>
</div><script>
  const nativeList = document.querySelector('#assignment-center').innerHTML;
  document.addEventListener('click', e => {
    if (e.target.id === 'native-grid') document.querySelector('#assignment-center').innerHTML = '<div id="calendar-main-view"><div id="calendar-header-container"><div class="assignment-calendar-header"><button id="native-list">List</button></div></div><div id="calendar-container" class="fc">Native calendar</div></div>';
    if (e.target.id === 'native-list') document.querySelector('#assignment-center').innerHTML = nativeList;
    if (e.target.id === 'filter-status' || e.target.className === 'assignment-status-update') document.querySelector('#native-dialog').hidden = false;
    if (e.target.id === 'cancel') document.querySelector('#native-dialog').hidden = true;
    if (e.target.id === 'native-refresh') document.querySelector('#assignment-center-assignment-items').innerHTML = '<tr><td>Native updated row</td></tr>';
    if (e.target.id === 'last-action') document.body.dataset.lastAction = 'clicked';
  });
</script></body></html>`;

test('Classic integrates with native views and preserves frame actions, fallback, and cleanup', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-views-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForSelector('#mode-full:not(:disabled)');
    const preferences = (patch: Record<string, boolean | string>) => options.evaluate(async update => {
      await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.set(update);
    }, patch);
    await preferences({ enabled:true, ...Object.fromEntries(FEATURE_DEFINITIONS.map(({ key }) => [key, key === 'classicAssignmentCenter'])) });
    const page = await browser.newPage();
    page.setDefaultTimeout(6_000);
    await page.setViewport({ width:1280, height:900 });
    let holdClassic = false;
    let pending: HTTPRequest | undefined;
    await page.setRequestInterception(true);
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/app/student' && holdClassic) { pending = request; return; }
      void request.respond({ status:200, contentType:'text/html', body:path === '/app/student' ? classicHtml : path.includes('/assignment-student-view/') ? '<h1>Native assignment</h1>' : modernHtml });
    });
    await page.goto(center, { waitUntil:'domcontentloaded' });
    const mounted = async () => {
      await page.waitForSelector('.bn-classic-view-input');
      await page.waitForSelector('body[data-native-ready]');
    };
    const open = async () => {
      await page.click('.bn-classic-view-label');
      await page.waitForSelector('.bn-classic-frame:not([hidden])');
      const frame = await (await page.$('iframe.bn-classic-frame'))!.contentFrame();
      assert.ok(frame);
      return frame;
    };
    await mounted();
    assert.equal(await page.$eval('#list', input => (input as HTMLInputElement).checked), true, 'Adding the control does not change the native view');
    assert.equal(await page.$eval('fieldset', element => element.getAttribute('aria-owns')), 'calendar list blackbaud-next-classic-view');
    await page.focus('#list');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('.bn-classic-view-input', input => (input as HTMLInputElement).checked), true, 'Classic participates in native radio keyboard navigation');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$eval('#list', input => (input as HTMLInputElement).checked), true);
    let frame = await open();
    assert.equal(page.url(), center);
    assert.equal(frame.url(), classic);
    assert.equal(await page.$eval('#modern-content', element => element.getBoundingClientRect().height), 0);
    assert.equal(await frame.$eval('#site-header-parent-container', element => element.getBoundingClientRect().height), 0);
    await frame.click('#native-grid');
    await frame.waitForSelector('#calendar-container', { visible:true });
    await frame.click('#native-list');
    await frame.waitForSelector('#assignment-center-assignment-items', { visible:true });
    await frame.click('#filter-status');
    await frame.type('#native-draft', 'Native unsaved draft');
    await preferences({ rosterTools:true });
    assert.equal(await frame.$eval('#native-draft', input => (input as HTMLInputElement).value), 'Native unsaved draft', 'Unrelated preferences preserve the native frame and forms');
    for (const pageAppearance of [true, false]) {
      await preferences({ pageAppearance });
      await page.waitForFunction(expected => document.documentElement.hasAttribute('data-blackbaud-next-appearance') === expected, { polling:100 }, pageAppearance);
      assert.equal(await frame.$eval('#native-draft', input => (input as HTMLInputElement).value), 'Native unsaved draft', 'Appearance changes preserve native forms');
    }
    await frame.click('#cancel');
    await frame.click('#last-action');
    assert.equal(await frame.$eval('body', element => (element as HTMLElement).dataset.lastAction), 'clicked', 'The bottom of the native frame remains reachable');
    await frame.click('#native-refresh');
    assert.equal(await frame.$eval('tbody', element => element.textContent), 'Native updated row');
    const nativeMain = await frame.$('#site-main');
    assert.ok(nativeMain);
    await nativeMain.evaluate(element => element.remove());
    await page.waitForSelector('.bn-classic-loading');
    await nativeMain.evaluate(element => document.querySelector('.site-main-wrap')!.append(element));
    await page.waitForSelector('.bn-classic-frame:not([hidden])');
    await nativeMain.dispose();
    await page.click('#calendar');
    assert.equal(await page.$('iframe.bn-classic-frame'), null);
    assert.equal(await page.$eval('#native-view', element => element.textContent), 'Calendar');
    assert.equal(await page.$eval('#native-search', input => (input as HTMLInputElement).value), 'Preserved search');
    frame = await open();
    await preferences({ classicAssignmentCenter:false });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-view-label'), { polling:100 });
    assert.equal(await page.$eval('#calendar', input => (input as HTMLInputElement).checked), true, 'Disabling restores the prior native selection');
    assert.equal(await page.$eval('fieldset', element => element.getAttribute('aria-owns')), 'calendar list');
    assert.equal(await page.$('[data-bn-classic-hidden]'), null);
    await preferences({ classicAssignmentCenter:true, pageAppearance:true });
    await mounted();
    for (const width of [390, 320]) {
      await page.setViewport({ width, height:844 });
      frame = await open();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await frame.click('.assignment-status-update');
      await frame.waitForSelector('#native-dialog:not([hidden])');
      await frame.click('#cancel');
      await page.click('#list');
    }
    await page.setViewport({ width:1280, height:900 });
    frame = await open();
    await frame.goto(`${origin}/signin`, { waitUntil:'domcontentloaded' });
    await page.waitForSelector('.bn-classic-error');
    assert.equal(await page.$eval('.bn-classic-error a', link => (link as HTMLAnchorElement).href), classic, 'An unavailable or signed-out frame offers the native full page');
    await page.click('#list');
    holdClassic = true;
    await page.click('.bn-classic-view-label');
    await page.waitForSelector('.bn-classic-loading');
    while (!pending) await new Promise(resolve => setTimeout(resolve, 20));
    await preferences({ enabled:false });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-panel'), { polling:100 });
    await pending.respond({ status:200, contentType:'text/html', body:classicHtml }).catch(() => {});
    assert.equal(await page.$('[data-bn-classic-hidden]'), null);
    assert.ok(await page.$eval('#modern-content', element => element.getBoundingClientRect().height > 0));
    holdClassic = false;
    await preferences({ enabled:true, mode:'essentials' });
    assert.equal(await page.$('.bn-classic-view-label'), null);
    await preferences({ mode:'full', pageAppearance:false });
    await mounted();
    frame = await open();
    await frame.click('#discussion-link');
    await page.waitForFunction(() => location.hash === '#discussiondetail/456/789/Assignments', { polling:100 });
    assert.equal(await page.$('.bn-classic-panel'), null, 'Legacy discussions retain their native main-page route');
    await page.goto(center, { waitUntil:'domcontentloaded' });
    await mounted();
    frame = await open();
    await frame.click('#assignment-link');
    await page.waitForFunction(expected => location.href === expected, { polling:100 }, detail);
    assert.equal(await page.$('.bn-classic-panel'), null, 'Native assignment links navigate the main page');
    await page.goto(center, { waitUntil:'domcontentloaded' });
    await mounted();
    await page.$eval('sky-radio-group', group => { group.innerHTML = '<span>Unsupported native selector</span>'; });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-view-label'), { polling:100 });
    assert.ok(await page.$eval('#modern-content', element => element.getBoundingClientRect().height > 0));
    await page.$eval('sky-radio-group', (group, html) => { group.innerHTML = html; }, radios);
    await mounted();
    assert.equal(await page.$$eval('.bn-classic-view-label', elements => elements.length), 1, 'Delayed and replaced controls mount once');
    await page.$eval('sky-radio-group', group => { document.body.append(group); });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-view-label'), { polling:100 });
    await page.$eval('sky-radio-group', group => { document.querySelector('sky-toolbar-item')!.append(group); });
    await mounted();
    await page.$eval('input[value="0"]', input => { (input as HTMLInputElement).type = 'checkbox'; });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-view-label'), { polling:100 });
    assert.ok(await page.$eval('#modern-content', element => element.getBoundingClientRect().height > 0), 'Changed native semantics remain usable');
    await page.$eval('input[value="0"]', input => { (input as HTMLInputElement).type = 'radio'; });
    await mounted();
    await open();
    await page.reload({ waitUntil:'domcontentloaded' });
    await page.waitForSelector('body[data-native-ready]');
    await page.waitForSelector('.bn-classic-frame:not([hidden])');
    assert.equal(await page.$eval('.bn-classic-view-input', input => (input as HTMLInputElement).checked), true, 'Native initialization cannot overwrite the restored Classic selection');
    await page.goto(`${origin}/sis-scheduling/user-calendar`, { waitUntil:'domcontentloaded' });
    await page.goto(center, { waitUntil:'domcontentloaded' });
    await page.waitForSelector('.bn-classic-frame:not([hidden])');
    for (const view of ['calendar', 'list']) {
      await page.click(`#${view}`);
      await page.reload({ waitUntil:'domcontentloaded' });
      await mounted();
      await page.waitForFunction(id => (document.getElementById(id) as HTMLInputElement).checked, { polling:100 }, view);
      assert.equal(await page.$('iframe.bn-classic-frame'), null, 'Choosing a native view clears the remembered Classic selection');
    }
  } finally { await browser?.close(); await rm(fixture, { recursive:true, force:true }); }
});
