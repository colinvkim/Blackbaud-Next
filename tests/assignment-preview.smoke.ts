import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer-core';
import { developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://preview-fixture.myschoolapp.com';
const sourceUrl = `${origin}/lms-assignment/assignment-center/student`;
const trigger = '#short-title .bn-preview-button';
const panel = '.bn-preview-panel';
const title = 'Reading, research, and a detailed reflection on the relationship between community history and personal experience';
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native assignments</title><style>
  * { box-sizing: border-box; } body { margin: 0; font: 16px/1.5 Arial,sans-serif; }
  main { max-width: 900px; padding: 16px; margin: auto; }
  sky-toolbar, sky-repeater-item { display: block; } sky-repeater-item { padding: 16px 0; border-bottom: 1px solid #ddd; }
  app-assignment-title-link { display: inline; font: 16px/1.1 Arial,sans-serif; } a { font-size: 16px; overflow-wrap: anywhere; }
  [hidden] { display: none; }
</style></head><body><main id="site-main"><sky-toolbar><input aria-label="Search items"></sky-toolbar>
  <sky-repeater-item class="assignment-repeater-item"><app-assignment-title-link id="short-title"><a href="/lms-assignment/assignment/assignment-student-view/123">Short assignment</a></app-assignment-title-link></sky-repeater-item>
  <sky-repeater-item class="assignment-repeater-item"><app-assignment-title-link id="long-title"><a href="/lms-assignment/assignment/assignment-student-view/234">${title}</a></app-assignment-title-link></sky-repeater-item>
</main><script>
  document.querySelector('main').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      document.body.dataset.nativeKeys = String(Number(document.body.dataset.nativeKeys || 0) + 1);
    }
  });
  document.querySelectorAll('app-assignment-title-link a').forEach(link => link.addEventListener('click', event => {
    event.preventDefault(); document.body.dataset.nativeClicks = String(Number(document.body.dataset.nativeClicks || 0) + 1);
  }));
</script></body></html>`;

async function previewLayout(page: Page, width: number): Promise<void> {
  const controls = await page.$$eval('app-assignment-title-link', elements => elements.map(element => {
    const title = element.querySelector('a')!.getBoundingClientRect();
    const button = element.querySelector('.bn-preview-button')!.getBoundingClientRect();
    return { titleLeft: title.left, titleRight: title.right, titleBottom: title.bottom, titleCenter: title.top + title.height / 2,
      left: button.left, right: button.right, top: button.top, height: button.height, center: button.top + button.height / 2 };
  }));
  assert.equal(controls.length, 2);
  for (const control of controls) {
    assert.ok(control.left >= 0 && control.right <= width && control.height >= (width <= 480 ? 44 : 28), JSON.stringify(control));
    if (control.top >= control.titleBottom) {
      assert.ok(Math.abs(control.left - control.titleLeft) < 1, `Wrapped Preview starts at the title's left edge: ${JSON.stringify(control)}`);
      assert.ok(control.top - control.titleBottom >= 4, JSON.stringify(control));
    } else {
      assert.ok(Math.abs(control.center - control.titleCenter) < 1, `Inline Preview is centered beside the title: ${JSON.stringify(control)}`);
      assert.ok(Math.abs(control.left - control.titleRight - 8) < 1, JSON.stringify(control));
    }
  }
  if (width <= 480) assert.ok(controls[1]!.top >= controls[1]!.titleBottom, 'A long title puts Preview on its own line');
}

test('Chrome preview actions stay secondary, support keyboard activation inside native rows, and retain touch targets', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-preview-browser-'));
  let browser: Browser | undefined;
  try {
    await cp(resolve(root, 'chrome'), developmentPaths(fixture).extension, { recursive: true });
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/options.html`);
    await popup.waitForSelector('#mode-full:not(:disabled)');
    await popup.evaluate(async (features) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ enabled: true, ...Object.fromEntries(features.map((key) => [key, key === 'assignmentPreviews' || key === 'pageAppearance'])) });
    }, FEATURE_DEFINITIONS.map(({ key }) => key));
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    let holdDetails = false;
    const pendingReplies: Array<(status?: number) => Promise<void>> = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
      const url = new URL(request.url());
      if (url.origin !== origin) { void request.respond({ status: 404 }); return; }
      if (url.pathname === '/lms-assignment/assignment-center/student') {
        void request.respond({ status: 200, contentType: 'text/html', body: fixtureHtml });
      } else if (url.pathname === '/api/webapp/context') {
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ UserInfo: { UserId: 42, DefaultPersonaId: 2 } }) });
      } else if (url.pathname === '/api/assignment2/UserAssignmentDetailsGetAllStudentData') {
        const respond = (status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify({
          AssignmentIndexId: Number(url.searchParams.get('assignmentIndexId')), ShortDescription: 'Short assignment',
          LongDescription: '<p>Read the chapter and write a reflection.</p>', GroupName: 'Example class',
          DueDate: '11/2/2026 8:30 AM', LinkItems: [], DownloadItems: [],
        }) });
        if (holdDetails) pendingReplies.push(respond);
        else void respond();
      } else void request.respond({ status: 404 });
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(trigger);
    const outlined = await page.$eval(trigger, (button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, border: style.borderTopColor, smallerThanTitle: parseFloat(style.fontSize) < parseFloat(getComputedStyle(button.previousElementSibling!).fontSize) };
    });
    assert.deepEqual(outlined, { background: 'rgb(255, 255, 255)', border: 'rgb(187, 199, 209)', smallerThanTitle: true });
    for (const key of ['Enter', 'Space'] as const) {
      await page.focus(trigger);
      await page.keyboard.press(key);
      await page.waitForFunction(() => document.querySelector('.bn-preview-panel') || document.body.dataset.nativeKeys);
      assert.equal(await page.$eval('body', (body) => (body as HTMLElement).dataset.nativeKeys), undefined, 'Preview activation does not trigger native row keyboard commands');
      await page.waitForSelector(`${panel} .bn-preview-instructions`);
      assert.equal(await page.$$eval(panel, (elements) => elements.length), 1);
      assert.equal(await page.$eval(trigger, (button) => button.getAttribute('aria-expanded')), 'true');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.bn-preview-panel'));
      assert.equal(await page.$eval(trigger, (button) => document.activeElement === button && button.matches(':focus-visible')), true);
      assert.equal(await page.$eval(trigger, (button) => getComputedStyle(button).outlineStyle), 'solid');
    }
    holdDetails = true;
    const loadingRequest = page.waitForRequest(request => request.url().includes('UserAssignmentDetailsGetAllStudentData'));
    const initialLoading = await page.$eval(trigger, button => {
      (button as HTMLButtonElement).click();
      const skeleton = document.querySelector('.bn-preview-skeleton')!;
      return { visible: skeleton.checkVisibility({ visibilityProperty: true }), decorative: skeleton.getAttribute('aria-hidden') };
    });
    await loadingRequest;
    assert.deepEqual(initialLoading, { visible: true, decorative: 'true' }, 'Skeletons appear immediately and are hidden from assistive technology');
    assert.equal(await page.$eval(`${panel} [role="status"]`, element => element.textContent), 'Loading preview…');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.waitForFunction(() => document.querySelector('.bn-preview-skeleton')?.checkVisibility({ visibilityProperty: true }));
    assert.equal(await page.$eval('.bn-preview-skeleton', element => element.getAnimations().some(animation => animation.effect?.getTiming().iterations === Infinity)), false, 'Reduced motion stops the pulse');
    for (const width of [1280, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      const loadingLayout = await page.$eval(panel, element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, overflow: element.scrollWidth - element.clientWidth,
          barsFit: [...element.querySelectorAll('.bn-preview-skeleton-line')].every(line => { const rect = line.getBoundingClientRect(); return rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right; }) };
      });
      assert.ok(loadingLayout.left >= 0 && loadingLayout.right <= width && loadingLayout.barsFit, JSON.stringify(loadingLayout));
      assert.equal(loadingLayout.overflow, 0);
    }
    await pendingReplies.shift()!(503);
    await page.waitForFunction(() => document.querySelector('.bn-preview-panel [role="status"]')?.textContent?.includes('could not be loaded'));
    assert.equal(await page.$('.bn-preview-skeleton'), null, 'Errors replace the loading placeholders');
    assert.equal(await page.$eval(`${panel} [role="status"]`, element => element.checkVisibility({ visibilityProperty: true })), true);
    const retryRequest = page.waitForRequest(request => request.url().includes('UserAssignmentDetailsGetAllStudentData'));
    await page.$$eval(`${panel} button`, buttons => buttons.find(button => button.textContent === 'Retry preview')!.click());
    await retryRequest;
    await page.waitForFunction(() => document.querySelector('.bn-preview-skeleton')?.checkVisibility({ visibilityProperty: true }));
    assert.equal(await page.$$eval('.bn-preview-skeleton', elements => elements.length), 1);
    await pendingReplies.shift()!();
    await page.waitForSelector(`${panel} .bn-preview-instructions`);
    assert.equal(await page.$('.bn-preview-skeleton'), null, 'Content replaces the skeleton after a successful retry');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.bn-preview-panel'));
    await page.emulateMediaFeatures([]);
    holdDetails = false;
    for (const width of [1280, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      await previewLayout(page, width);
    }
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ pageAppearance: false });
    });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-blackbaud-next-appearance'));
    await previewLayout(page, 320);
    await page.$eval('#short-title', element => { (element as HTMLElement).hidden = true; });
    assert.equal(await page.$eval('#short-title', element => element.getBoundingClientRect().height), 0, 'A native hidden title stays hidden');
    await page.$eval('#short-title', element => { (element as HTMLElement).hidden = false; });
    await page.$eval('#short-title', element => {
      const flag = document.createElement('span'); flag.id = 'native-title-flag'; flag.textContent = 'Native flag'; element.append(flag);
    });
    assert.equal(await page.$eval('#short-title', element => getComputedStyle(element).display), 'inline', 'An unfamiliar title structure keeps its native layout');
    await page.$eval('#native-title-flag', element => element.remove());
    await page.click('#short-title a');
    assert.equal(await page.$eval('body', (body) => (body as HTMLElement).dataset.nativeClicks), '1');
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ assignmentPreviews: false });
    });
    await page.waitForFunction(() => !document.querySelector('.bn-preview-button, .bn-preview-panel'));
    assert.equal(await page.$eval('#short-title', element => getComputedStyle(element).display), 'inline', 'Disabling Preview restores the native title layout');
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ assignmentPreviews: true });
    });
    await page.waitForSelector(trigger);
    await page.focus(trigger);
    await page.keyboard.press('Enter');
    await page.waitForSelector(panel);
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ enabled: false });
    });
    await page.waitForFunction(() => !document.querySelector('.bn-preview-button, .bn-preview-panel'));
    assert.equal(await page.$eval('#short-title a', (link) => link.getAttribute('href')), '/lms-assignment/assignment/assignment-student-view/123');
  } finally { await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
});
