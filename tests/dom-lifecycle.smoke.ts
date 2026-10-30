import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://dom-fixture.myschoolapp.com';
const source = origin + '/app/student#resourceboard';
const nativeFixture = `<!doctype html><html><head><title>Native resources</title><style>
  .board-container { display: flex; } .boxTopic { width: 240px; }
</style></head><body><main id="site-main">
  <button id="progress">Progress</button><button id="resources">Resources</button>
  <div id="board-container"><div class="board-container isotope" style="--blackbaud-next-resource-column-width:180px!important">
    <article id="alpha" class="container-container boxTopic isotope-item"><a href="#alpha">Alpha resource</a></article>
    <article id="beta" class="container-container boxTopic isotope-item"><a href="#beta">Beta resource</a></article>
  </div></div>
</main><script>
  document.querySelector('#progress').onclick = () => history.pushState({}, '', '#studentmyday/progress');
  document.querySelector('#resources').onclick = () => history.replaceState({}, '', '#resourceboard');
</script></body></html>`;

async function timers(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    document.dispatchEvent(new Event('bn-fixture-read-timers'));
    return JSON.parse(document.documentElement.dataset.testTimers ?? '[]');
  });
}

test('compiled resource UI, stylesheet persistence and shared URL lifecycle work in Chrome', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-dom-browser-'));
  let browser: Browser | undefined;
  try {
    const extension = developmentPaths(fixture).extension;
    await cp(resolve(root, 'chrome'), extension, { recursive: true });
    const manifestPath = resolve(extension, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.content_scripts[0].js.unshift('timers.js');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(resolve(extension, 'timers.js'), `
      const intervals = new Map();
      const startInterval = window.setInterval.bind(window);
      const stopInterval = window.clearInterval.bind(window);
      window.setInterval = (handler, delay, ...args) => {
        const id = startInterval(handler, delay, ...args);
        intervals.set(id, delay);
        return id;
      };
      window.clearInterval = (id) => { intervals.delete(id); stopInterval(id); };
      document.addEventListener('bn-fixture-read-timers', () => {
        document.documentElement.dataset.testTimers = JSON.stringify([...intervals.values()]);
      });
    `);
    const executable = await ensureDevelopmentBrowser(developmentPaths(root).cache);
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), executable);
    const id = await browser.installExtension(extension);
    const popup = await browser.newPage();
    popup.setDefaultTimeout(5_000);
    await popup.goto('chrome-extension://' + id + '/popup.html');
    await popup.waitForSelector('#enabled:not(:disabled)');
    await popup.evaluate(async (keys) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({
        enabled: true,
        ...Object.fromEntries(keys.map((key) => [key, ['resourceSearch', 'helpfulTabTitles', 'pageAppearance', 'enhancedDirectory'].includes(key)])),
      });
    }, FEATURE_DEFINITIONS.map(({ key }) => key));
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      void request.respond(request.url().startsWith(origin + '/app/student')
        ? { status: 200, contentType: 'text/html', body: nativeFixture }
        : { status: 404, contentType: 'application/json', body: '{}' });
    });
    const toggle = async (key: string) => {
      await popup.bringToFront();
      await popup.waitForSelector(`#${key}:not(:disabled)`);
      await popup.click(`#${key}`);
      await page.bringToFront();
    };
    await page.goto(source, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bn-resource-search');
    assert.equal((await timers(page)).filter((delay) => delay === 2_000).length, 1);
    assert.equal((await timers(page)).includes(300), false);
    await page.type('.bn-resource-search input', 'Alpha');
    await page.waitForFunction(() => document.querySelector('.bn-resource-search [role="status"]')?.textContent === '1 of 2 resources');
    assert.equal(await page.$eval('#beta', (element) => getComputedStyle(element).visibility), 'hidden');
    await page.evaluate(() => {
      const foreign = new CSSStyleSheet();
      foreign.replaceSync(':root { --fixture-foreign: retained; }');
      document.adoptedStyleSheets.push(foreign);
      document.head.replaceChildren();
    });
    assert.equal(await page.$eval('#beta', (element) => getComputedStyle(element).visibility), 'hidden');
    assert.equal(await page.$eval('.bn-resource-search', (element) => getComputedStyle(element).color), 'rgb(34, 42, 53)');
    await page.click('#progress');
    await page.waitForFunction(() => document.title === 'Progress — Blackbaud');
    await page.waitForFunction(() => !document.querySelector('.bn-resource-search'));
    assert.equal(await page.$eval('#beta', (element) => element.hasAttribute('data-blackbaud-next-resource-hidden')), false);
    assert.equal(await page.$eval('.board-container', (element) => element.getAttribute('style')), '--blackbaud-next-resource-column-width: 180px !important;');
    await page.goBack();
    await page.waitForSelector('.bn-resource-search');
    await page.goForward();
    await page.waitForFunction(() => !document.querySelector('.bn-resource-search'));
    await page.click('#resources');
    await page.waitForSelector('.bn-resource-search');
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.$eval('.bn-resource-search input', (element) => element.getBoundingClientRect().height >= 44), true);
    await toggle('resourceSearch');
    await page.waitForFunction(() => !document.querySelector('.bn-resource-search'));
    await toggle('resourceSearch');
    await page.waitForSelector('.bn-resource-search');
    await toggle('enabled');
    await page.waitForFunction(() => !document.querySelector('.bn-resource-search') &&
      !getComputedStyle(document.documentElement).getPropertyValue('--bn-accent'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fixture-foreign').trim()), 'retained');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    assert.deepEqual(await timers(page), []);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => {
      document.dispatchEvent(new Event('bn-fixture-read-timers'));
      return JSON.parse(document.documentElement.dataset.testTimers ?? '[]').includes(2_000);
    });
    assert.equal((await timers(page)).filter((delay) => delay === 2_000).length, 1);
    await toggle('enabled');
    await page.waitForSelector('.bn-resource-search');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bn-resource-search');
    assert.equal((await timers(page)).filter((delay) => delay === 2_000).length, 1);
  } finally {
    await browser?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
