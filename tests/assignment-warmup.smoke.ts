import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://warmup-fixture.myschoolapp.com';
const sourceUrl = `${origin}/app/student?svcid=edu#studentmyday/schedule`;
const nativeHref = '/lms-assignment/assignment-center/student/?svcid=edu';
const ruleSelector = '#blackbaud-next-assignment-warmup';

function nativeFixture(hidden: boolean): string {
  const schedule = '<main id="site-main"><div id="accordionSchedules">Synthetic native schedule</div></main>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Warmup fixture</title></head><body>
    <nav><a id="assignment-center-btn" href="${nativeHref}">Assignment Center</a></nav>
    <section id="visible">${hidden ? '' : schedule}</section><section id="hidden" hidden>${hidden ? schedule : ''}</section>
    <button id="show-source" type="button">Show schedule</button><button id="hide-source" type="button">Hide schedule</button>
    <script>
      document.getElementById('show-source').addEventListener('click', () => document.getElementById('visible').append(document.getElementById('site-main')));
      document.getElementById('hide-source').addEventListener('click', () => document.getElementById('hidden').append(document.getElementById('site-main')));
    </script></body></html>`;
}

async function syntheticPage(browser: Browser, hidden: boolean): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultTimeout(3_000);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    const url = new URL(request.url());
    void request.respond(url.origin === origin && url.pathname === '/app/student'
      ? { status: 200, contentType: 'text/html', body: nativeFixture(hidden) }
      : { status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic destination</title>' });
  });
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForSelector('#show-source');
  return page;
}

async function expectPrepared(page: Page): Promise<void> {
  await page.waitForSelector(ruleSelector);
  const rule = await page.$eval(ruleSelector, (element) => ({ type: element.getAttribute('type'), text: element.textContent }));
  assert.equal(rule.type, 'speculationrules');
  assert.deepEqual(JSON.parse(rule.text ?? ''), { prerender: [{ source: 'list', urls: [nativeHref], eagerness: 'immediate' }] });
}

async function expectRemoved(page: Page): Promise<void> {
  await page.waitForFunction((selector) => document.querySelector(selector) === null, {}, ruleSelector);
}

async function togglePreference(popup: Page, page: Page, key: 'prepareAssignmentCenter' | 'enabled'): Promise<void> {
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
  await popup.waitForSelector(`#${key}:not(:disabled)`);
  await popup.$eval(`#${key}`, (element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Expected a preference checkbox.');
    element.click();
  });
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
}

test('compiled Chrome warmup follows moved Schedule sources and removes its rule on switch changes', { timeout: 60_000 }, async (t) => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-warmup-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    const executable = await ensureDevelopmentBrowser(developmentPaths(root).cache);
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), executable);
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#enabled:not(:disabled)');
    const enableWarmup = async () => {
      await popup.evaluate(async (features) => {
        const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
        await api.storage.sync.set({ enabled: true, ...Object.fromEntries(features.map((key) => [key, key === 'prepareAssignmentCenter'])) });
      }, FEATURE_DEFINITIONS.map(({ key }) => key));
    };
    const activeBrowser = browser;

    await t.test('moving an initially hidden Schedule wrapper into view starts preparation and switches clean up', async () => {
      await enableWarmup();
      const page = await syntheticPage(activeBrowser, true);
      try {
        await setTimeout(750);
        assert.equal(await page.$(ruleSelector), null);
        await page.click('#show-source');
        await expectPrepared(page);
        assert.equal(await page.$eval('#assignment-center-btn', (element) => element.getAttribute('href')), nativeHref);
        assert.equal(page.url(), sourceUrl);
        await togglePreference(popup, page, 'prepareAssignmentCenter');
        await expectRemoved(page);
        assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
        await page.click('#hide-source');
        await page.click('#show-source');
        await setTimeout(750);
        assert.equal(await page.$(ruleSelector), null);
        await togglePreference(popup, page, 'prepareAssignmentCenter');
        await expectPrepared(page);
        await togglePreference(popup, page, 'enabled');
        await expectRemoved(page);
        assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
        await page.click('#hide-source');
        await page.click('#show-source');
        await setTimeout(750);
        assert.equal(await page.$(ruleSelector), null);
        await togglePreference(popup, page, 'enabled');
        await expectPrepared(page);
      } finally { await page.close(); }
    });

    await t.test('moving an active Schedule wrapper into a hidden container cancels its only attempt', async () => {
      await enableWarmup();
      const page = await syntheticPage(activeBrowser, false);
      try {
        await expectPrepared(page);
        await page.click('#hide-source');
        await expectRemoved(page);
        await page.click('#show-source');
        await setTimeout(750);
        assert.equal(await page.$(ruleSelector), null);
        assert.equal(await page.$eval('#assignment-center-btn', (element) => element.getAttribute('href')), nativeHref);
        assert.equal(page.url(), sourceUrl);
      } finally { await page.close(); }
    });
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
