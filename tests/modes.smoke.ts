import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { nativeHeaderFixtureHtml } from './fixtures/header.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://modes-fixture.myschoolapp.com';
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native assignments</title><style>
body { margin:0; font:14px Arial,sans-serif; } #site-top-spacer { height:180px; } #site-main { padding:16px; }
sky-toolbar, sky-repeater-item { display:block; } .topnav { display:flex; padding:0; margin:0; list-style:none; }
button { min-height:30px; } [hidden] { display:none; }
</style></head><body>${nativeHeaderFixtureHtml(true).replace('<main id="site-main"></main>', `<main id="site-main"><sky-toolbar><input aria-label="Search items"></sky-toolbar><sky-repeater-item class="assignment-repeater-item"><app-assignment-title-link><a id="native-assignment" href="/lms-assignment/assignment/assignment-student-view/123">Example assignment</a></app-assignment-title-link></sky-repeater-item></main>`)}</body></html>`;

async function ready(page: Page, selector: string) { await page.waitForSelector(`${selector}:not(:disabled)`); }

test('three modes apply live, retain customized Full, and reset across popup and Advanced settings', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-modes-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const base = `chrome-extension://${id}`;
    const worker = await (await browser.waitForTarget(target => target.type() === 'service_worker' && target.url().startsWith(base))).worker();
    assert.ok(worker);
    await worker.evaluate(async () => {
      await (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.set({
        automaticLogin:false, loadBetweenPages:false, fixFavicon:false, oldAssignmentCenter:true,
        loginFix:false, wideUI:true, copyRosterTools:false, downloadFullAvatar:false, fixBrokenAssignmentCenter:false,
      });
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(6_000);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      if (request.resourceType() === 'image') { void request.respond({ status:200, contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32"><rect width="160" height="32" fill="#ddd"/></svg>' }); return; }
      void request.respond({ status:200, contentType:'text/html', body:fixtureHtml });
    });
    await page.setViewport({ width:1280, height:900 });
    await page.goto(`${origin}/lms-assignment/assignment-center/student?svcid=edu`, { waitUntil:'domcontentloaded' });
    await page.waitForSelector('.bn-preview-button');
    let popup = await browser.newPage();
    popup.setDefaultTimeout(6_000);
    await popup.goto(`${base}/popup.html`);
    await ready(popup, '#mode-full');
    assert.equal(await popup.$eval('#mode-full', input => (input as HTMLInputElement).checked), true);
    assert.equal(await popup.$$eval('input', inputs => inputs.length), 3, 'The popup contains only the three mode inputs');
    assert.equal(await popup.$eval('#customized', label => (label as HTMLElement).hidden), true, 'The April release upgrades to the complete Full preset');
    const upgraded = await popup.evaluate(async () => (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome.storage.sync.get(null));
    assert.equal(upgraded.fullDefaultsVersion, 1);
    assert.equal(upgraded.automaticLogin, true);
    assert.equal(upgraded.assignmentCenterView, undefined, 'The old Assignment Center toggle does not select Classic');
    const opened = browser.waitForTarget(target => target.type() === 'page' && target.url() === `${base}/options.html`, { timeout:6_000 });
    await popup.click('a[href="options.html"]');
    const advanced = await (await opened).page();
    assert.ok(advanced);
    await advanced.bringToFront();
    advanced.setDefaultTimeout(6_000);
    await ready(advanced, '#mode-full');
    assert.equal(await advanced.$eval('#advanced-settings', details => (details as HTMLDetailsElement).open), false);
    assert.equal(await advanced.$eval('#rosterTools', input => input.checkVisibility()), false, 'Individual controls start hidden');
    await advanced.click('#mode-essentials');
    await popup.waitForFunction(() => (document.getElementById('mode-essentials') as HTMLInputElement).checked, { polling:100 });
    await advanced.click('#mode-full');
    await advanced.focus('#advanced-settings > summary');
    await advanced.keyboard.press('Space');
    await advanced.waitForSelector('#rosterTools', { visible:true });
    for (const selector of ['#pageAppearance', '#automaticLogin', '#assignmentPreviews', '#assignmentReturnLink']) assert.ok(await advanced.$(selector));
    assert.equal(await advanced.$$eval('#classicAssignmentCenter, #oldAssignmentCenter', inputs => inputs.length), 0, 'Assignment views are chosen on Assignment Center');
    await advanced.click('#rosterTools');
    await advanced.click('#assignmentPreviews');
    await advanced.type('#account-preference', 'student@school.test');
    await advanced.click('#save-account');
    await advanced.waitForFunction(() => (document.getElementById('save-account') as HTMLButtonElement).disabled && document.getElementById('save-status')?.textContent === '', { polling:100 });
    assert.equal(await advanced.$eval('#save-feedback', footer => (footer as HTMLElement).hidden), true, 'Idle settings have no footer helper or success message');
    await popup.waitForSelector('#customized:not([hidden])');

    await page.waitForSelector('html[data-blackbaud-next-appearance]');
    await page.waitForSelector('[data-blackbaud-next-favicon]');
    await page.waitForFunction(() => !document.querySelector('.bn-preview-button'), { polling:100 });
    assert.equal(await page.$('.bn-preview-button'), null, 'Full honors the saved preview preference');
    const native = await page.$('#native-assignment');

    await popup.bringToFront();
    await popup.click('#mode-off');
    await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-appearance], [data-blackbaud-next-favicon], .bn-preview-button, .bn-assignment-shortcuts'), { polling:100 });
    assert.equal(await native!.evaluate(link => link.isConnected), true, 'Off retains the original native assignment');
    await popup.focus('#mode-off');
    await popup.keyboard.press('ArrowRight');
    await popup.waitForFunction(() => (document.getElementById('mode-essentials') as HTMLInputElement).checked, { polling:100 });
    await page.waitForSelector('.bn-preview-button');
    assert.equal(await page.$('[data-blackbaud-next-appearance], [data-blackbaud-next-favicon], .bn-assignment-shortcuts'), null, 'Login + previews leaves appearance and other tools native');
    await advanced.bringToFront();
    await advanced.click('#mode-full');
    await popup.waitForFunction(() => (document.getElementById('mode-full') as HTMLInputElement).checked, { polling:100 });
    await page.waitForSelector('html[data-blackbaud-next-appearance]');
    await page.waitForFunction(() => !document.querySelector('.bn-preview-button'), { polling:100 });
    const stored = await advanced.evaluate(async () => (globalThis as typeof globalThis & { chrome:ExtensionApi }).chrome.storage.sync.get(null));
    assert.equal(stored.rosterTools, false);
    assert.equal(stored.assignmentPreviews, false);
    assert.equal(stored.accountPreference, 'student@school.test');
    await popup.bringToFront();
    await popup.click('#reset-full');
    await popup.waitForSelector('#customized[hidden]');
    assert.equal(await popup.evaluate(() => document.activeElement?.id), 'mode-full', 'Reset returns keyboard focus to the active mode');
    await advanced.waitForFunction(() => (document.getElementById('assignmentPreviews') as HTMLInputElement).checked && (document.getElementById('rosterTools') as HTMLInputElement).checked, { polling:100 });
    await page.waitForSelector('.bn-preview-button');
    assert.equal(await advanced.$eval('#account-preference', input => (input as HTMLInputElement).value), 'student@school.test');

    for (const theme of ['light', 'dark']) {
      await popup.emulateMediaFeatures([{ name:'prefers-color-scheme', value:theme }]);
      await popup.setViewport({ width:380, height:340 });
      const bounds = await popup.evaluate(() => ({ width:innerWidth, documentWidth:document.documentElement.scrollWidth, height:document.body.scrollHeight, viewport:innerHeight }));
      assert.ok(bounds.documentWidth <= bounds.width && bounds.height <= bounds.viewport, JSON.stringify(bounds));
    }
    for (const width of [1100, 390, 320]) {
      await advanced.bringToFront();
      await advanced.focus('#mode-full');
      await advanced.setViewport({ width, height:900 });
      assert.ok(await advanced.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Advanced settings fits narrow windows');
      assert.ok(await advanced.$$eval('.settings-list > li', items => {
        const rows = items.map(item => item.getBoundingClientRect());
        return rows.length > 1 && rows.every((row, index) => row.width === rows[0]!.width &&
          row.left === rows[0]!.left && (!index || row.top >= rows[index - 1]!.bottom));
      }), 'Every advanced preference shares one vertical list at every width');
      await advanced.$eval('.settings-list > li:last-child input', input => (input as HTMLElement).focus());
      assert.ok(await advanced.evaluate(() => {
        const footer = document.querySelector('footer')!;
        return document.activeElement!.getBoundingClientRect().bottom <= (footer.hidden ? innerHeight : footer.getBoundingClientRect().top);
      }), 'The last preference remains reachable');
    }
    await popup.evaluate(() => (document.getElementById('mode-off') as HTMLInputElement).click());
    await popup.close();
    popup = await browser.newPage();
    popup.setDefaultTimeout(6_000);
    await popup.goto(`${base}/popup.html`);
    await ready(popup, '#mode-off');
    await popup.waitForFunction(() => (document.getElementById('mode-off') as HTMLInputElement).checked, { polling:100 });
    await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-appearance], .bn-preview-button'), { polling:100 });
  } finally {
    await browser?.close();
    await rm(fixture, { recursive:true, force:true });
  }
});
