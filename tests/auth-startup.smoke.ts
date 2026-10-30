import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, HTTPRequest } from 'puppeteer-core';
import { AUTH_CONTEXT_PREFIX, parseAuthContext } from '../src/blackbaud/auth.ts';
import { buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('provider sign-in prepares before DOM readiness and preserves native account selection', { timeout: 30_000 }, async (t) => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-auth-startup-'));
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
    const activeBrowser = browser;

    const cases = [
      { name: 'Blackbaud waits for its native click handler', provider: 'blackbaud', disabledKey: null },
      { name: 'Google keeps a second account added at DOM readiness manual', provider: 'google', disabledKey: null },
      { name: 'master disablement before DOM readiness leaves native sign-in usable', provider: 'blackbaud', disabledKey: 'enabled' },
      { name: 'automatic login disablement before DOM readiness leaves native sign-in usable', provider: 'blackbaud', disabledKey: 'automaticLogin' },
    ] as const;
    for (const { name, provider, disabledKey } of cases) {
      await t.test(name, async () => {
        await popup.evaluate(`(async () => {
          for (const area of [chrome.storage.local, chrome.storage.session]) {
            await area.remove(Object.keys(await area.get(null)).filter(key => key.startsWith(${JSON.stringify(AUTH_CONTEXT_PREFIX)})));
          }
          await chrome.storage.sync.set({ enabled: true, automaticLogin: true, optimizeLoginPage: true, loadingOverlay: true, accountPreference: 'students.polytechnic.org' });
        })()`);
        const page = await activeBrowser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.setDefaultTimeout(2_000);
        await page.setRequestInterception(true);
        const button = provider === 'google'
          ? '<button data-email="student@students.polytechnic.org">First school account</button>'
          : '<button id="google-continue-button">Continue with Google</button>';
        const html = `<!doctype html><html><head><title>Native sign-in</title></head><body>${button}
          <script>
            document.documentElement.dataset.clicks = '0';
            document.documentElement.dataset.earlyClicks = '0';
            document.addEventListener('click', () => {
              if (!document.documentElement.dataset.nativeReady) document.documentElement.dataset.earlyClicks = String(Number(document.documentElement.dataset.earlyClicks) + 1);
            }, true);
            document.addEventListener('DOMContentLoaded', () => {
              if (${provider === 'google'}) {
                const other = document.createElement('button');
                other.dataset.email = 'other@students.polytechnic.org'; other.textContent = 'Second school account';
                document.body.append(other);
              }
              document.documentElement.dataset.nativeReady = 'true';
              document.querySelectorAll('button[data-email], #google-continue-button').forEach(button => button.onclick = () => {
                document.documentElement.dataset.clicks = String(Number(document.documentElement.dataset.clicks) + 1);
              });
            });
          </script><script src="/hold-parser.js"></script></body></html>`;
        page.on('request', (request) => {
          void (async () => {
            if (request.url().startsWith('chrome-extension:')) { await request.continue(); return; }
            const requested = new URL(request.url());
            if (requested.pathname === '/hold-parser.js') return;
            if (request.isNavigationRequest()) {
              const body = requested.hostname === 'polytechnic.myschoolapp.com'
                ? '<!doctype html><title>Synthetic school sign-in</title><input id="nextBtn" type="button" value="Next">'
                : html;
              await request.respond({ status: 200, contentType: 'text/html', body });
            } else if (requested.pathname === '/favicon.ico') {
              await request.respond({ status: 204 });
            } else {
              errors.push(`Unexpected request: ${request.url()}`);
              await request.respond({ status: 404 });
            }
          })().catch((error: unknown) => errors.push(String(error)));
        });
        await page.goto('https://polytechnic.myschoolapp.com/app?svcid=edu#login', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.bn-login-option button');
        const parser = page.waitForRequest((request) => new URL(request.url()).pathname === '/hold-parser.js');
        const url = provider === 'google'
          ? 'https://accounts.google.com/signin?redirect_uri=https%3A%2F%2Fid.blackbaud.com%2Fcallback'
          : 'https://app.blackbaud.com/signin/?redirectUrl=https%3A%2F%2Fpolytechnic.myschoolapp.com%2Fapp%2Fstudent%3Fsvcid%3Dedu';
        const navigation = page.goto(url, { waitUntil: 'domcontentloaded' }).then(() => null, (error: unknown) => error);
        const held = await parser;
        try {
          await page.waitForSelector('#blackbaud-next-signin-status');
          assert.equal(await page.evaluate(() => document.readyState), 'loading');
          assert.equal(await page.evaluate(() => document.documentElement.dataset.earlyClicks), '0');
          if (disabledKey) {
            await popup.evaluate(`chrome.storage.sync.set(${JSON.stringify({ [disabledKey]: false })})`);
            await page.waitForSelector('#blackbaud-next-signin-status', { hidden: true });
          }
          await held.respond({ status: 200, contentType: 'text/javascript', body: '' });
          assert.equal(await navigation, null);
          if (disabledKey) {
            assert.equal(await page.evaluate(() => document.documentElement.dataset.clicks), '0');
            await page.click('#google-continue-button');
          } else if (provider === 'blackbaud') {
            await page.waitForFunction(() => document.documentElement.dataset.clicks === '1');
          } else {
            await page.waitForFunction(() => document.querySelector('#blackbaud-next-signin-status')?.textContent?.includes('one matching school account'));
            assert.equal(await page.evaluate(() => document.documentElement.dataset.clicks), '0');
            await page.click('button[data-email]');
          }
          assert.equal(await page.evaluate(() => document.documentElement.dataset.clicks), '1');
          assert.equal(await page.evaluate(() => document.documentElement.dataset.earlyClicks), '0');
          assert.deepEqual(errors, []);
          const stored: unknown = await popup.evaluate(`Promise.all([
            chrome.storage.local.get(null), chrome.storage.session.get(null)
          ]).then(areas => Object.entries(Object.assign({}, ...areas))
            .filter(([key]) => key.startsWith(${JSON.stringify(AUTH_CONTEXT_PREFIX)})).map(([, value]) => value))`);
          assert.ok(Array.isArray(stored));
          const contexts = stored.map((value: unknown) => parseAuthContext(value)).filter((context) => context !== null);
          assert.equal(contexts.length, 1);
          const flow = contexts[0];
          assert.ok(flow);
          assert.equal(provider === 'google' ? flow.googleAttempts : flow.blackbaudAttempts, !disabledKey && provider === 'blackbaud' ? 1 : 0);
        } finally {
          if (!held.isInterceptResolutionHandled()) await held.respond({ status: 200, contentType: 'text/javascript', body: '' });
          await navigation;
          await page.close();
        }
      });
    }

    await t.test('redirect-only Google completion permits an immediate repeat without clearing another tab', async () => {
      await popup.evaluate(`(async () => {
        for (const area of [chrome.storage.local, chrome.storage.session]) {
          await area.remove(Object.keys(await area.get(null)).filter(key => key.startsWith(${JSON.stringify(AUTH_CONTEXT_PREFIX)})));
        }
        await chrome.storage.sync.set({ enabled: true, automaticLogin: true, optimizeLoginPage: true, loadingOverlay: true, accountPreference: 'students.polytechnic.org' });
      })()`);
      const sessionFlows = async () => {
        const stored: unknown = await popup.evaluate('chrome.storage.session.get(null)');
        assert.ok(stored && typeof stored === 'object' && !Array.isArray(stored));
        return Object.entries(stored).filter(([key]) => key.startsWith(AUTH_CONTEXT_PREFIX)).map(([key, value]) => {
          const flow = parseAuthContext(value);
          assert.ok(flow);
          return { key, flow };
        });
      };
      const page = await activeBrowser.newPage();
      const otherTab = await activeBrowser.newPage();
      const errors: string[] = [];
      const school = 'https://polytechnic.myschoolapp.com';
      const entry = `https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent(`${school}/app/student?svcid=edu`)}`;
      const start = 'https://id.blackbaud.com/start';
      const callback = 'https://id.blackbaud.com/callback';
      const google = `https://accounts.google.com/signin?redirect_uri=${encodeURIComponent(callback)}`;
      const student = `${school}/app/student?svcid=edu#studentmyday/progress`;
      let startNavigations = 0;
      let googleRequests = 0;
      let googleDocuments = 0;
      let held: HTTPRequest | undefined;
      let pending: Awaited<ReturnType<typeof sessionFlows>>[number] | undefined;
      let previousFlowId: string | undefined;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url().startsWith('https://accounts.google.com/')) googleDocuments++;
      });
      for (const tab of [page, otherTab]) {
        tab.setDefaultTimeout(2_000);
        tab.on('pageerror', (error) => errors.push(String(error)));
        tab.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
        await tab.setRequestInterception(true);
        tab.on('request', (request) => {
          void (async () => {
            if (request.url().startsWith('chrome-extension:')) { await request.continue(); return; }
            const requested = new URL(request.url());
            if (requested.pathname === '/favicon.ico') { await request.respond({ status: 204 }); return; }
            if (tab === otherTab && requested.origin === school && requested.pathname === '/app') {
              await request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Other school login</title><input id="nextBtn" type="button" value="Next">' });
            } else if (tab === page && request.url() === entry) {
              await request.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Native Blackbaud sign-in</title>
                <button id="google-continue-button">Continue with Google</button>
                <script>document.querySelector('button').onclick = () => window.location.assign(${JSON.stringify(start)});</script>` });
            } else if (tab === page && request.url() === start) {
              assert.ok(request.isNavigationRequest());
              startNavigations++;
              await request.respond({ status: 302, headers: { location: google } });
            } else if (tab === page && request.url() === google) {
              assert.ok(request.isNavigationRequest());
              googleRequests++;
              await request.respond({ status: 302, headers: { location: callback } });
            } else if (tab === page && request.url() === callback) {
              return;
            } else if (tab === page && requested.origin === school && requested.pathname === '/app/student') {
              await request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Native Progress</title><header id="site-header"><a id="account-nav" href="#">Account</a></header><main id="site-main"><section id="coursesContainer">Courses</section></main>' });
            } else {
              errors.push(`Unexpected request: ${request.url()}`);
              await request.respond({ status: 404 });
            }
          })().catch((error: unknown) => errors.push(String(error)));
        });
      }
      try {
        for (let run = 0; run < 2; run++) {
          const callbackRequest = page.waitForRequest((request) => request.url() === callback);
          await page.goto(entry, { waitUntil: 'domcontentloaded' });
          const callbackHeld = await callbackRequest;
          held = callbackHeld;
          const flows = await sessionFlows();
          assert.equal(flows.length, pending ? 2 : 1);
          const active = flows.find(({ key }) => key !== pending?.key);
          assert.ok(active);
          assert.equal(active.flow.blackbaudAttempts, 1);
          assert.equal(active.flow.googleAttempts, 0);
          assert.notEqual(active.flow.id, previousFlowId);
          previousFlowId = active.flow.id;
          if (!pending) {
            await otherTab.goto(`${school}/app?svcid=edu#login`, { waitUntil: 'domcontentloaded' });
            await otherTab.waitForSelector('.bn-login-option button');
            pending = (await sessionFlows()).find(({ key }) => key !== active.key);
            assert.ok(pending);
            assert.equal(pending.flow.blackbaudAttempts, 0);
            assert.equal(pending.flow.googleAttempts, 0);
          }
          assert.equal(startNavigations, run + 1);
          assert.equal(googleRequests, run + 1);
          assert.equal(googleDocuments, 0);
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            callbackHeld.respond({ status: 302, headers: { location: student } }),
          ]);
          held = undefined;
          await page.waitForSelector('#site-main #coursesContainer', { visible: true });
          await popup.waitForFunction(`chrome.storage.session.get(${JSON.stringify(active.key)}).then(values => !(${JSON.stringify(active.key)} in values))`, { polling: 10 });
          assert.deepEqual(await sessionFlows(), [pending]);
          assert.deepEqual(errors, []);
        }
      } finally {
        if (held && !held.isInterceptResolutionHandled()) await held.respond({ status: 204 });
        await Promise.all([page.close(), otherTab.close()]);
      }
    });
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
