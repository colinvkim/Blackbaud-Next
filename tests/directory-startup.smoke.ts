import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';
import { buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://directory-startup-fixture.myschoolapp.com';
const directoryUrl = `${origin}/app/student?svcid=edu#directory/438`;

const nativeFixture = `<!doctype html><html><head><meta charset="utf-8"><title>Directory fixture</title></head><body>
  <main id="site-main"></main><button id="progress" type="button">Go to Progress</button>
  <script>
    const state = window.fixtureState = { started: false, nativeStarts: 0, metadataReads: 0, metadataCompletions: 0, aborts: 0 };
    const main = document.getElementById('site-main');
    class View {
      constructor() { this.el = document.createElement('section'); }
      remove() { this.el.remove(); }
      off() {}
    }
    class DirectoryModel {
      constructor(attributes) { this.attributes = attributes; }
      get(key) { return this.attributes[key]; }
      fetch(options) {
        state.metadataReads++;
        fetch('/native-directory-metadata').then(() => {
          state.metadataCompletions++;
          options.success();
        }, () => options.error());
        return { abort() { state.aborts++; } };
      }
    }
    const directory = {
      Data: { directoryId: null, searchVal: '', searchFacets: [], searchRun: false, viewType: -1 },
      Ms: { Directory: DirectoryModel }, Vs: { Directory: View },
      Us: { renderDirectory(id) {
        state.nativeStarts++;
        const model = new DirectoryModel({ DirectoryId: id });
        model.fetch({ data: { directoryId: id }, success() {
          const view = new View();
          view.template = 'directory/directory.template.html';
          view.model = model;
          view.el.id = 'native-directory';
          view.el.textContent = 'Original native directory';
          app.renderMainPage(view);
        }, error() {} });
      } },
    };
    const app = window.p3 = {
      _currentMainView: false,
      _modules: { 'shared/directory': directory },
      Layout: { Containers: { MainPage: { 0: main } } },
      Data: { Context: { get(key) { return key === 'Directories' ? [{ DirectoryID: 438, DirectoryName: 'Students' }] : undefined; } } },
      Config: {},
      renderMainPage(view) {
        const previous = this._currentMainView;
        if (previous) { previous.Page?.dispose(); previous.remove(); previous.off(); previous.dispose?.(); }
        main.replaceChildren();
        if (view.render) view.render(); else main.append(view.el);
        this._currentMainView = view;
      },
    };
    window.Bb = { View };
    document.getElementById('progress').addEventListener('click', () => {
      location.hash = '#studentmyday/progress';
      const view = new View();
      view.el.id = 'native-progress';
      view.el.textContent = 'Original native Progress';
      app.renderMainPage(view);
    });
    setTimeout(() => { state.started = true; directory.Us.renderDirectory('438'); }, 300);
  </script>
  <script src="/hold-parser.js"></script></body></html>`;

async function syntheticDirectory(browser: Browser, holdMetadata = false) {
  const page = await browser.newPage();
  page.setDefaultTimeout(3_000);
  let receiveParser!: (request: HTTPRequest) => void;
  let receiveMetadata!: (request: HTTPRequest) => void;
  const parser = new Promise<HTTPRequest>((resolve) => { receiveParser = resolve; });
  const metadata = new Promise<HTTPRequest>((resolve) => { receiveMetadata = resolve; });
  const reads: string[] = [];
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    const url = new URL(request.url());
    if (url.pathname === '/hold-parser.js') { receiveParser(request); return; }
    if (url.pathname === '/native-directory-metadata' && holdMetadata) { receiveMetadata(request); return; }
    if (url.pathname.startsWith('/api/directory/')) reads.push(url.pathname);
    const body = url.pathname === '/api/directory/directoryget'
      ? { DirectoryID: 438, DirectoryName: 'Students', DefaultResults: true }
      : url.pathname === '/api/directory/directoryresultsget'
        ? [{ UserID: 41, FirstName: 'Alex', LastName: 'Example', PublishUserProfile: true, PublishEmail: false, TotalCount: 1 }]
        : {};
    void request.respond(url.pathname === '/app/student'
      ? { status: 200, contentType: 'text/html', body: nativeFixture }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const navigation = page.goto(directoryUrl, { waitUntil: 'domcontentloaded' }).then(() => null, (error: unknown) => error);
  await parser;
  await page.waitForFunction(() => Reflect.get(window, 'fixtureState')?.started === true);
  return { page, navigation, reads, parser: await parser, metadata };
}

async function expectEarlyShell(page: Page): Promise<void> {
  assert.deepEqual(await page.evaluate(() => ({
    ready: document.readyState,
    heading: document.querySelector('#site-main h1')?.textContent,
    pending: document.querySelector('#site-main [role="status"] p')?.textContent,
    favicon: document.querySelector('[data-blackbaud-next-favicon]') !== null,
    state: Reflect.get(window, 'fixtureState'),
  })), {
    ready: 'loading', heading: 'Students', pending: 'Loading directory…', favicon: false,
    state: { started: true, nativeStarts: 0, metadataReads: 0, metadataCompletions: 0, aborts: 0 },
  });
}

test('compiled Chrome catches the initial directory route before DOM readiness and keeps pending fallback native', { timeout: 30_000 }, async (t) => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-directory-startup-'));
  let browser: Browser | undefined;
  try {
    for (const name of ['src', 'assets', 'extension']) await cp(resolve(root, name), resolve(fixture, name), { recursive: true });
    await mkdir(resolve(fixture, 'scripts'));
    await cp(resolve(root, 'scripts/build.ts'), resolve(fixture, 'scripts/build.ts'));
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
    await buildDevelopmentExtension(fixture, new AbortController().signal);
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#enabled:not(:disabled)');
    await popup.evaluate(async (features) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ enabled: true, ...Object.fromEntries(features.map((key) => [key, key === 'enhancedDirectory' || key === 'fixFavicon'])) });
    }, FEATURE_DEFINITIONS.map(({ key }) => key));
    const activeBrowser = browser;

    await t.test('the initial shell becomes one people read when the document finishes', async () => {
      const frame = await syntheticDirectory(activeBrowser);
      try {
        await expectEarlyShell(frame.page);
        assert.deepEqual(frame.reads, [], 'Parser-dependent directory tools have not started their reads');
        await frame.parser.respond({ status: 200, contentType: 'text/javascript', body: '' });
        assert.equal(await frame.navigation, null);
        await frame.page.waitForSelector('.bn-directory-row');
        await frame.page.waitForSelector('[data-blackbaud-next-favicon]');
        assert.match(await frame.page.$eval('.bn-directory-row', (row) => row.textContent ?? ''), /Alex Example/);
        assert.deepEqual(frame.reads.sort(), ['/api/directory/directoryget', '/api/directory/directoryresultsget']);
        assert.equal(await frame.page.evaluate(() => Reflect.get(window, 'fixtureState').nativeStarts), 0);
      } finally { await frame.page.close(); }
    });

    await t.test('pending original fallback cannot overwrite a later native route', async () => {
      const frame = await syntheticDirectory(activeBrowser, true);
      try {
        await expectEarlyShell(frame.page);
        await frame.page.click('#site-main button');
        const metadata = await frame.metadata;
        await frame.page.click('#progress');
        await frame.page.waitForSelector('#native-progress');
        await metadata.respond({ status: 200, contentType: 'application/json', body: '{}' });
        await frame.page.waitForFunction(() => Reflect.get(window, 'fixtureState').metadataCompletions === 1);
        assert.equal(await frame.page.$eval('#site-main', (main) => main.textContent), 'Original native Progress');
        assert.equal(await frame.page.$('#native-directory'), null);
        assert.deepEqual(await frame.page.evaluate(() => Reflect.get(window, 'fixtureState')), {
          started: true, nativeStarts: 1, metadataReads: 1, metadataCompletions: 1, aborts: 1,
        });
        await frame.parser.respond({ status: 200, contentType: 'text/javascript', body: '' });
        assert.equal(await frame.navigation, null);
        await frame.page.waitForSelector('[data-blackbaud-next-favicon]');
        assert.deepEqual(frame.reads, []);
      } finally { await frame.page.close(); }
    });
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
