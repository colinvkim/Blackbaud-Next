import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { Browser } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(import.meta.dirname, '..');
const origin = 'https://detail-fixture.myschoolapp.com';
const url = `${origin}/lms-assignment/assignment/assignment-student-view/123`;
const title = 'Independent research: prepare a reflection and bring your annotated reading to the next discussion';
const field = (term: string, value: string) => `<div class="sky-description-list-content"><dt><span class="description-list-term">${term}</span></dt><dd><span class="sky-description-list-description">${value}</span></dd></div>`;
const column = (fields: string) => `<sky-column class="sky-column sky-column-sm-6 sky-column-xs-12"><sky-description-list><dl class="sky-description-list sky-description-list-horizontal-mode">${fields}</dl></sky-description-list></sky-column>`;
const card = (id: string, heading: string, content: string) => `<sky-box class="sky-theme-margin-bottom-xl"><section id="${id}" class="sky-box sky-shadow sky-border-dark"><div class="sky-box-header-content"><div class="sky-box-header-right"><h2 class="sky-font-heading-2">${heading}</h2></div></div><sky-box-content><div class="sky-box-content">${content}</div></sky-box-content></section></sky-box>`;
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  * { box-sizing: border-box; } body { margin: 0; font: 15px/1.3 Arial,sans-serif; }
  app-assignment-view-details > .header { display: inline-block; width: 100%; padding-left: 20px; }
  h1 { font: 300 34px/1.1 Arial,sans-serif; } .display-inline { display: inline; }
  .pull-right { float: right; } .sky-theme-margin-bottom-l { margin-bottom: 10px; }
  .sky-theme-margin-bottom-xl { margin-bottom: 20px; } .sky-theme-padding-inset-balanced-m { padding: 15px; }
  .sky-fluid-grid { padding: 0 10px; } .sky-fluid-grid-gutter-size-large { padding: 0 15px; }
  .sky-row { display: flex; flex-wrap: wrap; margin: 0 -10px; }
  .sky-fluid-grid-gutter-size-large > sky-row > .sky-row { margin: 0 -15px; }
  sky-column { display: block; padding: 0 10px; } .sky-column-sm-3 { width: 25%; } .sky-column-sm-9 { width: 75%; }
  .sky-column-sm-6 { width: 50%; padding: 0 15px; }
  dl { display: flex; flex-wrap: wrap; margin: 0 0 -15px; }
  .sky-description-list-content { width: 50%; padding-right: 60px; margin-bottom: 15px; }
  dt { font-size: 14px; color: #686c73; margin-bottom: 3px; } dd { margin: 0; }
  .display-flex, .flex-wrapper { display: flex; } .flex-wrapper { flex-wrap: wrap; }
  .sky-theme-margin-right-s { margin-right: 10px; }
  sky-box { display: block; } .sky-box { border: 1px solid #ccc; box-shadow: 0 0 5px #888; }
  .sky-box-header-content { padding: 20px 20px 0; } h2 { margin: 0; font: 300 26px/1.1 Arial,sans-serif; }
  .sky-box-content { padding: 20px; } textarea { max-width: 100%; } button, a { cursor: pointer; }
  [hidden] { display: none; }
  @media (max-width: 767px) { .sky-column-xs-12 { width: 100%; } }
</style></head><body><app-root><app-assignment-student-view><app-assignment-view><div>
  <div><app-assignment-view-details><div class="header">
    <div class="sky-theme-margin-bottom-l"><h1 class="sky-theme-font-heading-1 display-inline"><a href="javascript:history.back()">Assignments</a> &gt; <span>${title}</span></h1><sky-help-inline class="pull-right"><button id="help" aria-label="Help">?</button></sky-help-inline></div>
    <div class="sky-theme-margin-bottom-xl"><sky-fluid-grid><div class="sky-fluid-grid sky-fluid-grid-gutter-size-large"><sky-row><div class="sky-row">
      ${column(field('Class', 'Interdisciplinary studies and research') + field('Type', 'Homework') + field('Status', '<div class="display-flex"><button id="status" class="sky-btn">To do</button></div>'))}
      ${column(field('Assigned', '11/1/2026<br>8:00 AM') + field('Due', '<div class="flex-wrapper"><div class="sky-theme-margin-right-s">11/5/2026<br>9:30 AM</div><div class="sky-font-deemphasized">Due in 4 days</div></div>'))}
    </div></sky-row></div></sky-fluid-grid></div>
  </div></app-assignment-view-details></div>
  <div class="white-bg blue-border-bottom"></div>
  <div class="sky-theme-padding-inset-balanced-m"><sky-fluid-grid><div class="sky-fluid-grid"><sky-row><div class="sky-row">
    <sky-column class="sky-column sky-column-sm-3 sky-column-xs-12"><div id="optional-content" class="sky-theme-margin-bottom-xl"><!-- native placeholder --></div><app-user-task-box>${card('tasks', 'Associated tasks', '<button id="add-task">Add task</button>')}</app-user-task-box></sky-column>
    <sky-column class="sky-column sky-column-sm-9 sky-column-xs-12"><app-assignment-description-box>${card('description', 'Description', '<p>Read the chapter and prepare a reflection.</p><a href="/reading.pdf">Reading attachment</a><textarea readonly aria-label="Feedback">Native feedback</textarea><button disabled>Submit</button><div id="private-content" hidden>Native unpublished content</div>')}</app-assignment-description-box></sky-column>
  </div></sky-row></div></sky-fluid-grid></div>
  <div id="native-panel" hidden><label>Task name <input></label><button id="close-task">Cancel</button></div>
</div></app-assignment-view></app-assignment-student-view><aside id="other-view"></aside></app-root>
<script>
  document.addEventListener('click', event => {
    const id = event.target.id;
    const key = id.replaceAll('-', '');
    if (['status','help','add-task'].includes(id)) document.body.dataset[key] = String(Number(document.body.dataset[key] || 0) + 1);
    if (id === 'add-task') document.getElementById('native-panel').hidden = false;
    if (id === 'close-task') document.getElementById('native-panel').hidden = true;
  });
</script></body></html>`;

test('assignment detail cosmetics preserve native content, controls, responsive layout, and structural fallback', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-detail-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#enabled:not(:disabled)');
    const setPreferences = (update: Record<string, boolean>) => popup.evaluate(async preferences => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set(preferences);
    }, update);
    await setPreferences({ enabled: true, ...Object.fromEntries(FEATURE_DEFINITIONS.map(({ key }) => [key, key === 'pageAppearance'])) });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      void request.respond({ status: 200, contentType: 'text/html', body: fixtureHtml });
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const mounted = () => page.waitForSelector('app-assignment-view[data-bn-page="assignment"]');
    const unmounted = () => page.waitForFunction(() => !document.querySelector('[data-bn-page]'));
    await mounted();
    const original = await page.$eval('app-assignment-view', element => element.innerHTML);
    let desktopTitleSize = 0;
    for (const width of [1280, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const heading = document.querySelector('h1 > span')!;
        const breadcrumb = document.querySelector('h1 > a')!;
        const tasks = document.querySelector('#tasks')!.getBoundingClientRect();
        const description = document.querySelector('#description')!.getBoundingClientRect();
        return { titleSize: parseFloat(getComputedStyle(heading).fontSize), breadcrumbSize: parseFloat(getComputedStyle(breadcrumb).fontSize),
          tasksTop: tasks.top, tasksLeft: tasks.left, descriptionTop: description.top, descriptionLeft: description.left,
          titleRight: heading.getBoundingClientRect().right, documentWidth: document.documentElement.scrollWidth,
          privateHeight: document.querySelector('#private-content')!.getBoundingClientRect().height };
      });
      assert.ok(layout.titleSize > layout.breadcrumbSize, 'The assignment title leads over the breadcrumb');
      assert.ok(layout.titleRight <= width && layout.documentWidth <= width, 'Long titles and metadata fit the viewport');
      assert.equal(layout.privateHeight, 0, 'Native unpublished content remains hidden');
      if (width === 1280) {
        desktopTitleSize = layout.titleSize;
        assert.ok(Math.abs(layout.tasksTop - layout.descriptionTop) < 1, 'Cards align when the optional sidebar placeholder is empty');
      } else {
        assert.ok(layout.titleSize < desktopTitleSize, 'Phone titles use a more compact scale');
        assert.ok(layout.descriptionTop > layout.tasksTop, 'Narrow cards keep the native stacking order');
        assert.equal(layout.tasksLeft, layout.descriptionLeft);
      }
      assert.equal(await page.$eval('app-assignment-view', element => element.innerHTML), original, 'Appearance preserves every native descendant and its state');
    }
    await page.setViewport({ width: 1280, height: 900 });
    await page.$eval('h1 > span', element => { (element as HTMLElement).hidden = true; });
    assert.equal(await page.$eval('h1 > span', element => element.getBoundingClientRect().height), 0, 'Native hidden titles remain hidden');
    await page.$eval('h1 > span', element => { (element as HTMLElement).hidden = false; });
    await page.$eval('#optional-content', element => { element.textContent = 'Additional native information'; });
    assert.equal(await page.$eval('#optional-content', element => getComputedStyle(element).marginBottom), '20px', 'A populated native sidebar retains its spacing');
    await page.$eval('#optional-content', element => { element.textContent = ''; });
    for (const selector of ['#status', '#help', '#add-task']) await page.click(selector);
    assert.deepEqual(await page.$eval('body', element => ['status', 'help', 'addtask'].map(key => (element as HTMLElement).dataset[key])), ['1', '1', '1'], 'Native status, help, and task controls remain clickable');
    await page.waitForSelector('#native-panel', { visible: true });
    await page.type('#native-panel input', 'Draft task');
    await page.click('#close-task');
    for (const key of ['pageAppearance', 'enabled']) {
      await setPreferences({ [key]: false });
      await unmounted();
      assert.equal(await page.$eval('h1', element => getComputedStyle(element).fontSize), '34px', 'Disabling restores native title styling');
      assert.equal(await page.$eval('#optional-content', element => getComputedStyle(element).marginBottom), '20px');
      await setPreferences({ [key]: true });
      await mounted();
      assert.equal(await page.$eval('#native-panel input', element => (element as HTMLInputElement).value), 'Draft task', 'Preference changes preserve native form state');
    }
    await page.$eval('h1', element => element.insertAdjacentHTML('beforeend', '<button id="new-native-action">New native action</button>'));
    await unmounted();
    assert.equal(await page.$eval('h1', element => getComputedStyle(element).fontSize), '34px', 'Unknown heading structure returns to native styling');
    await page.$eval('#new-native-action', element => element.remove());
    await mounted();
    await page.$eval('app-assignment-view', element => document.querySelector('#other-view')!.append(element));
    await unmounted();
    await page.$eval('app-assignment-view', element => document.querySelector('app-assignment-student-view')!.append(element));
    await mounted();
    await page.$eval('app-assignment-view', element => {
      const replacement = element.cloneNode(true) as HTMLElement;
      replacement.removeAttribute('data-bn-page');
      element.replaceWith(replacement);
    });
    await mounted();
    await page.evaluate(() => { history.pushState({}, '', '/sis-scheduling/user-calendar'); dispatchEvent(new PopStateEvent('popstate')); });
    await unmounted();
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
