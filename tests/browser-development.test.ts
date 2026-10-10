import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Browser, Page } from 'puppeteer-core';
import {
  parseDevelopmentOptions,
  publishDevelopmentBuild,
  reloadDevelopmentExtension,
  shouldRefreshDevelopmentPage,
} from '../scripts/browser-development.ts';

const school = 'https://fixture.myschoolapp.com/app#student';
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function browserFixture(install: (path: string) => Promise<string>, pages: () => Promise<Page[]>): Browser {
  return {
    installExtension: install,
    pages,
    uninstallExtension: async () => { assert.fail('Reload must preserve the installed extension and its preferences'); },
    newPage: async () => { assert.fail('Reload must not create tabs'); },
  } as unknown as Browser;
}

function pageFixture(url: string, reload: () => Promise<void>): Page {
  return { url: () => url, reload } as unknown as Page;
}

test('a failed build promotion restores the complete previous extension', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'blackbaud-development-publish-'));
  const extension = resolve(root, 'extension');
  const previous = resolve(root, 'previous');
  try {
    await mkdir(resolve(extension, 'dist'), { recursive: true });
    await writeFile(resolve(extension, 'manifest.json'), 'working manifest');
    await writeFile(resolve(extension, 'dist/lms.js'), 'working script');
    await assert.rejects(publishDevelopmentBuild(resolve(root, 'missing-staging'), extension, previous), { code: 'ENOENT' });
    assert.equal(await readFile(resolve(extension, 'manifest.json'), 'utf8'), 'working manifest');
    assert.equal(await readFile(resolve(extension, 'dist/lms.js'), 'utf8'), 'working script');
    await assert.rejects(readdir(previous), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('publishing a new build replaces nested assets and removes files absent from the build', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'blackbaud-development-publish-'));
  const extension = resolve(root, 'extension');
  const staging = resolve(root, 'staging');
  const previous = resolve(root, 'previous');
  try {
    await mkdir(resolve(extension, 'assets'), { recursive: true });
    await writeFile(resolve(extension, 'assets/removed.png'), 'obsolete asset');
    await writeFile(resolve(extension, 'manifest.json'), 'old manifest');
    await mkdir(resolve(staging, 'dist/popup'), { recursive: true });
    await writeFile(resolve(staging, 'manifest.json'), 'new manifest');
    await writeFile(resolve(staging, 'dist/popup/index.html'), 'new popup');
    await publishDevelopmentBuild(staging, extension, previous);
    assert.equal(await readFile(resolve(extension, 'manifest.json'), 'utf8'), 'new manifest');
    assert.equal(await readFile(resolve(extension, 'dist/popup/index.html'), 'utf8'), 'new popup');
    await assert.rejects(readFile(resolve(extension, 'assets/removed.png')), { code: 'ENOENT' });
    await assert.rejects(readdir(staging), { code: 'ENOENT' });
    await assert.rejects(readdir(previous), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the first build can be published before any extension exists', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'blackbaud-development-publish-'));
  try {
    const staging = resolve(root, 'staging');
    await mkdir(staging);
    await writeFile(resolve(staging, 'manifest.json'), 'first manifest');
    await publishDevelopmentBuild(staging, resolve(root, 'extension'), resolve(root, 'previous'));
    assert.equal(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'), 'first manifest');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('development defaults isolate browser state, while custom schools and relative paths remain configurable', () => {
  const root = resolve(tmpdir(), 'blackbaud-options');
  const defaults = parseDevelopmentOptions([], root);
  assert.equal(defaults.url, 'https://polytechnic.myschoolapp.com/');
  assert.equal(defaults.profile, resolve(root, '.local/dev-browser/profile'));
  assert.equal(defaults.executable, undefined);
  assert.equal(defaults.headless, false);
  const custom = parseDevelopmentOptions([
    '--url', 'https://another.myschoolapp.com/app#directory/42',
    '--profile', 'custom-profile', '--executable', 'tools/chrome', '--headless',
  ], root);
  assert.equal(custom.url, 'https://another.myschoolapp.com/app#directory/42');
  assert.equal(custom.profile, resolve(root, 'custom-profile'));
  assert.equal(custom.executable, resolve(root, 'tools/chrome'));
  assert.equal(custom.headless, true);
  assert.equal(parseDevelopmentOptions(['--url', 'http://localhost:3000'], root).url, 'http://localhost:3000/');
  assert.equal(parseDevelopmentOptions(['-h'], root).help, true);
});

test('development options reject embedded credentials, non-web URLs, malformed URLs, and unknown switches', () => {
  for (const url of ['https://user:password@fixture.myschoolapp.com', 'https://user@fixture.myschoolapp.com',
    'file:///tmp/school.html', 'javascript:alert(1)', 'chrome://extensions', 'not a URL']) {
    assert.throws(() => parseDevelopmentOptions(['--url', url], tmpdir()), Error, url);
  }
  assert.throws(() => parseDevelopmentOptions(['--unknown'], tmpdir()));
});

test('refresh scope includes only the configured school origin and the installed extension', () => {
  for (const url of [school, 'https://fixture.myschoolapp.com/signin',
    'https://fixture.myschoolapp.com/lms-assignment/assignment-center', `chrome-extension://${extensionId}/popup.html`]) {
    assert.equal(shouldRefreshDevelopmentPage(url, school, extensionId), true, url);
  }
  for (const url of ['https://accounts.google.com/signin', 'https://another.myschoolapp.com/app',
    'https://fixture.myschoolapp.com.attacker.example/app', 'https://sub.fixture.myschoolapp.com/app',
    'http://fixture.myschoolapp.com/app', 'https://fixture.myschoolapp.com:8443/app',
    'https://unrelated.example/', 'chrome://extensions/', 'about:blank', 'invalid URL',
    'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/popup.html', `chrome-extension://${extensionId}.attacker/popup.html`]) {
    assert.equal(shouldRefreshDevelopmentPage(url, school, extensionId), false, url);
  }
});

test('reloading waits for same-path installation before inspecting or refreshing tabs, without uninstalling', async () => {
  const installed = deferred<string>();
  const calls: string[] = [];
  const path = resolve(tmpdir(), 'blackbaud-development-extension');
  let installs = 0;
  const browser = browserFixture(async (extensionPath) => {
    assert.equal(extensionPath, path);
    calls.push('install');
    return ++installs === 1 ? installed.promise : extensionId;
  }, async () => {
    calls.push('pages');
    return [pageFixture(school, async () => { calls.push('refresh'); })];
  });
  const signal = new AbortController().signal;
  const initial = reloadDevelopmentExtension(browser, path, school, signal);
  assert.deepEqual(calls, ['install']);
  installed.resolve(extensionId);
  assert.deepEqual(await initial, { id: extensionId, refreshed: 1 });
  assert.deepEqual(await reloadDevelopmentExtension(browser, path, school, signal), { id: extensionId, refreshed: 1 });
  assert.deepEqual(calls, ['install', 'pages', 'refresh', 'install', 'pages', 'refresh']);
});

test('installation failure leaves all tabs untouched', async () => {
  const failure = new Error('Extension build rejected by Chrome');
  const browser = browserFixture(async () => { throw failure; }, async () => {
    assert.fail('Tabs must not refresh after a failed installation');
  });
  await assert.rejects(reloadDevelopmentExtension(browser, '/fixture/extension', school, new AbortController().signal), failure);
});

test('shutdown before or during installation prevents all tab work', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(reloadDevelopmentExtension(browserFixture(async () => {
    assert.fail('An aborted reload must not begin installation');
  }, async () => { assert.fail('An aborted reload must not inspect tabs'); }), '/fixture/extension', school, alreadyAborted.signal), { name: 'AbortError' });

  const installing = deferred<string>();
  const controller = new AbortController();
  const browser = browserFixture(async () => installing.promise, async () => {
    assert.fail('Shutdown during installation must prevent subsequent tab work');
  });
  const result = assert.rejects(reloadDevelopmentExtension(browser, '/fixture/extension', school, controller.signal), { name: 'AbortError' });
  controller.abort();
  installing.resolve(extensionId);
  await result;
});

test('a failed school tab refresh does not block other eligible tabs or refresh authentication tabs', async () => {
  const refreshed: string[] = [];
  const warnings: string[] = [];
  const browser = browserFixture(async () => extensionId, async () => [
    pageFixture('https://accounts.google.com/signin', async () => { assert.fail('Google must not refresh'); }),
    pageFixture(school, async () => { throw new Error('Tab closed during refresh'); }),
    pageFixture('https://fixture.myschoolapp.com/app#schedule', async () => { refreshed.push('schedule'); }),
    pageFixture(`chrome-extension://${extensionId}/popup.html`, async () => { refreshed.push('popup'); }),
    pageFixture('chrome://extensions', async () => { assert.fail('Extension manager must not refresh'); }),
  ]);
  const result = await reloadDevelopmentExtension(browser, '/fixture/extension', school, new AbortController().signal, (warning) => warnings.push(warning));
  assert.deepEqual(result, { id: extensionId, refreshed: 2 });
  assert.deepEqual(refreshed, ['schedule', 'popup']);
  assert.equal(warnings.length, 1);
});

test('shutdown during a tab refresh stops later tabs without reporting an ordinary refresh failure', async () => {
  const controller = new AbortController();
  const warnings: string[] = [];
  const browser = browserFixture(async () => extensionId, async () => [
    pageFixture(school, async () => { controller.abort(); throw controller.signal.reason; }),
    pageFixture(school, async () => { assert.fail('Shutdown must stop the refresh loop'); }),
  ]);
  const result = await reloadDevelopmentExtension(browser, '/fixture/extension', school, controller.signal, (warning) => warnings.push(warning));
  assert.deepEqual(result, { id: extensionId, refreshed: 0 });
  assert.deepEqual(warnings, []);
});
