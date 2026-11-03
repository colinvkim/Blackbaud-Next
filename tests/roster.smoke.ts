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
const origin = 'https://roster-fixture.myschoolapp.com';
const url = `${origin}/app/student?svcid=edu#academicclass/123/0/roster`;
const tools = '[data-blackbaud-next-roster]';
const photo = `<div class="col-md-4"><div class="bb-avatar-wrapper"><img class="bb-avatar-image" alt="Example member" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ddd"/></svg>')}"></div></div>`;
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native roster</title><style>
  * { box-sizing: border-box; } body { margin: 0; font: 14px/1.5 Arial,sans-serif; }
  #site-main { padding: 16px; } .roster-controls { padding: 12px; background: #fafafa; }
  .roster-controls::after { content: ''; display: table; clear: both; }
  .input-group { display: table; } .pull-right { float: right; } .form-group { margin-bottom: 15px; }
  #native-search { display: inline-block; max-width: 100%; }
  input, select, button { font: inherit; } input, select { height: 34px; border: 1px solid #aaa; padding: 6px 10px; }
  .form-control { float: left; } .mr-5 { margin-right: 5px; }
  .roster-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .bb-card { min-width: 0; padding: 16px; border: 1px solid #ccc; }
  h1.bb-card-title { margin: 0 0 12px; font-size: 22px; } .bb-card a, .bb-card p { overflow-wrap: anywhere; }
  .contactCardP a { font-size: 12px; font-weight: 300; } input::placeholder { font-style: italic; }
  .bb-card-content > .row { margin-inline: -15px; } .row::before, .row::after { content: ''; display: table; clear: both; }
  .col-md-4, .col-md-8 { padding-inline: 15px; } .bb-avatar-wrapper { width: 104px; height: 104px; } .bb-avatar-image { display: block; width: 100px; height: 100px; }
  @media(min-width:992px) { .col-md-4 { float: left; width: 33.333333%; } .col-md-8 { float: left; width: 66.666667%; } }
  [hidden] { display: none; } @media(max-width:700px) { .roster-grid { grid-template-columns: minmax(0, 1fr); } }
</style></head><body><main id="site-main"><div id="academicclassnavmenu"><h1 class="bb-page-heading">Example class</h1></div>
<div id="academicclassmaincontainer">
  <div class="roster-controls"><div id="native-search"><input id="rosterSearchField" placeholder="Search for a member" aria-label="Search for a member"><button id="rosterSearchButton" data-native-action="search">Search</button></div>
  <div class="form-group input-group pull-right" id="term-picker"><select id="roster-term-picker" class="form-control input-medium mr-5" style="width:auto;margin-top:3px" aria-label="Semester"><option value="123">First semester</option><option value="456">Second semester</option><option value="789">Unavailable semester</option></select></div></div>
  <p id="member-count">2 Members</p><div class="roster-grid">
    <section class="bb-card bb-card-selectable roster-card"><header><label class="bb-card-header"><div class="bb-card-heading-middle"><h1 id="role-heading" class="bb-card-title"><span>Teacher</span></h1></div></label></header><div class="bb-card-content"><bb-card-content><div class="row">${photo}<div class="col-md-8"><h1 class="bb-card-title">Alex Example with a long family name <button id="pronounce" data-native-action="pronounce" aria-label="Play name pronunciation">◖</button></h1><div style="padding:10px 0 5px"></div><p class="contactCardP"><a href="mailto:alex@example.test">alex@example.test</a></p><div id="member-address">123 Example Street<br>Example City</div></div></div></bb-card-content></div><button id="more" data-native-action="more">More actions</button><p id="native-detail" hidden>Native contact details</p></section>
    <section class="bb-card bb-card-selectable roster-card"><div class="bb-card-content"><div class="row">${photo}<div class="col-md-8"><h1 class="bb-card-title">Sam Example</h1><div style="padding:10px 0 5px"></div><p class="contactCardP"><a href="mailto:sam@example.test">sam@example.test</a></p><div>456 Example Street</div></div></div></div></section>
    <section class="bb-card roster-card" hidden><div class="bb-card-content"><h1 class="bb-card-title">Native hidden member</h1></div></section>
  </div><article class="bb-card"><h1 id="unrelated-heading" class="bb-card-title">Another native card</h1></article>
</div></main><script>
  document.addEventListener('click', event => {
    const action = event.target.dataset.nativeAction;
    if (action) document.body.dataset[action] = String(Number(document.body.dataset[action] || 0) + 1);
    if (action === 'more') document.getElementById('native-detail').hidden = !document.getElementById('native-detail').hidden;
  });
  document.getElementById('roster-term-picker').addEventListener('change', () => { document.body.dataset.termChanges = String(Number(document.body.dataset.termChanges || 0) + 1); });
</script></body></html>`;

async function rosterLayout(page: Page, width: number): Promise<void> {
  await page.setViewport({ width, height: 900 });
  const layout = await page.evaluate(() => {
    const picker = document.getElementById('roster-term-picker')!;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-blackbaud-next-roster] button')];
    const bounds = (element: Element) => {
      const { left, right, top, bottom, height } = element.getBoundingClientRect(); return { left, right, top, bottom, height };
    };
    return { picker: bounds(picker), buttons: buttons.map(bounds), width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      names: [...document.querySelectorAll('.roster-card .bb-card-content h1.bb-card-title')].map(heading => ({ size: getComputedStyle(heading).fontSize, weight: getComputedStyle(heading).fontWeight })),
      role: getComputedStyle(document.getElementById('role-heading')!).fontSize,
      email: { size: getComputedStyle(document.querySelector('.contactCardP a')!).fontSize, weight: getComputedStyle(document.querySelector('.contactCardP a')!).fontWeight },
      address: getComputedStyle(document.getElementById('member-address')!).fontSize,
      classHeading: getComputedStyle(document.querySelector('.bb-page-heading')!).fontSize,
      unrelatedHeading: getComputedStyle(document.getElementById('unrelated-heading')!).fontSize,
      hidden: document.querySelector<HTMLElement>('.roster-card[hidden]')!.getBoundingClientRect().height };
  });
  assert.ok(layout.names.every(({ size, weight }) => size === '17px' && weight === '500'), 'Names have restrained card-title styling');
  assert.equal(layout.role, '12px', 'The role label stays secondary to the person name');
  assert.deepEqual(layout.email, { size: '13px', weight: '400' }, 'Email addresses use readable, regular-weight contact typography');
  assert.equal(layout.address, layout.email.size, 'Contact details share one type size');
  assert.equal(layout.classHeading, '28px');
  assert.equal(layout.unrelatedHeading, '28px', 'Roster sizing does not change other native headings');
  assert.equal(layout.hidden, 0);
  assert.ok(layout.documentWidth <= width + 1, JSON.stringify(layout));
  for (const control of [layout.picker, ...layout.buttons]) {
    assert.ok(control.left >= 0 && control.right <= width, JSON.stringify(layout));
    assert.ok(control.height >= (width <= 480 ? 44 : 36), JSON.stringify(layout));
  }
  if (width >= 850) for (const button of layout.buttons) assert.ok(Math.abs(button.top - layout.picker.top) < 1, 'Semester and copy actions share a top edge');
}

test('roster names and copy tools align, preserve native controls, and restore independently', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-roster-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/options.html`);
    await popup.waitForSelector('#mode-full:not(:disabled)');
    const preferences = (update: Record<string, boolean>) => popup.evaluate(async value => {
      await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.set(value);
    }, update);
    await preferences({ enabled: true, ...Object.fromEntries(FEATURE_DEFINITIONS.map(({ key }) => [key, key === 'pageAppearance' || key === 'rosterTools'])) });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let pending: HTTPRequest | undefined;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      const target = new URL(request.url());
      if (target.pathname.startsWith('/api/datadirect/sectionrosterget/')) {
        if (target.pathname.includes('/789/')) { pending = request; return; }
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Alex Example', email: 'alex@example.test' }]) });
      } else void request.respond({ status: 200, contentType: 'text/html', body: fixtureHtml });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`#site-main[data-bn-page="class"] ${tools}`);
    const rosterContent = await page.$eval('.roster-grid', grid => grid.innerHTML);
    for (const width of [1280, 850, 390, 320]) await rosterLayout(page, width);
    assert.deepEqual(await page.$$eval(`${tools} button`, buttons => buttons.map(button => button.textContent)), ['Copy names', 'Copy emails']);
    await page.setViewport({ width: 1280, height: 900 });
    await page.bringToFront();
    for (const selector of ['#rosterSearchButton', '#pronounce', '#more']) await page.click(selector);
    assert.deepEqual(await page.$eval('body', body => ({ search: body.dataset.search, pronounce: body.dataset.pronounce, more: body.dataset.more })), { search: '1', pronounce: '1', more: '1' });
    assert.equal(await page.$eval('#native-detail', detail => (detail as HTMLElement).hidden), false);
    await page.browserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await page.bringToFront();
    await page.click(`${tools} button:first-child`);
    await page.waitForFunction(() => document.querySelector('[data-blackbaud-next-roster] [role="status"]')?.textContent === 'Names copied.');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Alex Example');
    await page.select('#roster-term-picker', '456');
    assert.equal(await page.$eval('body', body => body.dataset.termChanges), '1');
    await page.click(`${tools} button:nth-child(2)`);
    await page.waitForFunction(() => document.querySelector('[data-blackbaud-next-roster] [role="status"]')?.textContent === 'Email addresses copied.');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'alex@example.test');
    await page.select('#roster-term-picker', '789');
    await page.click(`${tools} button:first-child`);
    await page.waitForSelector(`${tools} button:disabled`);
    await rosterLayout(page, 390);
    assert.ok(pending);
    await pending.respond({ status: 503, contentType: 'text/plain', body: 'Unavailable' });
    await page.waitForFunction(() => document.querySelector('[data-blackbaud-next-roster] [role="status"]')?.textContent?.includes('503'));
    await page.waitForSelector(`${tools} button:not(:disabled)`);
    await rosterLayout(page, 320);
    await preferences({ rosterTools: false });
    await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-roster]'));
    assert.equal(await page.$eval('#roster-term-picker', picker => (picker as HTMLElement).style.marginTop), '3px');
    assert.equal(await page.$eval('#term-picker', parent => getComputedStyle(parent).display), 'table');
    await preferences({ rosterTools: true, pageAppearance: false });
    await page.waitForSelector(tools);
    await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-appearance]'));
    assert.equal(await page.$eval('.roster-card .bb-card-content h1', heading => getComputedStyle(heading).fontSize), '22px');
    assert.equal(await page.$eval('#term-picker', parent => getComputedStyle(parent).display), 'flex', 'Copy tools retain their layout when Page appearance is off');
    await preferences({ enabled: false });
    await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-roster], [data-bn-page]'));
    await page.click('#more');
    assert.equal(await page.$eval('.roster-grid', grid => grid.innerHTML), rosterContent, 'Typography preserves native records, pronunciation controls, photos, and contact markup');
    await preferences({ enabled: true, pageAppearance: true });
    await page.waitForSelector(`#site-main[data-bn-page="class"] ${tools}`);
    assert.equal(await page.$$eval(tools, elements => elements.length), 1);
    await rosterLayout(page, 1280);
    assert.deepEqual(await page.$$eval('.bb-card-content .row', rows => rows.map(row => getComputedStyle(row).display)), ['grid', 'grid'], 'Both native content wrappers receive the guarded photo layout');
    await page.evaluate(() => { const field = document.createElement('p'); field.id = 'native-new-field'; field.textContent = 'New school-specific field'; document.querySelector('.bb-card-content .row')!.append(field); });
    assert.notEqual(await page.$eval('.bb-card-content .row', row => getComputedStyle(row).display), 'grid', 'Additional native columns retain the native profile layout');
    assert.equal(await page.$eval('#native-new-field', field => field.checkVisibility()), true);
    await page.evaluate(() => { const extra = document.createElement('button'); extra.id = 'native-extra'; extra.textContent = 'New native action'; document.getElementById('term-picker')!.append(extra); });
    assert.equal(await page.$eval('#term-picker', parent => getComputedStyle(parent).display), 'table', 'Changed native control structure retains native layout');
    assert.equal(await page.$eval('#native-extra', extra => extra.checkVisibility()), true);
  } finally {
    await browser?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
