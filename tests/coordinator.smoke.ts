import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer-core';
import { parseAuthContext } from '../src/blackbaud/auth.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const googleUrl = 'https://accounts.google.com/signin?redirect_uri=https%3A%2F%2Fid.blackbaud.com%2Fcallback';
const schoolUrl = 'https://polytechnic.myschoolapp.com/app#login';

async function accountPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    // Every external request is intercepted; the school prepares a real flow in this tab.
    const url = new URL(request.url());
    if (!request.isNavigationRequest()) { void request.respond({ status: 204 }); return; }
    const body = url.origin === 'https://polytechnic.myschoolapp.com'
      ? '<!doctype html><title>School login fixture</title><input id="nextBtn" type="button" value="Next">'
      : `<!doctype html><title>Account fixture</title>
        <button data-email="student@students.polytechnic.org">School account</button>
        <script>document.querySelector('button').onclick = () => {
          document.documentElement.dataset.clicks = String(Number(document.documentElement.dataset.clicks || 0) + 1);
        };</script>`;
    void request.respond({ status: 200, contentType: 'text/html', body });
  });
  return page;
}

async function storedFlows(popup: Page) {
  const values = await popup.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
    return api.storage.session.get(null);
  });
  return Object.values(values).map((value) => parseAuthContext(value)).filter((value) => value !== null);
}

test('real Chrome preserves popup saves, per-tab auth attempts and worker restart state', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-coordinator-browser-'));
  let browser: Browser | undefined;
  try {
    for (const name of ['src', 'assets', 'extension']) await cp(resolve(root, name), resolve(fixture, name), { recursive: true });
    await mkdir(resolve(fixture, 'scripts'));
    await cp(resolve(root, 'scripts/build.ts'), resolve(fixture, 'scripts/build.ts'));
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
    await buildDevelopmentExtension(fixture, new AbortController().signal);
    const executable = await ensureDevelopmentBrowser(developmentPaths(root).cache);
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), executable);
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popupUrl = `chrome-extension://${id}/popup.html`;
    let popup = await browser.newPage();
    await popup.goto(popupUrl);
    await popup.waitForSelector('#enabled:not(:disabled)');
    await popup.evaluate(() => {
      for (const key of ['rosterTools', 'resourceSearch', 'pageAppearance']) (document.getElementById(key) as HTMLInputElement).click();
    });
    await popup.close();
    popup = await browser.newPage();
    await popup.goto(popupUrl);
    await popup.waitForFunction(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      const values = await api.storage.sync.get(null);
      return values.rosterTools === false && values.resourceSearch === false && values.pageAppearance === false;
    });
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ accountPreference: 'student@students.polytechnic.org', loadingOverlay: false });
    });
    const firstPage = await accountPage(browser);
    const secondPage = await accountPage(browser);
    const pages = [firstPage, secondPage];
    await Promise.all(pages.map(async (page) => {
      await page.goto(schoolUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bn-login-option button:not(:disabled)');
    }));
    const prepared = await storedFlows(popup);
    assert.equal(prepared.length, 2);
    assert.equal(new Set(prepared.map((flow) => flow.id)).size, 2);
    for (const flow of prepared) assert.equal(flow.googleAttempts, 0);
    await Promise.all(pages.map((page) => page.goto(googleUrl, { waitUntil: 'domcontentloaded' })));
    await Promise.all(pages.map((page) => page.waitForFunction(() => Number(document.documentElement.dataset.clicks ?? 0) === 1, { polling: 'mutation' })));
    const claimsBeforeRestart = await storedFlows(popup);
    assert.equal(claimsBeforeRestart.length, 2);
    assert.deepEqual(claimsBeforeRestart.map((flow) => flow.id).sort(), prepared.map((flow) => flow.id).sort());
    for (const flow of claimsBeforeRestart) {
      assert.equal(flow.googleAttempts, 1);
      assert.ok(flow.googleClaim);
    }
    const workerTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${id}/`));
    const worker = await workerTarget.worker();
    assert.ok(worker);
    await worker.close();
    await firstPage.reload({ waitUntil: 'domcontentloaded' });
    // A message from the activated content script wakes a fresh worker. Inspect
    // that worker's persisted state rather than relying on a sleep or old globals.
    const restartedTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${id}/`));
    const restartedWorker = await restartedTarget.worker();
    assert.ok(restartedWorker);
    await restartedWorker.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.session.get(null);
    });
    await firstPage.bringToFront();
    await firstPage.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    assert.equal(await firstPage.evaluate(() => Number(document.documentElement.dataset.clicks ?? 0)), 0);
    assert.equal(await secondPage.evaluate(() => Number(document.documentElement.dataset.clicks ?? 0)), 1);
    const stored = await storedFlows(popup);
    assert.deepEqual(stored.sort((a, b) => a.id.localeCompare(b.id)), claimsBeforeRestart.sort((a, b) => a.id.localeCompare(b.id)));
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
