import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer-core';
import { createAuthContext, AUTH_CONTEXT_PREFIX } from '../src/blackbaud/auth.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const googleUrl = 'https://accounts.google.com/signin?redirect_uri=https%3A%2F%2Fid.blackbaud.com%2Fcallback';

async function accountPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    // Every request is intercepted; these tests never contact Google or a school.
    void request.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Account fixture</title>
      <button data-email="student@students.polytechnic.org">School account</button>
      <script>document.querySelector('button').onclick = () => {
        document.documentElement.dataset.clicks = String(Number(document.documentElement.dataset.clicks || 0) + 1);
      };</script>` });
  });
  return page;
}

test('real Chrome preserves popup saves, exclusive auth attempts and worker restart state', { timeout: 90_000 }, async () => {
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
    const flow = createAuthContext('polytechnic.myschoolapp.com', 'concurrent-browser-flow');
    const key = `${AUTH_CONTEXT_PREFIX}${flow.id}`;
    await popup.evaluate(async (key, flow) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ accountPreference: 'student@students.polytechnic.org', loadingOverlay: false });
      await api.storage.local.set({ [key]: flow });
    }, key, flow);
    const pages = await Promise.all([accountPage(browser), accountPage(browser)]);
    await Promise.all(pages.map((page) => page.goto(googleUrl, { waitUntil: 'domcontentloaded' })));
    let clicks = 0;
    const deadline = Date.now() + 10_000;
    while (!clicks && Date.now() < deadline) {
      clicks = (await Promise.all(pages.map((page) => page.evaluate(() => Number(document.documentElement.dataset.clicks ?? 0))))).reduce((sum, value) => sum + value, 0);
      if (!clicks) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(clicks, 1);
    await popup.waitForFunction(async (key) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      return (await api.storage.local.get(key))[key] !== undefined;
    }, {}, key);
    const claimBeforeRestart = await popup.evaluate(async (key) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      return (await api.storage.local.get(key))[key];
    }, key) as typeof flow;
    assert.equal(claimBeforeRestart.googleAttempts, 1);
    assert.ok(claimBeforeRestart.googleClaim);
    const workerTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${id}/`));
    const worker = await workerTarget.worker();
    assert.ok(worker);
    await worker.close();
    const retry = await accountPage(browser);
    await retry.goto(googleUrl, { waitUntil: 'domcontentloaded' });
    // A message from the activated content script wakes a fresh worker. Inspect
    // that worker's persisted state rather than relying on a sleep or old globals.
    await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${id}/`));
    await retry.waitForFunction(() => document.readyState === 'complete');
    const retriedClicks = await retry.evaluate(() => Number(document.documentElement.dataset.clicks ?? 0));
    assert.equal(retriedClicks, 0);
    assert.equal((await Promise.all(pages.map((page) => page.evaluate(() => Number(document.documentElement.dataset.clicks ?? 0))))).reduce((sum, value) => sum + value, 0), 1);
    const stored = await popup.evaluate(async (key) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      return (await api.storage.local.get(key))[key];
    }, key) as typeof flow;
    assert.equal(stored.googleAttempts, 1);
    assert.equal(stored.googleClaim, claimBeforeRestart.googleClaim);
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
