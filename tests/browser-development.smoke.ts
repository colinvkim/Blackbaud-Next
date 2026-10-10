import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BuildQueue, watchProjectSources } from '../scripts/browser-build.ts';
import {
  buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser,
  launchDevelopmentBrowser, parseDevelopmentOptions, reloadDevelopmentExtension,
} from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function waitFor(predicate: () => boolean): Promise<void> {
  await new Promise<void>((done, reject) => {
    const deadline = setTimeout(() => { clearInterval(poll); reject(new Error('Browser build did not complete.')); }, 30_000);
    const poll = setInterval(() => { if (predicate()) { clearInterval(poll); clearTimeout(deadline); done(); } }, 25);
  });
}

test('real Chrome loads, rebuilds, reloads, retains settings, and recovers from a failed build', { timeout: 120_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-next-browser-'));
  let stopWatching: (() => void) | undefined;
  let queue: BuildQueue | undefined;
  let browser: Awaited<ReturnType<typeof launchDevelopmentBrowser>> | undefined;
  try {
    for (const name of ['src', 'assets', 'extension']) await cp(resolve(root, name), resolve(fixture, name), { recursive: true });
    await mkdir(resolve(fixture, 'scripts'));
    for (const name of ['build.ts', 'browser-build.ts', 'browser-development.ts', 'dev-browser.ts']) {
      await cp(resolve(root, 'scripts', name), resolve(fixture, 'scripts', name));
    }
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
    const url = 'https://dev-fixture.myschoolapp.com/app/student#studentmyday/progress';
    const options = parseDevelopmentOptions(['--headless', '--url', url], fixture);
    const executable = await ensureDevelopmentBrowser(developmentPaths(root).cache);
    browser = await launchDevelopmentBrowser(options, executable);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      // All web traffic is synthetic, including subresources: no real school or Google requests.
      void request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Fixture</title></head><body><main id="site-main"><h1>Browser fixture</h1></main></body></html>' });
    });
    const untouched = await browser.newPage();
    await untouched.evaluate(() => { document.documentElement.dataset.untouched = 'true'; });
    let extensionId = '';
    let failures = 0;
    const ids: string[] = [];
    queue = new BuildQueue({
      build: (signal) => buildDevelopmentExtension(fixture, signal),
      async onSuccess(signal) {
        const result = await reloadDevelopmentExtension(browser!, developmentPaths(fixture).extension, url, signal);
        extensionId = result.id;
        ids.push(result.id);
      },
      onError: () => { failures++; },
    });
    await queue.buildNow();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#blackbaud-next-tools');
    let popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('#enabled:not(:disabled)');
    await popup.evaluate(async () => {
      const chrome = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await chrome.storage.sync.set({ fixFavicon: false });
    });
    await page.waitForFunction(() => !document.querySelector('[data-blackbaud-next-favicon]'));
    stopWatching = watchProjectSources(fixture, () => queue!.requestBuild());
    const entry = resolve(fixture, 'src/entrypoints/lms.ts');
    const original = await readFile(entry, 'utf8');
    await writeFile(entry, `${original}\ndocument.documentElement.dataset.browserBuild = 'two';\n`);
    await page.waitForFunction(() => document.documentElement.dataset.browserBuild === 'two', { timeout: 30_000 });
    await queue.idle();
    assert.equal(await untouched.evaluate(() => document.documentElement.dataset.untouched), 'true');
    // Chrome closes extension pages during a reload; reopen the real popup to inspect storage.
    popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    assert.equal(await popup.evaluate(async () => {
      const chrome = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      return (await chrome.storage.sync.get('fixFavicon')).fixFavicon;
    }), false);

    // Copied popup HTML must participate in the full build, not only imported TS/CSS.
    const htmlPath = resolve(fixture, 'src/popup/index.html');
    const html = await readFile(htmlPath, 'utf8');
    const beforeHtmlBuild = ids.length;
    await writeFile(htmlPath, html.replace('<title>Blackbaud Next</title>', '<title>Rebuilt popup</title>'));
    await waitFor(() => ids.length > beforeHtmlBuild);
    await queue.idle();
    popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    assert.equal(await popup.title(), 'Rebuilt popup');

    const published = resolve(developmentPaths(fixture).extension, 'dist/lms.js');
    const lastGood = await readFile(published, 'utf8');
    await writeFile(entry, 'export const = ;');
    await waitFor(() => failures > 0);
    await queue.idle();
    assert.equal(await readFile(published, 'utf8'), lastGood, 'failed compilation preserves complete published files');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.browserBuild), 'two');
    await writeFile(entry, `${original}\ndocument.documentElement.dataset.browserBuild = 'three';\n`);
    await page.waitForFunction(() => document.documentElement.dataset.browserBuild === 'three', { timeout: 30_000 });
    await queue.idle();
    assert.ok(ids.length >= 4);
    assert.ok(ids.every((id) => id === extensionId), 'reload keeps the extension identity and preferences');
    stopWatching();
    await queue.dispose();
    await browser.close();

    // Exercise the actual command's startup and Ctrl+C path, not only its reusable helpers.
    const server = createServer((_request, response) => { response.end('<!doctype html><title>Local command fixture</title>'); });
    await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
    const port = (server.address() as AddressInfo).port;
    const child = spawn(process.execPath, [resolve(fixture, 'scripts/dev-browser.ts'),
      '--headless', '--url', `http://127.0.0.1:${port}`, '--executable', executable], { cwd: fixture });
    let output = '';
    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    const exited = new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => done(code));
    });
    try {
      await waitFor(() => output.includes('Development browser ready.') || child.exitCode !== null);
      assert.match(output, /Development browser ready\./);
      child.kill('SIGINT');
      assert.equal(await exited, 0, output);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await new Promise<void>((done) => { server.close(() => done()); });
    }
    console.log('Verified rebuild/reload, retained settings, failed-build recovery, command startup, and Ctrl+C shutdown.');
  } finally {
    stopWatching?.();
    const disposed = queue?.dispose();
    await browser?.close();
    await disposed;
    await rm(fixture, { recursive: true, force: true });
  }
});
