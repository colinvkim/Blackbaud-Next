import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://completion-fixture.myschoolapp.com';
const sourceUrl = `${origin}/lms-assignment/assignment-center/student/?svcid=edu`;
const endpoint = '/api/assignment2/assignmentstatusupdate';
const row = (id: number) => `[data-assignment-id="${id}"]`;
const checkbox = (id: number) => `${row(id)} .bn-completion-control input[type="checkbox"]`;
const noticeAction = '.bn-completion-notice button:first-of-type';

function nativeFixture(): string {
  const rows = [[123, 'To do'], [234, 'Overdue'], [345, 'Completed'], [456, 'Submitted'], [567, 'Graded'], [678, 'Graded'], [789, 'Missing'], [890, 'In progress']]
    .map(([id, status]) => `<sky-repeater-item class="assignment-repeater-item" data-assignment-id="${id}"><div class="sky-repeater-item" role="row"><div class="sky-repeater-item-header"><app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/${id}">Synthetic assignment ${id}</a></app-assignment-title-link><div class="assignment-center-middle-block"><div class="assignment-details sky-font-deemphasized">Due: 10/13/2026 8:30 AM | Assigned: 10/1/2026 | 10 pts | Class</div><app-assignment-status-display>${Number(id) >= 678 ? `<span class="display-flex"><sky-icon iconsize="m"></sky-icon><span>${status}</span></span>` : `<button type="button" aria-label="Native assignment status" aria-haspopup="dialog">${status}</button>`}</app-assignment-status-display></div></div></div></sky-repeater-item>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Native assignment fixture</title><style>
    * { box-sizing: border-box; } body { margin: 0; font: 16px/1.5 Arial,sans-serif; }
    app-root, sky-toolbar, sky-repeater-item, app-assignment-status-display, app-assignment-title-link { display: block; }
    main { max-width: 900px; margin: auto; padding: 16px; } sky-toolbar { margin-bottom: 16px; }
    .assignment-repeater-item { padding: 12px; border-bottom: 1px solid #ddd; overflow-wrap: anywhere; }
    .assignment-center-middle-block { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .assignment-details { flex-basis: 100%; font-size: 13px; } button { padding: 8px 12px; }
    .display-flex { display: flex; } [hidden] { display: none; }
    sky-modal-host { position: fixed; inset: 0; z-index: 100000; background: #0004; display: grid; place-items: center; }
    app-status-change-modal { display: block; padding: 20px; background: white; } sky-radio { display: block; }
  </style></head><body><app-root><main><sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater-item id="native-group"><div class="sky-repeater-item-header">Native date group</div><div class="sky-repeater-item-body">${rows}</div></sky-repeater-item></main></app-root><script>
    document.addEventListener('blackbaud-next:assignment-status-response-v1', event => {
      const response = JSON.parse(event.detail);
      document.body.dataset.statusSignals = [document.body.dataset.statusSignals, response.status].filter(Boolean).join(',');
    });
    const definitions = [{label:'To do',value:-1},{label:'In progress',value:0},{label:'Completed',value:1},{label:'Overdue',value:2}];
    document.querySelectorAll('app-assignment-status-display button').forEach(button => button.addEventListener('click', () => {
      const nativeRow = button.closest('.assignment-repeater-item');
      const assignmentIndexId = Number(nativeRow.dataset.assignmentId);
      if (button.textContent === 'Submitted' || button.textContent === 'Graded') {
        document.body.dataset.nativeActions = String(Number(document.body.dataset.nativeActions || 0) + 1); return;
      }
      if (document.querySelector('app-status-change-modal')) return;
      const choices = definitions.filter(choice => choice.label !== (assignmentIndexId === 234 ? 'To do' : 'Overdue'));
      const background = document.querySelector('body > app-root');
      const host = document.createElement('sky-modal-host');
      const modal = document.createElement('app-status-change-modal');
      modal.innerHTML = choices.map(choice => '<sky-radio><label><input type="radio" name="assignment-status" aria-label="' + choice.label + '" value="' + choice.value + '"' + (choice.label === button.textContent ? ' checked' : '') + '>' + choice.label + '</label></sky-radio>').join('') + '<button id="print-button" type="button">Save</button><button id="cancel-button" type="button">Cancel</button>';
      const close = () => { host.remove(); background.removeAttribute('aria-hidden'); };
      modal.querySelector('#cancel-button').addEventListener('click', close);
      modal.querySelector('#print-button').addEventListener('click', () => {
        const selected = modal.querySelector('input:checked');
        const definition = choices.find(choice => String(choice.value) === selected.value);
        close();
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
          if (xhr.status < 200 || xhr.status >= 300) return;
          try { if (xhr.responseText !== '') JSON.parse(xhr.responseText); } catch { return; }
          button.textContent = definition.label;
        });
        xhr.open('POST', '${endpoint}', true);
        xhr.setRequestHeader('content-type', 'application/json');
        xhr.send(JSON.stringify({ assignmentIndexId, assignmentStatus: definition.value }));
      });
      background.setAttribute('aria-hidden', 'true');
      host.append(modal); document.body.append(host);
      modal.querySelector('input:checked').focus();
    }));
  </script></body></html>`;
}

function isNativeSave(request: HTTPRequest): boolean {
  const url = new URL(request.url());
  return request.method() === 'POST' && url.origin === origin && url.pathname === endpoint;
}

async function syntheticPage(browser: Browser): Promise<{ page: Page; writes: Array<{ assignmentIndexId: number; assignmentStatus: number }> }> {
  const page = await browser.newPage();
  const writes: Array<{ assignmentIndexId: number; assignmentStatus: number }> = [];
  page.setDefaultTimeout(10_000);
  await page.setViewport({ width: 900, height: 800 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    if (isNativeSave(request)) {
      const value: unknown = JSON.parse(request.postData() ?? 'null');
      assert.ok(value && typeof value === 'object' && 'assignmentIndexId' in value && 'assignmentStatus' in value);
      assert.equal(typeof value.assignmentIndexId, 'number');
      assert.equal(typeof value.assignmentStatus, 'number');
      writes.push({ assignmentIndexId: Number(value.assignmentIndexId), assignmentStatus: Number(value.assignmentStatus) });
      // Keep the native XHR pending until this test supplies its synthetic reply.
      return;
    }
    const url = new URL(request.url());
    void request.respond(url.origin === origin && url.pathname === '/lms-assignment/assignment-center/student/'
      ? { status: 200, contentType: 'text/html', body: nativeFixture() }
      : { status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(checkbox(123));
  return { page, writes };
}

async function startSave(page: Page, selector: string, id: number, status: number, keyboard = false): Promise<HTTPRequest> {
  const request = page.waitForRequest(isNativeSave);
  if (keyboard) { await page.focus(selector); await page.keyboard.press('Space'); }
  else await page.click(selector);
  const xhr = await request;
  assert.deepEqual(JSON.parse(xhr.postData() ?? 'null'), { assignmentIndexId: id, assignmentStatus: status });
  await page.waitForFunction((id) => {
    const row = document.querySelector(`[data-assignment-id="${id}"]`);
    return row?.querySelector<HTMLInputElement>('.bn-completion-control input')?.disabled;
  }, { polling: 100 }, id);
  return xhr;
}

async function respondSaved(page: Page, request: HTTPRequest, id: number, status: string): Promise<void> {
  await request.respond({ status: 200, contentType: 'application/json', body: '{}' });
  await page.waitForFunction((id, status) => {
    const row = document.querySelector(`[data-assignment-id="${id}"]`);
    return row?.querySelector('app-assignment-status-display button')?.textContent === status &&
      row.querySelector<HTMLInputElement>('.bn-completion-control input')?.disabled === false;
  }, { polling: 100 }, id, status);
  assert.equal(await page.$('.bn-completion-notice, .bn-completion-undo'), null, 'Successful saves add no notice or Undo');
  assert.equal(await page.$('.bn-completion-control button'), null, 'The checkbox is the only completion action');
  assert.match(await page.$eval('body', (element) => (element as HTMLElement).dataset.statusSignals ?? ''), /ready,sent,saved$/);
}

async function togglePreference(popup: Page, page: Page, key: 'assignmentCompletion' | 'assignmentStatusLabels' | 'mode-off' | 'mode-full'): Promise<void> {
  await popup.bringToFront();
  if (!key.startsWith('mode-') && !await popup.$eval('#advanced-settings', details => (details as HTMLDetailsElement).open)) await popup.click('#advanced-settings > summary');
  await popup.waitForSelector(`#${key}:not(:disabled)`);
  await popup.click(`#${key}`);
  await page.bringToFront();
}

test('compiled Chrome completion controls preserve native saves, failures, filtering, keyboard use and switch cleanup', { timeout: 120_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-completion-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    const executable = await ensureDevelopmentBrowser(developmentPaths(root).cache);
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), executable);
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/options.html`);
    await popup.waitForSelector('#mode-full:not(:disabled)');
    await popup.evaluate(async (features) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ enabled: true, ...Object.fromEntries(features.map((key) => [key, key === 'assignmentCompletion' || key === 'assignmentStatusLabels' || key === 'assignmentShortcuts'])) });
    }, FEATURE_DEFINITIONS.map(({ key }) => key));
    const { page, writes } = await syntheticPage(browser);
    assert.equal(await page.$$eval('.bn-completion-control', (elements) => elements.length), 3);
    assert.equal(await page.$(`${row(456)} .bn-completion-control`), null);
    assert.equal(await page.$(`${row(567)} .bn-completion-control`), null);
    for (const nativeId of [456, 567]) await page.click(`${row(nativeId)} app-assignment-status-display button`);
    assert.equal(await page.$eval('body', (element) => (element as HTMLElement).dataset.nativeActions), '2');
    for (const [staticId, status, color] of [[678, 'Graded', 'rgb(39, 97, 58)'], [789, 'Missing', 'rgb(180, 35, 24)'], [890, 'In progress', 'rgb(138, 87, 0)']] as const) {
      await page.waitForSelector(`${row(staticId)} [data-bn-assignment-status]`);
      assert.equal(await page.$eval(`${row(staticId)} [data-bn-assignment-status]`, element => element.textContent), status);
      assert.equal(await page.$(`${row(staticId)} input, ${row(staticId)} button`), null, `${status} remains non-interactive with Page appearance off`);
      assert.equal(await page.$eval(`${row(staticId)} sky-icon`, element => getComputedStyle(element).display), 'none');
      const graphic = await page.$eval(`${row(staticId)} svg[data-bn-owned]`, element => ({ width: element.getBoundingClientRect().width, color: getComputedStyle(element).color }));
      assert.equal(graphic.width, 18);
      assert.equal(graphic.color, color);
      await page.click(`${row(staticId)} [data-bn-assignment-status]`);
    }
    assert.equal(writes.length, 0);

    await respondSaved(page, await startSave(page, checkbox(123), 123, 1), 123, 'Completed');
    assert.equal(await page.$eval(checkbox(123), (element) => (element as HTMLInputElement).checked), true);
    await respondSaved(page, await startSave(page, checkbox(123), 123, -1), 123, 'To do');
    assert.equal(await page.$eval(checkbox(123), (element) => (element as HTMLInputElement).checked), false);

    const failed = await startSave(page, checkbox(123), 123, 1);
    assert.equal(await page.$eval(`${row(123)} .bn-completion-feedback`, (element) => element.textContent), '');
    await page.waitForFunction(() => document.querySelector('[data-assignment-id="123"] .bn-completion-feedback')?.textContent === 'Saving…', { polling: 100 });
    assert.equal(await page.$('.bn-completion-notice'), null, 'A visible slow save uses inline feedback');
    await failed.respond({ status: 503, contentType: 'application/json', body: '{}' });
    await page.waitForFunction(() => document.querySelector('.bn-completion-notice')?.textContent?.includes('Could not save'), { polling: 100 });
    assert.equal(await page.$eval(noticeAction, (element) => element.textContent), 'Retry');
    assert.equal(await page.$eval(checkbox(123), (element) => (element as HTMLInputElement).checked), false);
    await respondSaved(page, await startSave(page, noticeAction, 123, 1), 123, 'Completed');
    await respondSaved(page, await startSave(page, checkbox(123), 123, -1), 123, 'To do');

    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.bn-assignment-shortcuts button')].find((button) => button.textContent?.includes('Unfinished'))!.click());
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.bn-assignment-shortcuts button[aria-pressed="true"]')?.textContent?.includes('Unfinished'), { polling: 100 });
    for (const unfinishedId of [789, 890]) {
      assert.equal(await page.$eval(row(unfinishedId), element => getComputedStyle(element).display === 'none'), false, 'Missing and In progress remain unfinished');
    }
    const filtered = await startSave(page, checkbox(123), 123, 1, true);
    assert.equal(await page.$eval(row(123), (element) => getComputedStyle(element).display === 'none'), false);
    assert.equal(await page.$eval(`${row(123)} app-assignment-status-display button`, (element) => element.textContent), 'To do');
    await respondSaved(page, filtered, 123, 'Completed');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-assignment-id="123"]')!).display === 'none', { polling: 100 });
    await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), { polling: 100 }, checkbox(234));
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.bn-assignment-shortcuts button')].find((button) => button.textContent?.includes('All loaded'))!.click());
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-assignment-id="123"]')!).display !== 'none', { polling: 100 });
    await respondSaved(page, await startSave(page, checkbox(123), 123, -1), 123, 'To do');
    await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), { polling: 100 }, checkbox(123));
    assert.equal(await page.$eval(row(123), (element) => getComputedStyle(element).display === 'none'), false);

    await page.setViewport({ width: 320, height: 800 });
    await respondSaved(page, await startSave(page, checkbox(234), 234, 1, true), 234, 'Completed');
    const narrowFailure = await startSave(page, checkbox(234), 234, 2, true);
    await narrowFailure.respond({ status: 503, contentType: 'application/json', body: '{}' });
    await page.waitForSelector('.bn-completion-notice[role="alert"]');
    await page.waitForSelector(`${row(678)} [data-bn-assignment-status]`);
    const bounds = await page.$$eval('.bn-completion-control label, [data-bn-assignment-status], .bn-completion-notice, .bn-completion-notice .bn-button', (elements) => elements.filter((element) => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && !element.closest('[data-blackbaud-next-shortcut-hidden]')).map((element) => {
      const { left, right, height } = element.getBoundingClientRect(); return { left, right, height };
    }));
    assert.ok(bounds.length >= 2);
    assert.ok(bounds.every(({ left, right }) => left >= 0 && right <= 320), JSON.stringify(bounds));
    assert.ok(bounds.every(({ height }) => height >= 44), JSON.stringify(bounds));
    await respondSaved(page, await startSave(page, noticeAction, 234, 2), 234, 'Overdue');
    assert.equal(await page.$eval(`${row(234)} .bn-completion-overdue`, (element) => (element as HTMLElement).hidden), false);

    await popup.waitForFunction(() => (document.getElementById('assignmentCompletion') as HTMLInputElement)?.checked === true, { polling: 100 });
    await togglePreference(popup, page, 'assignmentCompletion');
    await page.waitForFunction(() => !document.querySelector('.bn-completion-control, .bn-completion-notice, .bn-completion-undo, [data-blackbaud-next-completion-native]'), { polling: 100 });
    for (const staticId of [678, 789, 890]) assert.ok(await page.$(`${row(staticId)} [data-bn-assignment-status]`), 'Labels remain enhanced with native completion controls');
    await togglePreference(popup, page, 'assignmentStatusLabels');
    await page.waitForFunction(() => !document.querySelector('[data-bn-assignment-status], [data-bn-assignment-native-icon]'), { polling: 100 });
    assert.equal(await page.$eval(`${row(123)} app-assignment-status-display`, (element) => getComputedStyle(element).display === 'none'), false);
    for (const staticId of [678, 789, 890]) assert.notEqual(await page.$eval(`${row(staticId)} sky-icon`, element => getComputedStyle(element).display), 'none');
    await togglePreference(popup, page, 'assignmentCompletion');
    await page.waitForSelector(checkbox(123));
    const pending = await startSave(page, checkbox(123), 123, 1);
    const count = writes.length;
    const pendingControl = await page.$(checkbox(123));
    await togglePreference(popup, page, 'assignmentStatusLabels');
    await page.waitForSelector(`${row(678)} [data-bn-assignment-status]`);
    assert.ok(await pendingControl!.evaluate(input => input.isConnected && (input as HTMLInputElement).disabled), 'Label styling preserves the original pending completion control');
    assert.equal(writes.length, count, 'Changing label styling does not issue another save');
    await togglePreference(popup, page, 'mode-off');
    await page.waitForFunction(() => !document.querySelector('.bn-completion-control, .bn-completion-notice, .bn-completion-undo, .bn-assignment-shortcuts, [data-blackbaud-next-completion-native], [data-bn-assignment-status], [data-bn-assignment-native-icon]'), { polling: 100 });
    assert.equal(writes.length, count);
    await pending.respond({ status: 200, contentType: 'application/json', body: '{}' });
    await page.waitForFunction(() => document.querySelector('[data-assignment-id="123"] app-assignment-status-display button')?.textContent === 'Completed', { polling: 100 });
    assert.equal(await page.$('.bn-completion-notice, .bn-completion-undo'), null);
    await togglePreference(popup, page, 'mode-full');
    await page.waitForSelector(checkbox(123));
    assert.equal(await page.$eval(checkbox(123), (element) => (element as HTMLInputElement).checked), true);
    assert.equal(writes.length, count);
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
