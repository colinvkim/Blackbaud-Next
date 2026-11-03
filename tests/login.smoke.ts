import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { schoolLoginHtml } from './fixtures/login.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://polytechnic.myschoolapp.com';
const loginUrl = `${origin}/app#login`;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Example School</title><style>
body { margin: 0; background: #faecd6; font: 15px Arial,sans-serif; }
#site-login-box { width: 500px; margin: 100px auto; padding: 20px; background: white; }
#site-login-input > input, #site-login-input > label { display: block; }
.skylo { position: fixed; inset: 0 0 auto; height: 4px; background: cyan; z-index: 100000; }
</style></head><body>${schoolLoginHtml}<div class="progress skylo"></div><script>
document.getElementById('site-login-form').addEventListener('submit', event => { event.preventDefault(); document.body.dataset.nativeSubmits = String(Number(document.body.dataset.nativeSubmits || 0) + 1); });
</script></body></html>`;

test('custom school welcome replaces only the initial form and restores native sign-in', { timeout: 45_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-login-browser-'));
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
    await preferences({ enabled: true, automaticLogin: false, optimizeLoginPage: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(4_000);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      if (new URL(request.url()).pathname.endsWith('school-logo.svg')) {
        void request.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="48"><rect width="480" height="48" fill="#f8a23c"/></svg>' });
        return;
      }
      if (new URL(request.url()).pathname === '/missing-logo.svg') { void request.respond({ status: 404 }); return; }
      void request.respond({ status: 200, contentType: 'text/html', body: new URL(request.url()).origin === origin ? html : '<!doctype html><title>Blackbaud sign-in</title><button id="google-continue-button">Continue with Google</button>' });
    });
    const ready = () => page.waitForSelector('#blackbaud-next-login');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await ready();
    const schoolLogo = '#blackbaud-next-login .bn-signin-school-brand img';
    await page.waitForSelector(schoolLogo);
    await page.waitForFunction(() => (document.querySelector('#blackbaud-next-login .bn-signin-school-brand img') as HTMLImageElement)?.naturalWidth > 0);
    assert.equal(await page.$eval(schoolLogo, image => (image as HTMLImageElement).src), `${origin}/fixture-school-logo.svg`);
    assert.equal(await page.$eval('.bn-signin-school-brand', header => getComputedStyle(header).backgroundColor), 'rgb(21, 43, 67)', 'The school logo keeps its native header background');
    await page.$eval('#img-login-logo', image => { image.setAttribute('src', '/updated-school-logo.svg'); });
    await page.waitForFunction(() => (document.querySelector('#blackbaud-next-login .bn-signin-school-brand img') as HTMLImageElement)?.src.endsWith('/updated-school-logo.svg'));
    await page.$eval('#img-login-logo', image => { image.setAttribute('src', '/missing-logo.svg'); });
    await page.waitForSelector('#blackbaud-next-login .bn-signin-school-brand[hidden]');
    assert.equal(await page.$eval('#blackbaud-next-login button', button => button.checkVisibility()), true, 'Logo failure leaves sign-in usable');
    await page.$eval('#img-login-logo', image => { image.removeAttribute('src'); });
    await page.waitForFunction(() => !document.querySelector('#blackbaud-next-login .bn-signin-school-brand img')?.hasAttribute('src'));
    assert.equal(await page.$eval('#blackbaud-next-login button', button => button.checkVisibility()), true, 'A school without a supported logo still has sign-in');
    await page.$eval('#img-login-logo', image => { image.setAttribute('src', '/fixture-school-logo.svg'); });
    await page.waitForSelector('#blackbaud-next-login .bn-signin-school-brand:not([hidden])');
    assert.equal(await page.$eval('#app', app => getComputedStyle(app).display), 'none');
    assert.equal(await page.$eval('#app', app => app.hasAttribute('inert')), true);
    assert.equal(await page.$$eval('#blackbaud-next-login button', buttons => buttons.length), 1);
    assert.equal(await page.$eval('.skylo', bar => getComputedStyle(bar).visibility), 'hidden', 'Native loading decoration cannot cover the custom welcome');
    await page.focus('#Username');
    assert.equal(await page.evaluate(() => document.activeElement?.id === 'Username'), false, 'Hidden native fields cannot receive keyboard focus');
    const form = await page.$('#site-login-form');
    for (const [width, height] of [[1280, 900], [390, 844], [320, 568], [568, 300]]) {
      await page.setViewport({ width: width!, height: height! });
      const state = await page.evaluate(() => {
        const screen = document.getElementById('blackbaud-next-login')!;
        const button = screen.querySelector('button')!;
        const card = screen.querySelector('.bn-signin-card')!;
        const rect = card.getBoundingClientRect();
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, screenWidth: screen.scrollWidth,
          cardLeft: rect.left, cardRight: rect.right, targetHeight: button.getBoundingClientRect().height,
          reachable: screen.scrollHeight >= screen.clientHeight, label: button.textContent, textWidth: button.scrollWidth, buttonWidth: button.clientWidth };
      });
      assert.ok(state.documentWidth <= state.width && state.screenWidth <= state.width, JSON.stringify(state));
      assert.ok(state.cardLeft >= 16 && state.cardRight <= state.width - 16, JSON.stringify(state));
      assert.ok(state.targetHeight >= 44 && state.textWidth <= state.buttonWidth && state.reachable, JSON.stringify(state));
    }
    await page.setViewport({ width: 1280, height: 900 });
    await preferences({ pageAppearance: false });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-blackbaud-next-appearance'));
    assert.equal(await page.$eval('#blackbaud-next-login button', button => getComputedStyle(button).backgroundColor), 'rgb(0, 102, 161)', 'The sign-in feature retains its own appearance');
    for (const update of [{ optimizeLoginPage: false }, { enabled: false }] as Record<string, boolean>[]) {
      await preferences(update);
      await page.waitForFunction(() => !document.querySelector('#blackbaud-next-login'));
      assert.equal(await form!.evaluate(form => form.isConnected && form.checkVisibility()), true, 'The original native form and its listeners survive');
      assert.equal(await page.$eval('#Username', input => (input as HTMLInputElement).value), 'student@example.test');
      assert.equal(await page.$eval('#remember', input => (input as HTMLInputElement).checked), true);
      assert.equal(await page.$eval('#app', app => app.hasAttribute('inert') || app.hasAttribute('aria-hidden') || app.hasAttribute('data-bn-login-native')), false);
      await page.click('#nextBtn');
      await preferences({ enabled: true, optimizeLoginPage: true });
      await ready();
    }
    assert.equal(await page.$eval('body', body => body.dataset.nativeSubmits), '2');
    await page.$eval('#divPassword', password => { (password as HTMLElement).style.display = 'block'; });
    await page.waitForFunction(() => !document.querySelector('#blackbaud-next-login'));
    assert.equal(await page.$eval('#Password', input => input.checkVisibility()), true, 'A native password step remains usable');
    await page.$eval('#divPassword', password => { (password as HTMLElement).style.display = 'none'; });
    await ready();
    await page.$eval('#site-login-alert', alert => { alert.append(document.createTextNode('')); });
    await page.$eval('#site-login-alert', alert => { alert.firstChild!.textContent = 'Native school sign-in error'; });
    await page.waitForFunction(() => !document.querySelector('#blackbaud-next-login'));
    assert.equal(await page.$eval('#site-login-alert', alert => alert.checkVisibility()), true);
    await page.$eval('#site-login-alert', alert => { alert.textContent = ''; });
    await ready();
    await page.$eval('#site-login-form', form => { const field = document.createElement('input'); field.id = 'school-verification'; field.setAttribute('aria-label', 'School verification'); form.append(field); });
    await page.waitForFunction(() => !document.querySelector('#blackbaud-next-login'));
    assert.equal(await page.$eval('#school-verification', field => field.checkVisibility()), true, 'Unrecognized school controls retain the native screen');
    await page.$eval('#school-verification', field => field.remove());
    await ready();
    await page.evaluate(() => { location.hash = '#privacy'; });
    await page.waitForFunction(() => !document.querySelector('#blackbaud-next-login'));
    assert.equal(await page.$eval('#app', app => app.checkVisibility()), true, 'Other school routes remain native');
    await page.evaluate(() => { location.hash = '#login'; });
    await ready();
    await page.evaluate((html) => { document.getElementById('app')!.outerHTML = html; }, schoolLoginHtml);
    await ready();
    assert.equal(await page.$$eval('#blackbaud-next-login', views => views.length), 1, 'Native replacement retains one welcome screen');
    await page.focus('#blackbaud-next-login button');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hostname === 'app.blackbaud.com');
    const destination = new URL(page.url());
    assert.equal(destination.pathname, '/signin/');
    assert.equal(destination.searchParams.get('redirectUrl'), `${origin}/app/student?svcid=edu`);
    assert.equal(await page.$('#blackbaud-next-login'), null, 'Provider authentication retains its native screen');
  } finally {
    await browser?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
