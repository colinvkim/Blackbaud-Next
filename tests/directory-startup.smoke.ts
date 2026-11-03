import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';
import { buildDevelopmentExtension, developmentPaths, ensureDevelopmentBrowser, launchDevelopmentBrowser, parseDevelopmentOptions } from '../scripts/browser-development.ts';
import { copyExtensionProject } from './fixtures/extension-project.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';
import { FEATURE_DEFINITIONS } from '../src/shared/settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://directory-startup-fixture.myschoolapp.com';
const directoryUrl = `${origin}/app/student?svcid=edu#directory/438`;

const nativeFixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Directory fixture</title><style>
  * { box-sizing: border-box; } body { margin: 0; }
  #site-main { max-width: 1200px; margin: auto; padding: 0 16px; }
  label { font-weight: bold; } input::placeholder { font-style: italic; }
</style></head><body>
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

async function syntheticDirectory(browser: Browser, options: { holdMetadata?: boolean; holdPeople?: boolean; peopleCount?: number } = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(3_000);
  let receiveParser!: (request: HTTPRequest) => void;
  let receiveMetadata!: (request: HTTPRequest) => void;
  let receivePeople!: (respond: () => Promise<void>) => void;
  const parser = new Promise<HTTPRequest>((resolve) => { receiveParser = resolve; });
  const metadata = new Promise<HTTPRequest>((resolve) => { receiveMetadata = resolve; });
  const people = new Promise<() => Promise<void>>((resolve) => { receivePeople = resolve; });
  const reads: string[] = [];
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('chrome-extension:')) { void request.continue(); return; }
    const url = new URL(request.url());
    if (url.pathname === '/hold-parser.js') { receiveParser(request); return; }
    if (url.pathname === '/native-directory-metadata' && options.holdMetadata) { receiveMetadata(request); return; }
    if (url.pathname.startsWith('/api/directory/')) reads.push(url.pathname);
    const body = url.pathname === '/api/directory/directoryget'
      ? { DirectoryID: 438, DirectoryName: 'Students', DefaultResults: true }
      : url.pathname === '/api/directory/directoryresultsget'
        ? options.peopleCount ? Array.from({ length: options.peopleCount }, (_, index) => ({
          UserID: index + 100, FirstName: `Person ${String(index + 1).padStart(3, '0')}`, LastName: 'Example',
          PublishUserProfile: true, PublishEmail: false, HasRelationships: false,
          AddressLine1: '123 Example Street', City: 'Example City', State: 'CA', Zip: '90000', TotalCount: options.peopleCount,
        })) : [
          { UserID: 41, FirstName: 'Alex', LastName: 'Example', GradeDisplay: '9', JobTitle: 'Science teacher and student research coordinator', PublishUserProfile: true, PublishEmail: true, EmailBad: false, Email: 'alex.example@example.test', HasRelationships: false, AddressLine1: '123 Example Street', City: 'Example City', State: 'CA', Zip: '90000', HomePhone: '(202) 555-0100', CellPhone: '+44 20 7946 0000', OfficePhone: '202.555.0101 ext. 42', TotalCount: 2 },
          { UserID: 42, FirstName: 'Casey', LastName: 'Sample', GradeDisplay: '10', PublishUserProfile: true, PublishEmail: false, HasRelationships: false, OfficePhone: '(202) 555-0102', TotalCount: 2 },
        ]
        : {};
    const respond = () => request.respond(url.pathname === '/app/student'
      ? { status: 200, contentType: 'text/html', body: nativeFixture }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/directory/directoryresultsget' && options.holdPeople) receivePeople(respond);
    else void respond();
  });
  const navigation = page.goto(directoryUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).then(() => null, (error: unknown) => error);
  await parser;
  await page.waitForFunction(() => Reflect.get(window, 'fixtureState')?.started === true);
  return { page, navigation, reads, parser: await parser, metadata, people };
}

async function expectEarlyShell(page: Page): Promise<void> {
  assert.deepEqual(await page.evaluate(() => ({
    ready: document.readyState,
    heading: document.querySelector('#site-main h1')?.textContent,
    pending: document.querySelector('#site-main [role="status"]')?.textContent,
    placeholders: document.querySelectorAll('.bn-directory-skeleton-row').length,
    recoveryVisible: document.querySelector('.bn-directory-original')?.checkVisibility({ visibilityProperty: true }),
    favicon: document.querySelector('[data-blackbaud-next-favicon]') !== null,
    state: Reflect.get(window, 'fixtureState'),
  })), {
    ready: 'loading', heading: 'Students', pending: 'Loading people…', placeholders: 4, recoveryVisible: false, favicon: false,
    state: { started: true, nativeStarts: 0, metadataReads: 0, metadataCompletions: 0, aborts: 0 },
  });
}

test('compiled Chrome catches the initial directory route before DOM readiness and keeps pending fallback native', { timeout: 30_000 }, async (t) => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'blackbaud-directory-startup-'));
  let browser: Browser | undefined;
  try {
    await copyExtensionProject(root, fixture);
    await buildDevelopmentExtension(fixture, new AbortController().signal);
    browser = await launchDevelopmentBrowser(parseDevelopmentOptions(['--headless'], fixture), await ensureDevelopmentBrowser(developmentPaths(root).cache));
    const id = await browser.installExtension(developmentPaths(fixture).extension);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/options.html`);
    await popup.waitForSelector('#mode-full:not(:disabled)');
    await popup.evaluate(async (features) => {
      const api = (globalThis as typeof globalThis & { chrome: ExtensionApi }).chrome;
      await api.storage.sync.set({ enabled: true, ...Object.fromEntries(features.map((key) => [key, key === 'enhancedDirectory' || key === 'fixFavicon'])) });
    }, FEATURE_DEFINITIONS.map(({ key }) => key));
    const activeBrowser = browser;

    await t.test('the initial shell becomes one people read when the document finishes', async () => {
      const frame = await syntheticDirectory(activeBrowser, { holdPeople: true });
      try {
        await expectEarlyShell(frame.page);
        assert.deepEqual(frame.reads, [], 'Parser-dependent directory tools have not started their reads');
        for (const width of [1280, 390]) {
          await frame.page.setViewport({ width, height: 900 });
          const layout = await frame.page.evaluate(() => {
            const rows = [...document.querySelectorAll('.bn-directory-skeleton-row')].map((row) => row.getBoundingClientRect());
            return { overflow: document.documentElement.scrollWidth - innerWidth, sameRow: rows[0]!.top === rows[1]!.top,
              disabled: [...document.querySelectorAll('.bn-directory-loading input, .bn-directory-loading select, .bn-directory-views button')].every((control) => (control as HTMLInputElement).disabled) };
          });
          assert.equal(layout.overflow, 0, 'Loading controls fit the viewport');
          assert.equal(layout.sameRow, width > 900, 'Placeholders follow the responsive directory columns');
          assert.equal(layout.disabled, true, 'Placeholder controls cannot start requests');
        }
        await frame.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        assert.equal(await frame.page.$eval('.bn-directory-skeleton-list', (list) => getComputedStyle(list).animationName), 'none');
        await frame.page.emulateMediaFeatures([]);
        await frame.parser.respond({ status: 200, contentType: 'text/javascript', body: '' });
        assert.equal(await frame.navigation, null);
        const finishPeople = await frame.people;
        assert.deepEqual(await frame.page.$eval('.bn-directory-loading', (panel) => ({
          border: getComputedStyle(panel).borderTopWidth, background: getComputedStyle(panel).backgroundColor,
          views: [...panel.querySelectorAll('.bn-directory-views button')].map((button) => button.textContent),
        })), { border: '1px', background: 'rgb(255, 255, 255)', views: ['Columns', 'Rows'] }, 'The pending panel keeps its styling after isolated styles start with Page appearance off');
        await finishPeople();
        await frame.page.waitForSelector('.bn-directory-row');
        await frame.page.waitForSelector('[data-blackbaud-next-favicon]');
        assert.match(await frame.page.$eval('.bn-directory-row', (row) => row.textContent ?? ''), /Alex Example/);
        assert.deepEqual(frame.reads.sort(), ['/api/directory/directoryget', '/api/directory/directoryresultsget']);
        assert.equal(await frame.page.evaluate(() => Reflect.get(window, 'fixtureState').nativeStarts), 0);
        await frame.page.bringToFront();
        const context = activeBrowser.defaultBrowserContext();
        await context.overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
        await frame.page.focus('.bn-directory-copy');
        await frame.page.keyboard.press('Enter');
        await frame.page.waitForSelector('.bn-directory-copy[data-copied]');
        assert.equal(await frame.page.evaluate(() => navigator.clipboard.readText()), 'alex.example@example.test');
        assert.equal(await frame.page.$eval('.bn-directory-copy-feedback', (status) => status.textContent), 'Email copied.');
        assert.equal(await frame.page.$eval('.bn-directory-copy', (copy) => copy.textContent), '', 'The copy action uses an icon with an accessible name');
        assert.equal(await frame.page.$eval('.bn-directory-feedback', (status) => status.textContent), '', 'Success does not appear at the bottom of the directory');
        await context.overridePermissions(origin, []);
        await frame.page.keyboard.press('Space');
        await frame.page.waitForSelector('.bn-directory-copy-feedback[data-error]');
        const localError = await frame.page.$eval('.bn-directory-copy-feedback', (status) => ({
          text: status.textContent, position: getComputedStyle(status).position, height: status.getBoundingClientRect().height,
        }));
        assert.match(localError.text!, /Could not copy/);
        assert.equal(localError.position, 'static', 'Failure feedback is visible beside the email');
        assert.ok(localError.height > 0);
        await context.overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
        await frame.page.keyboard.press('Enter');
        await frame.page.waitForSelector('.bn-directory-copy[data-copied]');
        assert.equal(await frame.page.$('.bn-directory-copy-feedback[data-error]'), null, 'A successful retry clears the inline error');
        assert.equal(await frame.page.$eval('.bn-directory-job-title', (title) => title.textContent), 'Science teacher and student research coordinator');
        assert.equal(await frame.page.$eval('.bn-directory-contact', (details) => (details as HTMLDetailsElement).open), false);
        await frame.page.focus('.bn-directory-contact summary');
        await frame.page.keyboard.press('Enter');
        await frame.page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('.bn-directory-contact')?.open === true);
        assert.equal(await frame.page.$eval('.bn-directory-contact address', (address) => address.textContent), '123 Example Street\nExample City, CA 90000');
        assert.deepEqual(await frame.page.$$eval('[data-bn-directory-user="41"] .bn-directory-phones a', (links) => links.map((link) => link.getAttribute('href'))),
          ['tel:12025550100', 'tel:+442079460000', 'tel:12025550101;ext=42']);
        await frame.page.keyboard.press('Tab');
        assert.equal(await frame.page.evaluate(() => document.activeElement?.getAttribute('href')), 'tel:12025550100');
        for (const view of ['Rows', 'Columns']) {
          const viewButton = view === 'Rows' ? '.bn-directory-views button:last-child' : '.bn-directory-views button:first-child';
          await frame.page.focus(viewButton);
          await frame.page.keyboard.press('Enter');
          assert.equal(await frame.page.$eval(viewButton, (button) => button.getAttribute('aria-pressed')), 'true');
          assert.equal(await frame.page.$eval('.bn-directory-contact', (details) => (details as HTMLDetailsElement).open), true, 'Changing layout preserves expanded contact details');
          for (const width of [1280, 992, 700, 390]) {
            await frame.page.setViewport({ width, height: 900 });
            const layout = await frame.page.evaluate(() => {
              const bounds = (selector: string) => {
                const { top, bottom, left, right, width } = document.querySelector(selector)!.getBoundingClientRect();
                return { top, bottom, left, right, width };
              };
              const input = document.querySelector('.bn-directory input')!;
              const rows = [...document.querySelectorAll('.bn-directory-person')].map((row) => row.getBoundingClientRect().top);
              const entries = [...document.querySelectorAll('.bn-directory-row')].map((row) => {
                const { top, bottom, width } = row.getBoundingClientRect();
                return { top, bottom, width };
              });
              const selectArrows = [...document.querySelectorAll('.bn-directory select')].map((select) => {
                const style = getComputedStyle(select);
                return { appearance: style.appearance, image: style.backgroundImage, x: style.backgroundPositionX,
                  y: style.backgroundPositionY, padding: parseFloat(style.paddingInlineEnd) };
              });
              return { overflow: document.documentElement.scrollWidth - innerWidth,
                search: bounds('.bn-directory input'), grade: bounds('.bn-directory select'), sort: bounds('.bn-directory-field:last-child select'),
                firstRow: bounds('.bn-directory-row'), rows, entries, list: bounds('.bn-directory-list'),
                identity: bounds('.bn-directory-identity'), email: bounds('.bn-directory-email'), viewButton: bounds('.bn-directory-views button'),
                copy: bounds('.bn-directory-copy'), copyBorder: getComputedStyle(document.querySelector('.bn-directory-copy')!).borderTopColor,
                address: bounds('.bn-directory-contact address'), summary: bounds('.bn-directory-contact summary'),
                phone: bounds('.bn-directory-phones a'), jobTitle: bounds('.bn-directory-job-title'),
                selectArrows, placeholder: getComputedStyle(input, '::placeholder').fontStyle,
                weight: getComputedStyle(input).fontWeight };
            });
            const evidence = JSON.stringify({ view, width, ...layout });
            assert.equal(layout.overflow, 0, `Directory controls fit the viewport: ${evidence}`);
            assert.equal(layout.placeholder, 'normal', 'Native placeholder italics do not leak into directory search');
            assert.equal(layout.weight, '400', 'Directory field values use regular weight despite native label styling');
            for (const arrow of layout.selectArrows) {
              assert.equal(arrow.appearance, 'none', 'The browser arrow is replaced by an inset chevron');
              assert.notEqual(arrow.image, 'none', 'Each select retains a visible chevron');
              assert.equal(arrow.x, 'calc(100% - 12px)', 'Select chevrons have the same inset as field text');
              assert.equal(arrow.y, '50%', 'Select chevrons stay vertically centered at every control height');
              assert.ok(arrow.padding >= 36, 'Field values have space before the chevron');
            }
            assert.ok(layout.address.width > 0 && layout.address.right <= width, `The expanded address fits the result row: ${evidence}`);
            assert.ok(layout.phone.width > 0 && layout.phone.right <= width, `Expanded phone numbers fit the result row: ${evidence}`);
            assert.ok(layout.jobTitle.right <= width, `Staff titles wrap within their row: ${evidence}`);
            assert.ok(layout.copy.right <= width, `The copy button stays inside its result row: ${evidence}`);
            assert.equal(layout.copyBorder, 'rgba(0, 0, 0, 0)', 'Copy actions have no visible outline at rest');
            assert.ok(layout.firstRow.top >= Math.max(layout.search.bottom, layout.sort.bottom), `The toolbar clears the results: ${evidence}`);
            if (width > 900) {
              if (view === 'Rows') {
                assert.ok(Math.abs(layout.entries[0]!.width - layout.list.width) < 1, `Row entries use the full list width: ${evidence}`);
                assert.ok(layout.entries[1]!.top >= layout.entries[0]!.bottom, `Row entries follow each other vertically: ${evidence}`);
                assert.ok(Math.abs(layout.identity.top - layout.email.top) < 1, `Identity and email share a desktop row: ${evidence}`);
                assert.ok(layout.summary.left > layout.email.left && layout.email.left > layout.identity.left, `Contact details follow identity and email across each row: ${evidence}`);
              } else {
                assert.ok(Math.abs(layout.rows[0]! - layout.rows[1]!) < 1, `Columns retain two aligned entries: ${evidence}`);
                assert.ok(layout.entries[0]!.width < layout.list.width / 2, `Columns share the list width with a gap: ${evidence}`);
              }
            }
            if (width === 1280) {
              assert.ok(Math.abs(layout.search.bottom - layout.sort.bottom) < 1, `Desktop search and filters share one control row: ${evidence}`);
              assert.ok(layout.grade.width <= 160, `Grade filtering does not consume a quarter of the page: ${evidence}`);
            }
            if (width === 390) {
              assert.ok(layout.search.width >= 300, `Phone search uses the available row: ${evidence}`);
              assert.ok(Math.abs(layout.grade.top - layout.sort.top) < 1, `Phone filters share a row below search: ${evidence}`);
              assert.ok(layout.summary.bottom - layout.summary.top >= 44, `Address disclosure retains a phone touch target: ${evidence}`);
              assert.ok(layout.phone.bottom - layout.phone.top >= 44, `Telephone links retain a phone touch target: ${evidence}`);
              assert.ok(layout.viewButton.bottom - layout.viewButton.top >= 44, `View controls retain a phone touch target: ${evidence}`);
              assert.ok(layout.copy.width >= 44 && layout.copy.bottom - layout.copy.top >= 44, 'The copy button retains a phone touch target');
            }
          }
        }
        await frame.page.$eval('.bn-directory select', (select) => {
          (select as HTMLSelectElement).disabled = true;
          select.setAttribute('dir', 'rtl');
        });
        const disabledArrow = await frame.page.$eval('.bn-directory select', (select) => {
          const style = getComputedStyle(select);
          return { image: style.backgroundImage, x: style.backgroundPositionX, y: style.backgroundPositionY };
        });
        assert.notEqual(disabledArrow.image, 'none', 'Disabled styling does not erase the select chevron');
        assert.equal(disabledArrow.x, '12px', 'Right-to-left fields put the chevron at the opposite edge');
        assert.equal(disabledArrow.y, '50%');
        await frame.page.$eval('.bn-directory select', (select) => {
          (select as HTMLSelectElement).disabled = false;
          select.removeAttribute('dir');
        });
        await frame.page.focus('.bn-directory-contact summary');
        await frame.page.keyboard.press('Space');
        await frame.page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('.bn-directory-contact')?.open === false);
        assert.equal(await frame.page.$eval('.bn-directory-contact address', (address) => address.checkVisibility()), false);
        assert.equal(await frame.page.$eval('.bn-directory-phones a', (phone) => phone.checkVisibility()), false);
        assert.equal(frame.reads.length, 2, 'Opening and closing contact details does not fetch additional directory data');
        await frame.page.click('#progress');
        await frame.page.waitForSelector('#native-progress');
        assert.equal(await frame.page.$('.bn-directory-contact'), null, 'Native navigation removes contact details with their directory');
      } finally { await frame.page.close(); }
    });

    await t.test('directory bottoms remain reachable and paging starts at the new results with keyboard focus', async () => {
      const frame = await syntheticDirectory(activeBrowser, { peopleCount: 103 });
      try {
        await frame.parser.respond({ status: 200, contentType: 'text/javascript', body: '' });
        assert.equal(await frame.navigation, null);
        await frame.page.waitForSelector('.bn-directory-row');
        await frame.page.addStyleTag({ content: 'body { padding-top: 96px; } #fixture-fixed-header { position: fixed; inset: 0 0 auto; height: 96px; background: white; z-index: 100; }' });
        await frame.page.evaluate(() => {
          const header = document.createElement('header');
          header.id = 'fixture-fixed-header';
          header.textContent = 'Native fixed navigation';
          document.body.prepend(header);
        });
        for (const view of ['Columns', 'Rows']) for (const width of [1280, 390]) {
          await frame.page.setViewport({ width, height: 720 });
          await frame.page.$eval(view === 'Columns' ? '.bn-directory-views button:first-child' : '.bn-directory-views button:last-child', (button) => (button as HTMLButtonElement).click());
          await frame.page.$eval('.bn-directory-row:last-child details', (details) => { (details as HTMLDetailsElement).open = true; });
          await frame.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          const bottom = await frame.page.evaluate(() => ({
            pagination: document.querySelector('.bn-directory-pagination')!.getBoundingClientRect().bottom,
            contact: document.querySelector('.bn-directory-row:last-child details')!.getBoundingClientRect().bottom,
            viewport: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
          }));
          assert.equal(bottom.overflow, 0, `${view} fits at ${width}px`);
          assert.ok(bottom.pagination <= bottom.viewport && bottom.contact <= bottom.viewport, `The final contact and pagination are reachable in ${view} at ${width}px`);
          for (const action of ['Next', 'Next', 'Previous', 'Previous']) {
            const selector = action === 'Next' ? '.bn-directory-pagination button:last-child' : '.bn-directory-pagination button:first-child';
            await frame.page.focus(selector);
            await frame.page.keyboard.press('Enter');
            const position = await frame.page.evaluate(() => ({
              first: document.querySelector('.bn-directory-row')!.getBoundingClientRect().toJSON(),
              header: document.getElementById('fixture-fixed-header')!.getBoundingClientRect().bottom,
              viewport: innerHeight, focused: document.activeElement === document.querySelector('.bn-directory-list'),
            }));
            assert.ok(position.first.top >= position.header && position.first.bottom <= position.viewport, `${action} shows the start of the new results in ${view} at ${width}px: ${JSON.stringify(position)}`);
            assert.equal(position.focused, true, 'Keyboard navigation continues from the new results');
          }
        }
        assert.equal(frame.reads.length, 2, 'Paging does not issue extra directory reads');
        await frame.page.click('#progress');
        await frame.page.waitForSelector('#native-progress');
        assert.equal(await frame.page.$('.bn-directory-list'), null);
      } finally { await frame.page.close(); }
    });

    await t.test('a native directory rerender recovers automatically once and retains manual retry', async () => {
      const frame = await syntheticDirectory(activeBrowser);
      try {
        await frame.parser.respond({ status: 200, contentType: 'text/javascript', body: '' });
        assert.equal(await frame.navigation, null);
        await frame.page.waitForSelector('.bn-directory-name');
        assert.equal(frame.reads.length, 2);
        const rerender = () => frame.page.evaluate(() => {
          Reflect.get(window, 'p3')._modules['shared/directory'].Us.renderDirectory('438');
        });
        await rerender();
        await frame.page.waitForSelector('.bn-directory-name');
        assert.equal(frame.reads.length, 4, 'One automatic retry reads the replacement directory');
        assert.equal(await frame.page.$('.bn-directory-notice'), null);
        await rerender();
        await frame.page.waitForSelector('.bn-directory-notice');
        assert.equal(frame.reads.length, 4, 'A second interruption does not start more reads');
        assert.equal(await frame.page.$eval('.bn-directory-notice p', (notice) => notice.textContent), 'The enhanced directory was interrupted. You can use the original directory or try again.');
        await frame.page.click('.bn-directory-notice button');
        await frame.page.waitForSelector('.bn-directory-name');
        assert.equal(frame.reads.length, 6, 'An explicit retry is still available');
        assert.equal(frame.page.url(), directoryUrl);
        assert.equal(await frame.page.evaluate(() => Reflect.get(window, 'fixtureState').nativeStarts), 0);
        await frame.page.click('#progress');
        await frame.page.waitForSelector('#native-progress');
        assert.equal(await frame.page.$('.bn-directory'), null);
      } finally { await frame.page.close(); }
    });

    await t.test('pending original fallback cannot overwrite a later native route', async () => {
      const frame = await syntheticDirectory(activeBrowser, { holdMetadata: true });
      try {
        await expectEarlyShell(frame.page);
        await frame.page.waitForFunction(() => document.querySelector('.bn-directory-original')?.checkVisibility({ visibilityProperty: true }), { timeout: 10_000, polling: 100 });
        await frame.page.click('.bn-directory-original');
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
