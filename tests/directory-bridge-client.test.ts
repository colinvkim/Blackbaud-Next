import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { acquireDirectory, DirectoryUnsupportedError } from '../src/blackbaud/directory-bridge.ts';
import { installDirectoryPageBridge } from '../src/blackbaud/directory-page.ts';
import { createDirectoryLoadingManager, registerDirectoryLoadingManager } from '../src/blackbaud/directory-loading.ts';
import { prepareDirectorySnapshot } from '../src/blackbaud/directory.ts';
import type { DirectoryPreparedSnapshot } from '../src/blackbaud/directory.ts';
import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_OWNER_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../src/blackbaud/directory-protocol.ts';
import type { Cleanup } from '../src/shared/types.ts';

let dom: JSDOM | undefined;
const cleanups: Cleanup[] = [];
const target = { directoryId: '123', origin: 'https://example.myschoolapp.com' };
const row = (id = 1, total = 1) => ({ UserID: id, FirstName: 'Ada', LastName: 'Example', UserNameFormatted: 'Ada Example', PublishUserProfile: true, PublishEmail: true, EmailBad: false, Email: 'ada@example.org', GradeDisplay: '9', TotalCount: total });

function fixture(records: unknown[] = [row()], rendered = true) {
  dom = new JSDOM(`<main id="site-main"><div><header id="overview">Student Directory</header><div id="directory-results">${rendered ? '<table id="directory-items-container"></table>' : ''}</div></div></main>`, { url: `${target.origin}/app/student#directory/${target.directoryId}` });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  cleanups.push(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const root = dom.window.document.querySelector<HTMLElement>('#site-main > div')!;
  const data = { directoryId: 123, searchVal: '', searchFacets: [] as string[], searchAllFields: false };
  let calls = 0;
  const getResults = () => { calls += 1; };
  const modelData: Record<string, unknown> = { DirectoryId: 123, DirectoryName: 'Students' };
  const view = {
    el: root, template: 'directory/directory.template.html',
    model: { get: (key: string): unknown => modelData[key] },
    results: { length: records.length, toJSON: () => records },
    facets: { length: 1, toJSON: () => [{ FieldName: 'student_grade' }] },
    getResults, getFacetValues() {}, renderResults() {},
  };
  Object.defineProperty(dom.window, 'p3', { configurable: true, value: {
    _currentMainView: view, _modules: { 'shared/directory': { Data: data } },
  } });
  cleanups.push(installDirectoryPageBridge(dom.window as unknown as Window & typeof globalThis));
  return { page: dom.window, root, view, modelData, data, getResults, calls: () => calls };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  dom?.window.close();
  dom = undefined;
});

test('isolated acquisition validates one direct read with native metadata, then synchronously restores native mode', async (t) => {
  const native = fixture();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => { reads += 1; return new Response(JSON.stringify([row()])); });
  const controller = new AbortController();
  const lease = await acquireDirectory(target, controller.signal);
  assert.equal(lease.root, native.root);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(lease.snapshot.entries[0]?.email, 'ada@example.org');
  assert.equal(reads, 1);
  assert.equal('directories' in lease, false);
  native.view.getResults();
  assert.equal(native.calls(), 0);
  native.root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, '');
  const ui = document.createElement('section');
  ui.setAttribute(DIRECTORY_UI_ATTRIBUTE, '');
  native.root.append(ui);
  lease.release();
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(native.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(ui.isConnected, false);
  assert.equal(native.view.getResults, native.getResults);
  assert.equal(lease.signal.aborted, false);
});

test('a prefiltered native view loads one complete blank-query snapshot asynchronously', async (t) => {
  const native = fixture();
  native.data.searchVal = 'Ada';
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify([row(1, 2), { ...row(2, 2), FirstName: 'Grace', Email: 'grace@example.org' }]));
  });
  const lease = await acquireDirectory(target, new AbortController().signal);
  cleanups.push(lease.release);
  assert.equal(lease.snapshot.totalCount, 2);
  assert.deepEqual(requests, ['/api/directory/directoryresultsget?directoryId=123&searchVal=&facets=&searchAll=false']);
});

test('a malformed direct snapshot fails closed without pausing native methods', async (t) => {
  const native = fixture([row(1, 3)]);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([row(1, 0)])));
  await assert.rejects(acquireDirectory(target, new AbortController().signal), /incomplete|unsupported/);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(native.view.getResults, native.getResults);
});

test('a capped native directory snapshot retains its reported total through acquisition and fallback', async (t) => {
  const native = fixture();
  const rows = [row(1, 5), { ...row(2, 0), FirstName: 'Grace', Email: 'grace@example.org' }];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(rows)));
  native.view.facets.toJSON = () => [{ FieldName: 'child_grade_level' }];
  native.modelData.DirectoryName = 'Parents';
  const lease = await acquireDirectory(target, new AbortController().signal);
  cleanups.push(lease.release);
  assert.equal(lease.name, 'Parents');
  assert.equal(lease.snapshot.totalCount, 2);
  assert.equal(lease.snapshot.reportedTotalCount, 5);
  assert.equal(lease.snapshot.complete, false);
  assert.deepEqual(lease.snapshot.entries.map((entry) => entry.userId), [1, 2]);
  native.view.getResults();
  assert.equal(native.calls(), 0);
  lease.release();
  assert.equal(native.view.getResults, native.getResults);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  native.view.getResults();
  assert.equal(native.calls(), 1);
});

test('an empty search-first directory signals server search without an initial native collection', async (t) => {
  const native = fixture([], false);
  native.modelData.DefaultResults = false;
  native.modelData.DirectoryName = 'Search Directory';
  Reflect.deleteProperty(native.view, 'results');
  native.view.facets.toJSON = () => [];
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads += 1;
    return new Response(JSON.stringify([]));
  });
  const lease = await acquireDirectory(target, new AbortController().signal);
  cleanups.push(lease.release);
  assert.equal(lease.searchOnly, true);
  assert.equal(lease.name, 'Search Directory');
  assert.equal(lease.snapshot.totalCount, 0);
  assert.equal(lease.snapshot.reportedTotalCount, 0);
  assert.equal(lease.snapshot.complete, false);
  assert.equal(reads, 1);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), true);
  lease.release();
  assert.equal(native.view.results, undefined);
  assert.equal(native.view.getResults, native.getResults);
  assert.equal(native.calls(), 0);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
});

for (const blankRead of ['failed', 'pending'] as const) {
  test(`native search-first metadata acquires without depending on a ${blankRead} blank results read`, async (t) => {
    const native = fixture();
    native.modelData.DefaultResults = false;
    Reflect.deleteProperty(native.view, 'results');
    let readSignal: AbortSignal | undefined;
    t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, options?: RequestInit) => {
      readSignal = options!.signal as AbortSignal;
      if (blankRead === 'failed') return Promise.resolve(new Response('Unavailable', { status: 503 }));
      return new Promise<Response>((_resolve, reject) => readSignal!.addEventListener('abort', () => reject(readSignal!.reason), { once: true }));
    });
    const lease = await acquireDirectory(target, new AbortController().signal);
    cleanups.push(lease.release);
    assert.equal(lease.searchOnly, true);
    assert.deepEqual(lease.snapshot, { entries: [], totalCount: 0, reportedTotalCount: 0, complete: false });
    assert.equal(readSignal?.aborted, true);
    assert.equal(native.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) !== null, true);
    assert.equal(native.view.getResults(), undefined);
    lease.release();
    assert.equal(native.view.getResults, native.getResults);
    assert.equal(native.calls(), 0);
  });
}

test('a malformed search-first flag fails closed without pausing the original view', async (t) => {
  const native = fixture([], false);
  native.modelData.DefaultResults = 'false';
  Reflect.deleteProperty(native.view, 'results');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([])));
  await assert.rejects(acquireDirectory(target, new AbortController().signal), DirectoryUnsupportedError);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(native.view.getResults, native.getResults);
  assert.equal(native.calls(), 0);
});

for (const [name, fields] of [
  ['Faculty', ['faculty_department']], ['Staff', ['department']], ['Parents', ['city', 'zip', 'child_grade_level']],
  ['Alumni', ['grad_year']], ['Custom Directory', []],
] as const) {
  test(`${name} can acquire a complete published snapshot through the shared native view`, async (t) => {
    const native = fixture();
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{ ...row(), GradeDisplay: '' }])));
    native.view.facets.toJSON = () => fields.map((FieldName) => ({ FieldName }));
    native.modelData.DirectoryName = name;
    const lease = await acquireDirectory(target, new AbortController().signal);
    cleanups.push(lease.release);
    assert.equal(lease.name, name);
    assert.equal(lease.snapshot.totalCount, 1);
    assert.equal(lease.snapshot.entries[0]!.email, 'ada@example.org');
    assert.equal(lease.snapshot.entries[0]!.grade, '');
    assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), true);
    assert.notEqual(native.view.getResults, native.getResults);
    lease.release();
    assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
    assert.equal(native.view.getResults, native.getResults);
  });
}

test('an empty native collection cannot turn old mounted rows into a false empty directory', async (t) => {
  fixture([], true);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response(JSON.stringify([row()]));
  });
  const lease = await acquireDirectory(target, new AbortController().signal);
  cleanups.push(lease.release);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(requests, 1);
});

test('cancellation while a direct read is pending releases metadata ownership and aborts the read', async (t) => {
  const native = fixture([], false);
  let readSignal: AbortSignal | null = null;
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    readSignal = options?.signal as AbortSignal;
    readSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const controller = new AbortController();
  const loading = acquireDirectory(target, controller.signal);
  controller.abort();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal((readSignal as AbortSignal | null)?.aborted, true);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
});

test('unexpected native navigation invalidates a lease and reveals native controls', async (t) => {
  const native = fixture();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([row()])));
  const lease = await acquireDirectory(target, new AbortController().signal);
  native.root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, '');
  native.page.history.replaceState(null, '', '#directory/456');
  native.page.dispatchEvent(new native.page.Event('hashchange'));
  assert.equal(lease.signal.aborted, true);
  assert.equal(native.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(native.view.getResults, native.getResults);
});

test('a view change aborts an in-flight filtered snapshot read before it can mount', async (t) => {
  const native = fixture();
  native.data.searchVal = 'Ada';
  let readSignal: AbortSignal | null = null;
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    readSignal = options?.signal as AbortSignal;
    readSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const loading = acquireDirectory(target, new AbortController().signal);
  for (let count = 0; count < 6; count++) await Promise.resolve();
  native.page.dispatchEvent(new native.page.Event('pagehide'));
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal((readSignal as AbortSignal | null)?.aborted, true);
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
});

test('metadata becomes ready before the native collection and leaves native loading usable until direct data is prepared', async (t) => {
  const native = fixture([], false);
  let finishRead: ((response: Response) => void) | null = null;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((resolve) => { finishRead = resolve; }));
  const loading = acquireDirectory(target, new AbortController().signal);
  for (let count = 0; count < 6; count++) await Promise.resolve();
  assert.equal(native.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), true);
  assert.equal(native.root.hasAttribute(DIRECTORY_NATIVE_ATTRIBUTE), false);
  assert.equal(native.view.getResults, native.getResults);
  native.view.getResults();
  assert.equal(native.calls(), 1);
  (finishRead as unknown as (response: Response) => void)(new Response(JSON.stringify([row()])));
  const lease = await loading;
  cleanups.push(lease.release);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(native.view.results.length, 0);
  native.view.getResults();
  assert.equal(native.calls(), 1);
});

test('acquisition consumes the click-captured prepared read without a second extension request', async (t) => {
  const native = fixture([], false);
  const destination = new URL(native.page.location.href);
  native.page.history.replaceState(null, '', '#studentmyday/progress');
  const source = new URL(native.page.location.href);
  let reads = 0;
  let finishRead: ((prepared: DirectoryPreparedSnapshot) => void) | null = null;
  const manager = createDirectoryLoadingManager(() => {
    reads += 1;
    return new Promise<DirectoryPreparedSnapshot>((resolve) => { finishRead = resolve; });
  });
  cleanups.push(registerDirectoryLoadingManager(manager));
  assert.equal(manager.start(target, source, destination), true);
  native.page.history.replaceState(null, '', destination);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected duplicate extension read'); });
  const loading = acquireDirectory(target, new AbortController().signal);
  (finishRead as unknown as (prepared: DirectoryPreparedSnapshot) => void)(prepareDirectorySnapshot([row()], target.origin));
  const lease = await loading;
  cleanups.push(lease.release);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(reads, 1);
});

test('unsupported metadata aborts the parallel direct read instead of leaving an orphaned request', async (t) => {
  const native = fixture();
  Object.defineProperty(native.view.facets, 'toJSON', { value: () => ({ fields: [] }), configurable: true });
  let readSignal: AbortSignal | null = null;
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    readSignal = options?.signal as AbortSignal;
    readSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  await assert.rejects(acquireDirectory(target, new AbortController().signal), DirectoryUnsupportedError);
  assert.equal((readSignal as AbortSignal | null)?.aborted, true);
  assert.equal(native.view.getResults, native.getResults);
});
