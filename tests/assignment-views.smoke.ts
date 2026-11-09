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
type ViewWriteGate = typeof globalThis & { chrome: ExtensionApi; releaseViewWrite: () => void; viewWriteStarted: Promise<void> };
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
</div><sky-split-view id="modern-content"><label>Native search <input id="native-search" value="Default search"></label><p id="native-view">List</p><p id="native-status">__STATUS__</p></sky-split-view></div></app-student-assignment-center>
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
  * { box-sizing:border-box; } body { margin:0; font-size:15px; line-height:1.42857; } #site-header-parent-container { height:100px; } .container { width:1100px; }
  .bb-tile-content { padding:20px; } #site-modal.modal { position:fixed; inset:0; } .modal-dialog { margin:30px; } .modal-content { background:#fff; border:1px solid #777; } .modal-body, .modal-footer { padding:20px; }
  .row { margin-inline:-15px; } .col-md-12 { padding-inline:15px; }
  [hidden] { display:none; } td { padding:8px; vertical-align:top; } table { width:100%; } @media(max-width:600px) { td { display:block; } }
  .btn { font:inherit; }
  .table-striped > tbody > tr { background:#fff; }
  .table-striped > tbody > tr:nth-of-type(odd) { background:#f9f9f9; }
</style></head><body><div id="app"><div id="site-header-parent-container">Duplicate native navigation</div><div id="site-top-spacer"></div>
  <div id="site-modal"></div>
  <template id="native-dialog-template"><div class="modal-dialog"><div class="modal-content"><div class="modal-body"><label>Native draft <input id="native-draft"></label></div><div class="modal-footer"><button id="save-status">Save status</button><button id="cancel">Cancel</button></div></div></div></template>
  <div class="site-main-wrap"><div id="site-main" class="container"><div id="assignment-center"><section class="bb-tile"><div class="bb-tile-title">Duplicate title</div><div class="bb-tile-content">
    <div class="row"><div id="assignment-center-header-view" class="col-md-12"><div class="assignment-calendar-header"><button id="filter-status">Filter status</button><button id="native-refresh">Refresh native rows</button><button id="native-grid">Grid</button></div></div></div>
    <div class="row"><div id="assignment-center-content-view" class="col-md-12"><div id="assignment-center-list-view"><table class="table table-striped"><tbody id="assignment-center-assignment-items"><tr><td><a id="assignment-link" class="assignment-detail-link" href="${detail}">Reading assignment</a><a id="discussion-link" class="assignment-detail-link" href="#discussiondetail/456/789/Assignments">Native discussion</a></td><td id="native-classic-status">__STATUS__</td><td><button class="btn assignment-status-update">Change status</button></td></tr><tr><td>Practice problems</td><td>To do</td><td></td></tr></tbody></table></div></div></div>
    <div style="height:900px"></div><button id="last-action">Last native action</button><button class="assignment-status-update" id="last-status">Change status at bottom</button>
  </div></section></div></div></div>
</div><script>
  const nativeList = document.querySelector('#assignment-center').innerHTML;
  const closeDialog = () => {
    const dialog = document.querySelector('#site-modal');
    dialog.className = '';
    dialog.removeAttribute('role');
    dialog.replaceChildren();
  };
  document.addEventListener('click', async e => {
    if (e.target.id === 'save-status') {
      const response = await fetch('/fixture/status', { method:'POST' });
      if (!response.ok) {
        const error = document.createElement('p');
        error.id = 'native-save-error';
        error.textContent = 'Could not save status';
        document.querySelector('#site-modal .modal-body').append(error);
        return;
      }
      document.querySelector('#native-classic-status').textContent = 'Completed';
      closeDialog();
    }
    if (e.target.id === 'native-grid') document.querySelector('#assignment-center').innerHTML = '<div id="calendar-main-view"><div id="calendar-header-container"><div class="assignment-calendar-header"><button id="native-list">List</button></div></div><div id="calendar-container" class="fc">Native calendar</div></div>';
    if (e.target.id === 'native-list') document.querySelector('#assignment-center').innerHTML = nativeList;
    if (e.target.id === 'filter-status' || e.target.classList.contains('assignment-status-update')) {
      const dialog = document.querySelector('#site-modal');
      dialog.className = 'modal';
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = document.querySelector('#native-dialog-template').innerHTML;
    }
    if (e.target.id === 'cancel') closeDialog();
    if (e.target.id === 'native-refresh') document.querySelector('#assignment-center-assignment-items').innerHTML = '<tr><td>Native updated row</td></tr>';
    if (e.target.id === 'last-action') document.body.dataset.lastAction = 'clicked';
  });
</script></body></html>`;

test('Classic refreshes native data on return and preserves actions, fallback, and cleanup', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-views-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const options = await browser.newPage();
    options.setDefaultTimeout(6_000);
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForSelector('#mode-full:not(:disabled)');
    const preferences = (patch: Record<string, boolean | string>) => options.evaluate(async update => {
      await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.set(update);
    }, patch);
    await preferences({ enabled:true, mode:'full', ...Object.fromEntries(FEATURE_DEFINITIONS.filter(({ defaultValue }) => defaultValue).map(({ key }) => [key, false])) });
    const page = await browser.newPage();
    page.setDefaultTimeout(6_000);
    await page.setViewport({ width:1280, height:900 });
    let holdClassic = false;
    let pending: HTTPRequest | undefined;
    let holdStatus = false;
    let status = 'To do';
    let statusWrites = 0;
    let modernDocuments = 0;
    await page.setRequestInterception(true);
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/fixture/status' && request.method() === 'POST') {
        statusWrites++;
        if (holdStatus) return;
        status = 'Completed';
        void request.respond({ status:200, contentType:'application/json', body:'{}' });
        return;
      }
      if (path === '/app/student' && holdClassic) { pending = request; return; }
      if (path === new URL(center).pathname && request.isNavigationRequest() && request.frame() === page.mainFrame()) modernDocuments++;
      const html = path === '/app/student' ? classicHtml : path.includes('/assignment-student-view/') ? '<h1>Native assignment</h1>' : modernHtml;
      void request.respond({ status:200, contentType:'text/html', body:html.replaceAll('__STATUS__', status) });
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
      await options.waitForFunction(async () => (await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.get('assignmentCenterView')).assignmentCenterView === 'classic', { polling:100 });
      return frame;
    };
    const returnToModern = async (view: 'calendar' | 'list') => {
      const before = modernDocuments;
      const navigation = page.waitForNavigation({ waitUntil:'domcontentloaded' });
      await page.click(`#${view}`);
      await navigation;
      await mounted();
      await page.waitForFunction(id => (document.getElementById(id) as HTMLInputElement).checked, { polling:100 }, view);
      assert.equal(modernDocuments, before + 1, 'Returning from Classic reloads the native page exactly once');
    };
    const holdViewWrites = async () => {
      const worker = await (await browser!.waitForTarget(target => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${id}/`))).worker();
      assert.ok(worker);
      await worker.evaluate(() => {
        const scope = globalThis as ViewWriteGate;
        const original = scope.chrome.storage.sync.set;
        const write = original.bind(scope.chrome.storage.sync);
        let release: () => void = () => {};
        let started: () => void = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        scope.viewWriteStarted = new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error('The view save did not start')), 5_000);
          started = () => { clearTimeout(deadline); resolve(); };
        });
        scope.releaseViewWrite = () => { scope.chrome.storage.sync.set = original; release(); };
        scope.chrome.storage.sync.set = async patch => {
          if ('assignmentCenterView' in patch) { started(); await gate; }
          await write(patch);
        };
      });
      return worker;
    };
    await mounted();
    assert.equal(await page.$eval('#list', input => (input as HTMLInputElement).checked), true, 'Adding the control does not change the native view');
    assert.equal(await page.$eval('fieldset', element => element.getAttribute('aria-owns')), 'calendar list blackbaud-next-classic-view');
    await page.focus('#list');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('.bn-classic-view-input', input => (input as HTMLInputElement).checked), true, 'Classic participates in native radio keyboard navigation');
    const keyboardReturn = page.waitForNavigation({ waitUntil:'domcontentloaded' });
    await page.keyboard.press('ArrowLeft');
    await keyboardReturn;
    await mounted();
    assert.equal(await page.$eval('#list', input => (input as HTMLInputElement).checked), true);
    let frame = await open();
    const frameWidth = () => page.$eval('.bn-classic-frame', element => element.getBoundingClientRect().width);
    const compactWidth = await frameWidth();
    assert.ok(compactWidth < 1200, 'Classic has narrower content than the desktop viewport');
    assert.ok(await page.$eval('.bn-classic-frame', element => {
      const { left, right } = element.getBoundingClientRect();
      return Math.abs(left - (innerWidth - right)) <= 1;
    }), 'Classic is centered within the Assignment Center');
    assert.ok(await frame.$eval('#site-main', element => element.getBoundingClientRect().top < 24), 'The empty native dialog placeholder leaves no gap above Classic');
    const pageScrolls = () => page.waitForFunction(() => {
      const frame = document.querySelector<HTMLIFrameElement>('.bn-classic-frame')!;
      const root = frame.contentDocument!.scrollingElement!;
      return frame.clientHeight >= root.scrollHeight - 2 && document.scrollingElement!.scrollHeight > innerHeight;
    }, { polling:100 });
    await pageScrolls();
    await page.evaluate(() => window.scrollTo(0, 0));
    const frameBounds = await page.$eval('.bn-classic-frame', element => ({ x:element.getBoundingClientRect().x, y:element.getBoundingClientRect().y }));
    await page.mouse.move(frameBounds.x + 30, frameBounds.y + 100);
    await page.mouse.wheel({ deltaY:200 });
    await page.waitForFunction(() => scrollY > 0, { polling:100 });
    assert.equal(await frame.evaluate(() => scrollY), 0, 'Wheel input over Classic scrolls the outer page');
    await frame.click('#last-status');
    await frame.waitForSelector('#site-modal.modal');
    await page.waitForFunction(() => {
      const frame = document.querySelector<HTMLIFrameElement>('.bn-classic-frame')!;
      const dialog = frame.contentDocument!.querySelector('.modal-dialog')!.getBoundingClientRect();
      const top = frame.getBoundingClientRect().top + dialog.top;
      return top >= 0 && top + dialog.height <= innerHeight;
    }, { polling:100 });
    await frame.$eval('.modal-body', element => {
      const content = document.createElement('div');
      content.id = 'long-native-form';
      content.style.height = '2000px';
      element.append(content);
    });
    await page.waitForFunction(() => {
      const frame = document.querySelector<HTMLIFrameElement>('.bn-classic-frame')!;
      const body = frame.contentDocument!.querySelector('.modal-body')!;
      const footer = frame.contentDocument!.querySelector('.modal-footer')!.getBoundingClientRect();
      return body.scrollHeight > body.clientHeight && frame.getBoundingClientRect().top + footer.bottom <= innerHeight;
    }, { polling:100 });
    await frame.$eval('#long-native-form', element => element.remove());
    await frame.click('#cancel');
    assert.ok(await frame.$eval('#site-main', element => element.getBoundingClientRect().top < 24), 'Closing a native dialog leaves no top gap');
    assert.equal(page.url(), center);
    assert.equal(frame.url(), classic);
    assert.equal(await page.$eval('#modern-content', element => element.getBoundingClientRect().height), 0);
    assert.equal(await frame.$eval('#site-header-parent-container', element => element.getBoundingClientRect().height), 0);
    await frame.click('#native-grid');
    await frame.waitForSelector('#calendar-container', { visible:true });
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.bn-classic-frame')!.getBoundingClientRect().height < 500, { polling:100 });
    await frame.click('#native-list');
    await frame.waitForSelector('#assignment-center-assignment-items', { visible:true });
    await pageScrolls();
    await page.evaluate(() => {
      document.querySelector<HTMLIFrameElement>('.bn-classic-frame')!.contentDocument!.querySelector<HTMLElement>('#filter-status')!.click();
      document.querySelector<HTMLInputElement>('#calendar')!.click();
    });
    assert.ok(await page.$('.bn-classic-frame'), 'A synchronous view click cannot bypass the native dialog guard');
    assert.equal(await page.$eval('#native-view', element => element.textContent), 'List', 'Blocked clicks do not change the native view model');
    assert.equal(await page.$eval('.bn-classic-view-input', input => (input as HTMLInputElement).checked), true);
    await frame.type('#native-draft', 'Native unsaved draft');
    await preferences({ rosterTools:true });
    assert.equal(await frame.$eval('#native-draft', input => (input as HTMLInputElement).value), 'Native unsaved draft', 'Unrelated preferences preserve the native frame and forms');
    for (const pageAppearance of [true, false]) {
      await preferences({ pageAppearance });
      await page.waitForFunction(expected => document.documentElement.hasAttribute('data-blackbaud-next-appearance') === expected, { polling:100 }, pageAppearance);
      assert.equal(await frame.$eval('#native-draft', input => (input as HTMLInputElement).value), 'Native unsaved draft', 'Appearance changes preserve native forms');
      if (pageAppearance) {
        const waitForRowStyles = (wide: boolean) => frame.waitForFunction(wide => {
          const rows = [...document.querySelectorAll('#assignment-center-assignment-items > tr')];
          const cell = rows[0]?.querySelector('td');
          const button = rows[0]?.querySelector('button');
          if (!cell || !button || rows.length !== 2) return false;
          const style = getComputedStyle(cell);
          return getComputedStyle(rows[0]!).backgroundColor === (wide ? 'rgb(255, 255, 255)' : 'rgb(249, 249, 249)') &&
            getComputedStyle(rows[1]!).backgroundColor === 'rgb(255, 255, 255)' &&
            style.fontSize === (wide ? '14px' : '15px') &&
            style.lineHeight === (wide ? '20.3px' : '21.4286px') &&
            style.verticalAlign === (wide ? 'middle' : 'top') &&
            style.padding === (wide ? '14px 12px' : '8px') &&
            getComputedStyle(button).fontSize === (wide ? '13px' : '15px');
        }, { polling:100 }, wide);
        await waitForRowStyles(false);
        await options.bringToFront();
        await options.focus('#advanced-settings > summary');
        await options.keyboard.press('Space');
        await options.click('#classicWideLayout');
        await waitForRowStyles(true);
        assert.ok(await frameWidth() > compactWidth + 60, 'Advanced restores the full-width Classic layout');
        assert.equal(await frame.$eval('#native-draft', input => (input as HTMLInputElement).value), 'Native unsaved draft', 'Changing the layout preserves the open native form');
        await options.click('#classicWideLayout');
        await page.bringToFront();
        await waitForRowStyles(false);
        assert.equal(await frameWidth(), compactWidth);
      }
    }
    await frame.click('#cancel');
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('#calendar, #list')].every(input => !input.disabled), { polling:100 });
    await frame.click('.assignment-status-update');
    holdStatus = true;
    const failedSave = page.waitForRequest(request => new URL(request.url()).pathname === '/fixture/status' && request.method() === 'POST');
    await frame.click('#save-status');
    const pendingStatus = await failedSave;
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('#calendar, #list')].every(input => input.disabled), { polling:100 });
    await page.$eval('#list', input => (input as HTMLInputElement).click());
    await page.focus('.bn-classic-view-input');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$eval('.bn-classic-view-input', input => (input as HTMLInputElement).checked), true, 'Keyboard navigation cannot leave the active native dialog');
    assert.ok(await page.$('.bn-classic-frame'), 'Switching views cannot destroy the frame during a native save');
    assert.equal(statusWrites, 1);
    await pendingStatus.respond({ status:503, contentType:'application/json', body:'{}' });
    await frame.waitForSelector('#native-save-error');
    assert.equal(await page.$eval('#list', input => (input as HTMLInputElement).disabled), true, 'A native save error stays visible until the dialog is closed');
    await frame.click('#cancel');
    await page.waitForFunction(() => !(document.querySelector('#list') as HTMLInputElement).disabled, { polling:100 });
    await frame.click('.assignment-status-update');
    const retriedSave = page.waitForRequest(request => new URL(request.url()).pathname === '/fixture/status' && request.method() === 'POST');
    await frame.click('#save-status');
    const retryStatus = await retriedSave;
    status = 'Completed';
    await retryStatus.respond({ status:200, contentType:'application/json', body:'{}' });
    holdStatus = false;
    await frame.waitForFunction(() => document.querySelector('#native-classic-status')?.textContent === 'Completed', { polling:100 });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('#calendar, #list')].every(input => !input.disabled), { polling:100 });
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
    await returnToModern('calendar');
    assert.equal(await page.$('iframe.bn-classic-frame'), null);
    assert.equal(await page.$eval('#native-view', element => element.textContent), 'Calendar');
    assert.equal(await page.$eval('#native-status', element => element.textContent), 'Completed', 'The native page reads fresh data after the Classic save');
    assert.equal(statusWrites, 2, 'Only the failed native attempt and explicit retry write status');
    const nativeDocument = modernDocuments;
    await page.click('#list');
    await page.click('#calendar');
    assert.equal(modernDocuments, nativeDocument, 'Ordinary List/Calendar switching keeps the same document');
    frame = await open();
    await page.$eval('#calendar', input => { (input as HTMLInputElement).disabled = true; });
    await frame.click('#filter-status');
    await page.waitForFunction(() => (document.querySelector('#list') as HTMLInputElement).disabled, { polling:100 });
    await frame.click('#cancel');
    await page.waitForFunction(() => !(document.querySelector('#list') as HTMLInputElement).disabled, { polling:100 });
    assert.equal(await page.$eval('#calendar', input => (input as HTMLInputElement).disabled), true, 'Closing a dialog preserves a natively disabled view');
    await page.$eval('#calendar', input => { (input as HTMLInputElement).disabled = false; });
    await frame.click('#filter-status');
    await page.waitForFunction(() => (document.querySelector('#list') as HTMLInputElement).disabled, { polling:100 });
    await preferences({ mode:'essentials' });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-view-label'), { polling:100 });
    assert.equal(await page.$eval('#calendar', input => (input as HTMLInputElement).checked), true, 'Disabling restores the prior native selection');
    assert.equal(await page.$eval('fieldset', element => element.getAttribute('aria-owns')), 'calendar list');
    assert.equal(await page.$eval('fieldset', element => element.getAttribute('title')), null);
    assert.equal(await page.$$eval('#calendar, #list', inputs => inputs.some(input => (input as HTMLInputElement).disabled)), false, 'Disabling removes the dialog guard from native controls');
    assert.equal(await page.$('[data-bn-classic-hidden]'), null);
    await preferences({ mode:'full', pageAppearance:true });
    await mounted();
    for (const width of [390, 320]) {
      await page.setViewport({ width, height:844 });
      frame = await open();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await frame.click('.assignment-status-update');
      await frame.waitForSelector('#site-modal.modal');
      await frame.click('#cancel');
      await returnToModern('list');
    }
    await page.setViewport({ width:1280, height:900 });
    frame = await open();
    await frame.goto(`${origin}/signin`, { waitUntil:'domcontentloaded' });
    await page.waitForSelector('.bn-classic-error');
    assert.equal(await page.$eval('.bn-classic-error a', link => (link as HTMLAnchorElement).href), classic, 'An unavailable or signed-out frame offers the native full page');
    await returnToModern('list');
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
      if (view === 'calendar') await returnToModern(view);
      else await page.click(`#${view}`);
      await page.reload({ waitUntil:'domcontentloaded' });
      await mounted();
      await page.waitForFunction(id => (document.getElementById(id) as HTMLInputElement).checked, { polling:100 }, view);
      assert.equal(await page.$('iframe.bn-classic-frame'), null, 'Choosing a native view clears the remembered Classic selection');
    }
    await open();
    const beforeRapid = modernDocuments;
    const delayed = await holdViewWrites();
    await page.click('#list');
    await delayed.evaluate(() => (globalThis as ViewWriteGate).viewWriteStarted);
    assert.equal(await page.$eval('#modern-content', element => getComputedStyle(element).display), 'none', 'The stale native list stays hidden during refresh');
    assert.ok(await page.$('.bn-classic-panel [aria-label="Refreshing assignments"]'));
    await page.click('#calendar');
    const rapidReturn = page.waitForNavigation({ waitUntil:'domcontentloaded' });
    await delayed.evaluate(() => (globalThis as ViewWriteGate).releaseViewWrite());
    await rapidReturn;
    await mounted();
    await page.waitForFunction(() => (document.getElementById('calendar') as HTMLInputElement).checked, { polling:100 });
    assert.equal(modernDocuments, beforeRapid + 1, 'Rapid choices reload once into the latest view');
    await open();
    const beforeReselect = modernDocuments;
    const reselected = await holdViewWrites();
    await page.click('#list');
    await reselected.evaluate(() => (globalThis as ViewWriteGate).viewWriteStarted);
    await page.click('.bn-classic-view-label');
    await reselected.evaluate(() => (globalThis as ViewWriteGate).releaseViewWrite());
    await options.waitForFunction(async () => (await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.get('assignmentCenterView')).assignmentCenterView === 'classic', { polling:100 });
    assert.equal(await page.$eval('.bn-classic-view-input', input => (input as HTMLInputElement).checked), true);
    assert.equal(modernDocuments, beforeReselect, 'Selecting Classic again cancels the pending return reload');
    await open();
    const beforeDisable = modernDocuments;
    const canceled = await holdViewWrites();
    await page.click('#list');
    await canceled.evaluate(() => (globalThis as ViewWriteGate).viewWriteStarted);
    await preferences({ enabled:false });
    await page.waitForFunction(() => !document.querySelector('.bn-classic-panel'), { polling:100 });
    await canceled.evaluate(() => (globalThis as ViewWriteGate).releaseViewWrite());
    await options.waitForFunction(async () => (await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.get('assignmentCenterView')).assignmentCenterView === 'list', { polling:100 });
    assert.equal(modernDocuments, beforeDisable, 'Disabling cancels a reload behind a pending save');
    await preferences({ enabled:true });
    await mounted();
    await open();
    const worker = await (await browser.waitForTarget(target => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${id}/`))).worker();
    assert.ok(worker);
    await worker.evaluate(() => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      const original = api.storage.sync.set;
      api.storage.sync.set = async patch => {
        if ('assignmentCenterView' in patch) { api.storage.sync.set = original; throw new Error('Synthetic preference failure'); }
        await original.call(api.storage.sync, patch);
      };
    });
    const beforeFailure = modernDocuments;
    await page.click('#list');
    await page.waitForSelector('.bn-classic-refresh-error[role="alert"]');
    assert.equal(modernDocuments, beforeFailure, 'A failed preference save cannot reload back into Classic');
    await returnToModern('list');
    assert.equal(await page.$('.bn-classic-refresh-error'), null);
    assert.equal(statusWrites, 2);
  } finally { await browser?.close(); await rm(fixture, { recursive:true, force:true }); }
});
