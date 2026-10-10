import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { installDirectoryPageBridge } from '../src/blackbaud/directory-page.ts';
import { DIRECTORY_LEASE_LIFETIME, DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_OWNER_ATTRIBUTE, DIRECTORY_REQUEST_EVENT, DIRECTORY_RESPONSE_EVENT, DIRECTORY_UI_ATTRIBUTE } from '../src/blackbaud/directory-protocol.ts';

const token = 'directory-bridge-lease-01';
const nextToken = 'directory-bridge-lease-02';
const directoryUrl = 'https://example.myschoolapp.com/app/student?svcid=edu#directory/438';

interface Collection {
  length: number;
  toJSON(): unknown[];
}

interface Receiver {
  el: HTMLElement;
  collection?: Collection;
}

type Method = (this: Receiver, ...args: unknown[]) => unknown;

function fixture() {
  const errors: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(`<main id="site-main"><section>
    <header id="overview"><select id="native-directory-picker"><option value="438">Students</option></select></header>
    <div class="native-content"><input aria-label="Native search"><div id="directory-results"><div id="directory-items-container">Native rows</div></div></div>
  </section></main>`, { url: directoryUrl, pretendToBeVisual: true, virtualConsole });
  const page = dom.window as unknown as Window & typeof globalThis;
  const root = page.document.querySelector<HTMLElement>('#site-main > section')!;
  const native = root.querySelector<HTMLElement>('.native-content')!;
  const rows: Array<Record<string, unknown>> = [{
    UserID: 101, FirstName: 'Ada', LastName: 'Example', UserNameFormatted: 'Ada Example', Nickname: 'A',
    PublishUserProfile: true, PublishEmail: true, Email: 'ada@example.test', EmailBad: false,
    LargeFileName: 'large_user_ada.jpg', Grade: 10, GradeDisplay: '10', GradeNumericDisplay: '10', TotalCount: 1,
    AddressLine1: 'EXCLUDED_PRIVATE_ADDRESS', PreferredAddressLat: 31.25, PreferredAddressLng: -101.5,
    MyContactsID: 2001, HasRelationships: true, UserName: 'EXCLUDED_LOGIN_NAME',
    UnexpectedObject: { secret: 'EXCLUDED_NESTED_FIELD' },
  }];
  const facetRows: Array<Record<string, unknown>> = [{ FieldName: 'student_grade' }];
  const results: Collection = { get length() { return rows.length; }, toJSON: () => rows };
  const facets: Collection = { get length() { return facetRows.length; }, toJSON: () => facetRows };
  const modelData: Record<string, unknown> = { DirectoryId: '438', DirectoryName: 'Student Directory' };
  const calls: Array<{ method: string; receiver: Receiver; args: unknown[] }> = [];
  const originalResults: Method = function (...args) {
    calls.push({ method: 'results', receiver: this, args });
    return 'native-results';
  };
  const originalFacets: Method = function (...args) {
    calls.push({ method: 'facets', receiver: this, args });
    return 'native-facets';
  };
  const originalRender: Method = function (...args) {
    calls.push({ method: 'render', receiver: this, args });
    root.querySelector('#directory-results')!.textContent = `Rendered ${results.length} native rows`;
    return 'native-render';
  };
  const originalScroll: Method = function (...args) {
    calls.push({ method: 'scroll', receiver: this, args });
    return 'native-scroll';
  };
  const view = {
    template: 'directory/directory.template.html', el: root,
    model: { get: (key: string) => modelData[key] }, results, facets,
    getResults: originalResults, getFacetValues: originalFacets, renderResults: originalRender,
  };
  const prototype = { scrollHandler: originalScroll };
  const ownedList = Object.assign(Object.create(prototype) as Receiver & typeof prototype, {
    el: root.querySelector<HTMLElement>('#directory-results')!, collection: results,
  });
  const moduleData = { directoryId: '438', searchVal: '', searchFacets: [] as unknown[], searchAllFields: false };
  const app = {
    _currentMainView: view,
    _modules: { 'shared/directory': { Data: moduleData, Vs: { DirectoryList: { prototype } } } },
    Config: { PhotonForUserPhotoUrl: 'https://example.myschoolapp.com/user/' },
  };
  Object.defineProperty(page, 'p3', { value: app, configurable: true });
  const responses: Array<Record<string, unknown>> = [];
  page.document.addEventListener(DIRECTORY_RESPONSE_EVENT, (event) => {
    responses.push(JSON.parse((event as CustomEvent).detail));
  });
  const dispose = installDirectoryPageBridge(page);
  const sendRaw = (detail: unknown) => page.document.dispatchEvent(new page.CustomEvent(DIRECTORY_REQUEST_EVENT, { detail }));
  const send = (action: 'acquire' | 'activate' | 'heartbeat' | 'release', lease = token, directoryId = '438', mode?: 'metadata') => {
    sendRaw(JSON.stringify({ action, token: lease, directoryId, ...(mode ? { mode } : {}) }));
  };
  const replacement = () => {
    const style = page.document.createElement('style');
    style.textContent = `[${DIRECTORY_NATIVE_ATTRIBUTE}] .native-content { display: none; }`;
    page.document.head.append(style);
    root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, '');
    const ui = page.document.createElement('div');
    ui.setAttribute(DIRECTORY_UI_ATTRIBUTE, '');
    ui.textContent = 'Enhanced directory';
    root.append(ui);
    return ui;
  };
  return {
    dom, page, root, native, rows, facetRows, results, view, modelData, app, moduleData,
    prototype, ownedList, calls, responses, errors, originalResults, originalFacets, originalRender, originalScroll,
    send, sendRaw, replacement, dispose,
    close() { dispose(); dom.window.close(); },
  };
}

test('acquisition projects only supported directory data and preserves the native source records', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const original = structuredClone(frame.rows);
  frame.send('acquire');
  assert.equal(frame.responses.length, 1);
  const snapshot = frame.responses[0]!;
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.token, token);
  assert.equal(snapshot.unfiltered, true);
  assert.equal(snapshot.name, 'Student Directory');
  assert.equal(snapshot.photoBaseUrl, 'https://example.myschoolapp.com/user/');
  assert.equal('directories' in snapshot, false);
  const record = (snapshot.records as Array<Record<string, unknown>>)[0]!;
  assert.equal(record.UserID, 101);
  assert.equal(record.Email, 'ada@example.test');
  assert.equal(record.PublishEmail, true);
  assert.equal(record.TotalCount, 1);
  assert.equal('AddressLine1' in record, false);
  assert.equal('PreferredAddressLat' in record, false);
  assert.equal('PreferredAddressLng' in record, false);
  assert.equal('MyContactsID' in record, false);
  assert.equal('HasRelationships' in record, false);
  assert.equal('UnexpectedObject' in record, false);
  assert.equal(JSON.stringify(snapshot).includes('EXCLUDED_'), false);
  assert.deepEqual(frame.rows, original);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  assert.equal(frame.view.getResults(), undefined);
  assert.equal(frame.view.getFacetValues(), undefined);
  assert.equal(frame.calls.length, 0);
});

test('metadata acquisition does not wait for or read records and keeps native methods usable', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  t.mock.method(frame.results, 'toJSON', () => { throw new Error('Metadata must not read directory records'); });
  frame.send('acquire', token, '438', 'metadata');
  const response = frame.responses[0]!;
  assert.equal(response.status, 'ready');
  assert.equal(response.mode, 'metadata');
  assert.equal('records' in response, false);
  assert.equal('unfiltered' in response, false);
  assert.equal(response.name, 'Student Directory');
  assert.equal('directories' in response, false);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.view.renderResults, frame.originalRender);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
  assert.equal(frame.view.getResults('still native'), 'native-results');
  assert.equal(frame.view.renderResults('still native'), 'native-render');
  assert.equal(frame.view.getFacetValues('still native'), 'native-facets');
  assert.equal(frame.errors.length, 0);
});

test('metadata waits for the verified heading and a canceled request cannot acquire when it appears later', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const header = frame.root.querySelector('#overview')!;
  header.remove();
  frame.send('acquire', token, '438', 'metadata');
  assert.equal(frame.responses.length, 0);
  frame.send('release');
  frame.root.prepend(header);
  t.mock.timers.tick(12_500);
  assert.equal(frame.responses.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  frame.send('acquire', nextToken, '438', 'metadata');
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), nextToken);
});

test('metadata waits for the native fallback collection without waiting for its records', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  Reflect.deleteProperty(frame.view, 'results');
  frame.send('acquire', token, '438', 'metadata');
  t.mock.timers.tick(300);
  assert.equal(frame.responses.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.view.getResults('native request during metadata wait'), 'native-results');
  frame.rows.length = 0;
  t.mock.method(frame.results, 'toJSON', () => { throw new Error('Metadata must not read the collection'); });
  frame.view.results = frame.results;
  t.mock.timers.tick(100);
  assert.equal(frame.responses.length, 1);
  assert.equal(frame.responses[0]!.status, 'ready');
  assert.equal(frame.responses[0]!.mode, 'metadata');
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.view.renderResults, frame.originalRender);
  assert.equal(frame.errors.length, 0);
});

test('explicit search-first metadata acquires without a collection and fallback never invents an initial results read', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.modelData.DefaultResults = false;
  Reflect.deleteProperty(frame.view, 'results');
  frame.facetRows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.send('acquire', token, '438', 'metadata');
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.responses.at(-1)!.searchOnly, true);
  assert.equal(frame.view.getResults, frame.originalResults);
  frame.send('activate');
  assert.equal(frame.responses.at(-1)!.status, 'active');
  const ui = frame.replacement();
  assert.equal(frame.view.getResults('hidden native search'), undefined);
  frame.send('release');
  assert.equal(frame.calls.length, 0);
  assert.equal(frame.view.results, undefined);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.renderResults, frame.originalRender);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.equal(frame.errors.length, 0);
});

test('DefaultResults true still waits for the native initial collection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.modelData.DefaultResults = true;
  Reflect.deleteProperty(frame.view, 'results');
  frame.send('acquire', token, '438', 'metadata');
  t.mock.timers.tick(300);
  assert.equal(frame.responses.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  frame.view.results = frame.results;
  t.mock.timers.tick(100);
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.responses.at(-1)!.searchOnly, false);
});

test('malformed DefaultResults cannot bypass native directory readiness or acquire ownership', () => {
  for (const value of ['false', 0, 1, null, [], {}]) {
    const frame = fixture();
    try {
      frame.modelData.DefaultResults = value;
      Reflect.deleteProperty(frame.view, 'results');
      frame.send('acquire', token, '438', 'metadata');
      assert.equal(frame.responses.at(-1)!.status, 'unsupported', JSON.stringify(value));
      assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
      assert.equal(frame.view.getResults, frame.originalResults);
      assert.equal(frame.view.renderResults, frame.originalRender);
      assert.equal(frame.calls.length, 0);
      assert.equal(frame.errors.length, 0);
    } finally { frame.close(); }
  }
});

test('metadata supports verified native directory views with any facet fields or an empty facet list', () => {
  for (const [name, fields] of [
    ['Students', ['student_grade']], ['Faculty', ['faculty_department']], ['Staff', ['department']],
    ['Parents', ['city', 'zip', 'child_grade_level']], ['Alumni', ['grad_year']], ['Custom Directory', []],
  ] as const) {
    const frame = fixture();
    try {
      frame.modelData.DirectoryName = name;
      frame.facetRows.splice(0, frame.facetRows.length, ...fields.map((FieldName) => ({ FieldName })));
      frame.rows.length = 0;
      frame.root.querySelector('#directory-items-container')!.remove();
      frame.send('acquire', token, '438', 'metadata');
      assert.equal(frame.responses.at(-1)!.status, 'ready', name);
      assert.equal(frame.responses.at(-1)!.name, name);
      assert.equal(frame.view.getResults, frame.originalResults, name);
      assert.equal(frame.view.renderResults, frame.originalRender, name);
      frame.send('activate');
      assert.equal(frame.responses.at(-1)!.status, 'active', name);
      assert.equal(frame.view.renderResults('native completion'), undefined, name);
      frame.send('release');
      assert.deepEqual(frame.calls.map((call) => call.method), ['render'], name);
      assert.equal(frame.view.getResults, frame.originalResults, name);
      assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false, name);
      assert.equal(frame.errors.length, 0, name);
    } finally { frame.close(); }
  }
});

test('malformed facet collection data keeps the original native directory usable', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  Object.defineProperty(frame.view.facets, 'toJSON', { value: () => ({ fields: [] }), configurable: true });
  frame.send('acquire', token, '438', 'metadata');
  assert.deepEqual(frame.responses.map((response) => response.status), ['unsupported']);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.view.renderResults, frame.originalRender);
});

test('activation pauses the current native work only after metadata and is idempotent', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire', token, '438', 'metadata');
  frame.send('activate', nextToken);
  frame.send('activate', token, '439');
  assert.equal(frame.responses.length, 1);
  assert.equal(frame.view.renderResults, frame.originalRender);
  frame.send('activate');
  assert.equal(frame.responses.at(-1)!.status, 'active');
  const wrapped = frame.view.renderResults;
  frame.send('activate');
  assert.equal(frame.view.renderResults, wrapped);
  assert.equal(frame.view.getResults(), undefined);
  assert.equal(frame.view.renderResults(), undefined);
  assert.equal(frame.view.getFacetValues(), undefined);
  assert.equal(frame.ownedList.scrollHandler(), undefined);
  assert.equal(frame.calls.length, 0);
});

test('metadata activation requires every core native method before installing any patches', () => {
  for (const missing of ['getResults', 'getFacetValues', 'renderResults'] as const) {
    const frame = fixture();
    try {
      const expected = {
        getResults: frame.originalResults,
        getFacetValues: frame.originalFacets,
        renderResults: frame.originalRender,
      };
      Reflect.deleteProperty(frame.view, missing);
      frame.send('acquire', token, '438', 'metadata');
      assert.equal(frame.responses.at(-1)!.status, 'ready', missing);
      frame.send('activate');
      assert.equal(frame.responses.at(-1)!.status, 'unavailable', missing);
      assert.equal(frame.responses.some((response) => response.status === 'active'), false, missing);
      assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false, missing);
      assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false, missing);
      for (const key of ['getResults', 'getFacetValues', 'renderResults'] as const) {
        assert.equal(frame.view[key], key === missing ? undefined : expected[key], `${missing}: ${key}`);
      }
      assert.equal(frame.prototype.scrollHandler, frame.originalScroll, missing);
      assert.equal(frame.calls.length, 0, missing);
      assert.equal(frame.errors.length, 0, missing);
    } finally { frame.close(); }
  }
});

test('explicit fallback replays the latest owed render and facet calls using the retained native collection', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const row = frame.rows[0]!;
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.send('acquire', token, '438', 'metadata');
  frame.send('activate');
  const ui = frame.replacement();
  // The already-started native GET succeeds after the enhanced view activates.
  frame.rows.push(row);
  frame.view.renderResults('older render');
  frame.view.renderResults('latest render', 2);
  frame.view.getFacetValues('latest facets');
  frame.view.getResults('hidden native search');
  assert.equal(frame.calls.length, 0);
  frame.send('release');
  assert.deepEqual(frame.calls.map(({ method, args }) => ({ method, args })), [
    { method: 'render', args: ['latest render', 2] }, { method: 'facets', args: ['latest facets'] },
  ]);
  assert.ok(frame.calls.every((call) => call.receiver === frame.view));
  assert.equal(frame.root.querySelector('#directory-results')!.textContent, 'Rendered 1 native rows');
  assert.equal(frame.view.renderResults, frame.originalRender);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(ui.isConnected, false);
  assert.notEqual(frame.page.getComputedStyle(frame.native).display, 'none');
  frame.send('release');
  assert.equal(frame.calls.length, 2);
});

test('fallback before native completion restores methods so the retained request renders normally later', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const row = frame.rows[0]!;
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.send('acquire', token, '438', 'metadata');
  frame.send('activate');
  frame.replacement();
  frame.send('release');
  assert.equal(frame.calls.length, 0);
  frame.rows.push(row);
  assert.equal(frame.view.renderResults('native GET completed'), 'native-render');
  assert.equal(frame.view.getFacetValues('native GET completed'), 'native-facets');
  assert.deepEqual(frame.calls.map((call) => call.method), ['render', 'facets']);
  assert.equal(frame.root.querySelector('#directory-results')!.textContent, 'Rendered 1 native rows');
});

test('route changes, replacement views, pagehide, and disposal never replay owed work for the old view', () => {
  for (const reason of ['route', 'view', 'pagehide', 'dispose'] as const) {
    const frame = fixture();
    try {
      frame.send('acquire', token, '438', 'metadata');
      frame.send('activate');
      const ui = frame.replacement();
      frame.view.renderResults('old render');
      frame.view.getFacetValues('old facets');
      if (reason === 'route') {
        frame.page.history.replaceState({}, '', '#profile/101/contactcard');
        frame.page.dispatchEvent(new frame.page.HashChangeEvent('hashchange'));
      }
      if (reason === 'view') {
        frame.app._currentMainView = { ...frame.view };
        frame.page.dispatchEvent(new frame.page.PopStateEvent('popstate'));
      }
      if (reason === 'pagehide') frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: true }));
      if (reason === 'dispose') frame.dispose();
      assert.equal(frame.calls.length, 0, reason);
      assert.equal(frame.view.renderResults, frame.originalRender, reason);
      assert.equal(frame.view.getFacetValues, frame.originalFacets, reason);
      assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false, reason);
      assert.equal(ui.isConnected, false, reason);
    } finally { frame.close(); }
  }
});

test('watchdog recovery replays owed native results and facets without another results request', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire', token, '438', 'metadata');
  frame.send('activate');
  const ui = frame.replacement();
  frame.view.renderResults('owed render');
  frame.view.getFacetValues('owed facets');
  t.mock.timers.tick(DIRECTORY_LEASE_LIFETIME + 2_000);
  assert.deepEqual(frame.calls.map((call) => call.method), ['render', 'facets']);
  assert.equal(frame.root.querySelector('#directory-results')!.textContent, 'Rendered 1 native rows');
  assert.equal(ui.isConnected, false);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
});

test('metadata activation refuses a replaced view or changed ownership without installing patches', () => {
  for (const reason of ['view', 'owner'] as const) {
    const frame = fixture();
    try {
      frame.send('acquire', token, '438', 'metadata');
      if (reason === 'view') frame.app._currentMainView = { ...frame.view };
      else frame.root.setAttribute(DIRECTORY_OWNER_ATTRIBUTE, nextToken);
      frame.send('activate');
      assert.equal(frame.responses.at(-1)!.status, 'released', reason);
      assert.equal(frame.responses.some((response) => response.status === 'active'), false, reason);
      assert.equal(frame.view.getResults, frame.originalResults, reason);
      assert.equal(frame.view.renderResults, frame.originalRender, reason);
      assert.equal(frame.prototype.scrollHandler, frame.originalScroll, reason);
    } finally { frame.close(); }
  }
});

test('failed activation rolls back partial patches while the metadata phase remains native', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  Object.defineProperty(frame.view, 'renderResults', { value: frame.originalRender, writable: false, configurable: true });
  frame.send('acquire', token, '438', 'metadata');
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.view.getResults, frame.originalResults);
  frame.send('activate');
  assert.equal(frame.responses.at(-1)!.status, 'unavailable');
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.view.renderResults, frame.originalRender);
  assert.equal(frame.errors.length, 0);
});

test('replacing a same-view lease recovers owed native work before metadata takes ownership', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire', token, '438', 'metadata');
  frame.send('activate');
  frame.view.renderResults('old render');
  frame.view.getFacetValues('old facets');
  frame.send('acquire', nextToken, '438', 'metadata');
  assert.deepEqual(frame.calls.map((call) => call.method), ['render', 'facets']);
  assert.deepEqual(frame.responses.map((response) => response.status), ['ready', 'active', 'released', 'ready']);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), nextToken);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.renderResults, frame.originalRender);
});

test('the prototype scroll patch suppresses only the acquired list and forwards other instances with their arguments', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const unrelatedRoot = frame.page.document.createElement('div');
  frame.page.document.body.append(unrelatedRoot);
  const outside = Object.assign(Object.create(frame.prototype) as Receiver & typeof frame.prototype, { el: unrelatedRoot, collection: frame.results });
  const otherCollection = Object.assign(Object.create(frame.prototype) as Receiver & typeof frame.prototype, { el: frame.ownedList.el, collection: { length: 0, toJSON: () => [] } });
  assert.equal(frame.ownedList.scrollHandler('owned'), undefined);
  assert.equal(outside.scrollHandler('outside', 2), 'native-scroll');
  assert.equal(otherCollection.scrollHandler('other collection'), 'native-scroll');
  assert.deepEqual(frame.calls.map((call) => ({ method: call.method, args: call.args })), [
    { method: 'scroll', args: ['outside', 2] }, { method: 'scroll', args: ['other collection'] },
  ]);
  assert.equal(frame.calls[0]!.receiver, outside);
  assert.equal(frame.calls[1]!.receiver, otherCollection);
  frame.send('release');
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
  assert.equal(frame.ownedList.scrollHandler(), 'native-scroll');
});

test('release restores original method descriptors and removes inherited-method shadows', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  Object.defineProperty(frame.view, 'getResults', { value: frame.originalResults, writable: true, configurable: true, enumerable: false });
  const inherited = { getFacetValues: frame.originalFacets };
  Object.setPrototypeOf(frame.view, inherited);
  Reflect.deleteProperty(frame.view, 'getFacetValues');
  const originalDescriptor = Object.getOwnPropertyDescriptor(frame.view, 'getResults');
  frame.send('acquire');
  assert.equal(Object.hasOwn(frame.view, 'getFacetValues'), true);
  assert.notEqual(frame.view.getResults, frame.originalResults);
  frame.send('release');
  assert.deepEqual(Object.getOwnPropertyDescriptor(frame.view, 'getResults'), originalDescriptor);
  assert.equal(Object.hasOwn(frame.view, 'getFacetValues'), false);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.view.getFacetValues('restored'), 'native-facets');
});

test('release leaves newer native or third-party patches intact', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const newerResults: Method = () => 'newer results';
  const newerScroll: Method = () => 'newer scroll';
  frame.view.getResults = newerResults;
  frame.prototype.scrollHandler = newerScroll;
  frame.send('release');
  assert.equal(frame.view.getResults, newerResults);
  assert.equal(frame.prototype.scrollHandler, newerScroll);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
});

test('invalid view, route, model, module, and root identities release before forwarding a native call', () => {
  for (const reason of ['view', 'route', 'model', 'module', 'root'] as const) {
    const frame = fixture();
    try {
      frame.send('acquire');
      const ui = frame.replacement();
      const wrapped = frame.view.getResults;
      if (reason === 'view') frame.app._currentMainView = { ...frame.view };
      if (reason === 'route') frame.dom.reconfigure({ url: directoryUrl.replace('#directory/438', '#directory/439') });
      if (reason === 'model') frame.modelData.DirectoryId = '439';
      if (reason === 'module') frame.moduleData.directoryId = '439';
      if (reason === 'root') frame.root.remove();
      assert.equal(wrapped.call(frame.view, reason, 2), 'native-results', reason);
      assert.equal(frame.calls.at(-1)!.receiver, frame.view, reason);
      assert.deepEqual(frame.calls.at(-1)!.args, [reason, 2], reason);
      assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false, reason);
      assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false, reason);
      assert.equal(ui.isConnected, false, reason);
      assert.equal(frame.prototype.scrollHandler, frame.originalScroll, reason);
    } finally { frame.close(); }
  }
});

test('direct release synchronously reveals native controls and removes only owned replacement UI', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const ui = frame.replacement();
  const outsideUi = frame.page.document.createElement('div');
  outsideUi.setAttribute(DIRECTORY_UI_ATTRIBUTE, 'another view');
  frame.page.document.body.append(outsideUi);
  assert.equal(frame.page.getComputedStyle(frame.native).display, 'none');
  frame.send('release');
  assert.notEqual(frame.page.getComputedStyle(frame.native).display, 'none');
  assert.equal(ui.isConnected, false);
  assert.equal(outsideUi.isConnected, true);
  assert.equal(frame.root.querySelector('#native-directory-picker')!.isConnected, true);
  assert.equal(frame.responses.at(-1)!.status, 'released');
  const responses = frame.responses.length;
  frame.send('release');
  assert.equal(frame.responses.length, responses);
});

test('a matching lease release restores native UI even after the current URL has already changed', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const ui = frame.replacement();
  // pushState does not emit hashchange, so cleanup must not depend on a later
  // navigation event or watchdog tick to accept the previous lease's release.
  frame.page.history.pushState({}, '', directoryUrl.replace('#directory/438', '#directory/439'));
  frame.send('release');
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.notEqual(frame.page.getComputedStyle(frame.native).display, 'none');
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
});

test('invalid facet metadata and malformed or unrelated requests cannot pause native methods', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const originalFacetsData = frame.view.facets.toJSON;
  Object.defineProperty(frame.view.facets, 'toJSON', { value: () => null, configurable: true });
  frame.send('acquire');
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
  Object.defineProperty(frame.view.facets, 'toJSON', { value: originalFacetsData, configurable: true });
  for (const detail of [
    null, {}, 'not JSON', 'null', '[]', 'x'.repeat(501),
    JSON.stringify({ action: 'acquire', token: 'short', directoryId: '438' }),
    JSON.stringify({ action: 'unknown', token, directoryId: '438' }),
    JSON.stringify({ action: 'acquire', token, directoryId: '438', mode: 'unknown' }),
    JSON.stringify({ action: 'acquire', token, directoryId: '-438' }),
    JSON.stringify({ action: 'acquire', token, directoryId: '439' }),
  ]) frame.sendRaw(detail);
  assert.equal(frame.responses.length, 1);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  frame.send('acquire');
  frame.send('release', nextToken);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  assert.equal(frame.view.getResults(), undefined);
  assert.equal(frame.errors.length, 0);
});

test('pending acquisition can be canceled and cannot publish or pause a later loaded view', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const row = frame.rows[0]!;
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.send('acquire');
  assert.equal(frame.responses.length, 0);
  frame.send('release');
  frame.rows.push(row);
  t.mock.timers.tick(15_000);
  assert.equal(frame.responses.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.view.getResults, frame.originalResults);
  frame.send('acquire', nextToken);
  assert.equal(frame.responses.at(-1)!.token, nextToken);
  assert.equal(frame.responses.at(-1)!.status, 'ready');
});

test('Back preserves a pending destination acquisition across paired popstate and hashchange events', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const row = frame.rows[0]!;
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.dom.reconfigure({ url: directoryUrl.replace('#directory/438', '#profile/101/contactcard') });
  frame.page.history.replaceState({}, '', directoryUrl);
  frame.page.dispatchEvent(new frame.page.PopStateEvent('popstate'));
  // The isolated runtime mounts the destination during its popstate callback,
  // while Blackbaud's native view is still waiting for its results.
  frame.send('acquire');
  assert.equal(frame.responses.length, 0);
  frame.page.dispatchEvent(new frame.page.HashChangeEvent('hashchange', {
    oldURL: directoryUrl.replace('#directory/438', '#profile/101/contactcard'), newURL: directoryUrl,
  }));
  frame.rows.push(row);
  t.mock.timers.tick(100);
  assert.equal(frame.responses.length, 1);
  assert.equal(frame.responses[0]!.status, 'ready');
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  assert.equal(frame.view.getResults(), undefined);
});

test('Back preserves an already acquired destination and its UI across the second navigation notification', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.page.dispatchEvent(new frame.page.PopStateEvent('popstate'));
  frame.send('acquire');
  const ui = frame.replacement();
  const wrapped = frame.view.getResults;
  frame.page.dispatchEvent(new frame.page.HashChangeEvent('hashchange', {
    oldURL: directoryUrl.replace('#directory/438', '#profile/101/contactcard'), newURL: directoryUrl,
  }));
  assert.deepEqual(frame.responses.map((response) => response.status), ['ready']);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), true);
  assert.equal(ui.isConnected, true);
  assert.equal(frame.view.getResults, wrapped);
  assert.equal(frame.view.getResults(), undefined);
});

test('navigation to another route cancels a pending acquisition and releases an active lease', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const row = frame.rows[0]!;
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.send('acquire');
  frame.page.history.replaceState({}, '', '#profile/101/contactcard');
  frame.page.dispatchEvent(new frame.page.PopStateEvent('popstate'));
  frame.rows.push(row);
  t.mock.timers.tick(15_000);
  assert.equal(frame.responses.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);

  frame.page.history.replaceState({}, '', '#directory/438');
  frame.send('acquire', nextToken);
  const ui = frame.replacement();
  frame.page.history.replaceState({}, '', '#directory/439');
  frame.page.dispatchEvent(new frame.page.HashChangeEvent('hashchange'));
  assert.deepEqual(frame.responses.map((response) => response.status), ['ready', 'released']);
  assert.equal(frame.responses.at(-1)!.token, nextToken);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
});

test('same-URL navigation still releases an acquired view when Blackbaud replaces its native instance', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const ui = frame.replacement();
  frame.app._currentMainView = { ...frame.view };
  frame.page.dispatchEvent(new frame.page.PopStateEvent('popstate'));
  assert.equal(frame.responses.at(-1)!.status, 'released');
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
});

test('pagehide cancels pending work and BFCache restoration can acquire a fresh lease', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const ui = frame.replacement();
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.equal(frame.view.getResults, frame.originalResults);
  const row = frame.rows[0]!;
  frame.rows.length = 0;
  frame.root.querySelector('#directory-items-container')!.remove();
  frame.send('acquire', nextToken);
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: true }));
  frame.rows.push(row);
  t.mock.timers.tick(12_500);
  assert.equal(frame.responses.filter((response) => response.token === nextToken).length, 0);
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: true }));
  frame.send('acquire', nextToken);
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), nextToken);
});

test('heartbeat renewal and watchdog expiry bound ownership and restore visible native UI', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const ui = frame.replacement();
  t.mock.timers.tick(DIRECTORY_LEASE_LIFETIME - 2_000);
  frame.send('heartbeat');
  t.mock.timers.tick(4_000);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  frame.send('heartbeat', nextToken);
  t.mock.timers.tick(DIRECTORY_LEASE_LIFETIME);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.notEqual(frame.page.getComputedStyle(frame.native).display, 'none');
  assert.equal(frame.view.getResults(), 'native-results');
});

test('hidden timer throttling does not expire ownership until visibility returns', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  Object.defineProperty(frame.page.document, 'visibilityState', { configurable: true, value: 'hidden' });
  frame.send('acquire');
  const ui = frame.replacement();
  t.mock.timers.tick(DIRECTORY_LEASE_LIFETIME + 4_000);
  assert.equal(frame.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE), token);
  Object.defineProperty(frame.page.document, 'visibilityState', { configurable: true, value: 'visible' });
  frame.page.document.dispatchEvent(new frame.page.Event('visibilitychange'));
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.notEqual(frame.page.getComputedStyle(frame.native).display, 'none');
});

test('failed method patching rolls back earlier patches and retains the usable native directory', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  Object.defineProperty(frame.view, 'getFacetValues', { value: frame.originalFacets, writable: false, configurable: true });
  frame.send('acquire');
  assert.equal(frame.errors.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.view.getResults, frame.originalResults);
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
  assert.equal(frame.view.getResults(), 'native-results');
});

test('a failed method restoration cannot prevent native visibility or other method restoration', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('acquire');
  const ui = frame.replacement();
  const wrapped = frame.view.getResults;
  Object.defineProperty(frame.view, 'getResults', { value: wrapped, writable: false, configurable: false });
  frame.send('release');
  assert.equal(frame.errors.length, 0);
  assert.equal(frame.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.notEqual(frame.page.getComputedStyle(frame.native).display, 'none');
  assert.equal(frame.view.getFacetValues, frame.originalFacets);
  assert.equal(frame.prototype.scrollHandler, frame.originalScroll);
  assert.equal(frame.view.getResults(), 'native-results');
});
