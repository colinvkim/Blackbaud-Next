import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installIndependentDirectoryPageBridge } from '../src/blackbaud/directory-independent-page.ts';
import { startNativeDirectory } from '../src/blackbaud/directory-native-startup.ts';
import { DIRECTORY_OWNER_ATTRIBUTE } from '../src/blackbaud/directory-protocol.ts';
import { INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_GATE_LIFETIME, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, INDEPENDENT_DIRECTORY_REQUEST_EVENT, INDEPENDENT_DIRECTORY_RESPONSE_EVENT, independentDirectoryRequest } from '../src/blackbaud/directory-independent-protocol.ts';

const gate = 'independent-directory-gate-01';
const request = 'independent-directory-read-01';
const other = 'independent-directory-other-01';

function fixture() {
  const dom = new JSDOM('<main id="site-main"><section>Progress</section></main>', {
    url: 'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/progress', pretendToBeVisual: true,
  });
  const page = dom.window as unknown as Window & typeof globalThis;
  const main = page.document.getElementById('site-main')!;
  const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
  const lifecycle: string[] = [];
  const directories: unknown[] = [{ DirectoryID: 438, DirectoryName: 'Students' }, { DirectoryID: 912, DirectoryName: 'Custom Coaches' }];
  class View {
    el = page.document.createElement('section');
    template?: string;
    model?: { get(key: string): unknown };
    Page?: { name: string; dispose(): void };
    render?(): View;
    dispose?(): void;
    remove() { lifecycle.push('remove'); this.el.remove(); }
    off() { lifecycle.push('off'); }
  }
  interface FetchOptions {
    data: { directoryId: unknown };
    success: (...args: unknown[]) => unknown;
    error: (...args: unknown[]) => unknown;
  }
  let deferMetadata = false;
  const metadata: Array<{ options: FetchOptions; aborted: boolean }> = [];
  class Model {
    private readonly attributes: Record<string, unknown>;
    constructor(attributes: Record<string, unknown>) { this.attributes = attributes; }
    get(key: string) { return this.attributes[key]; }
    fetch(options: FetchOptions) {
      const read = { options, aborted: false };
      metadata.push(read);
      if (!deferMetadata) options.success();
      return { abort() { read.aborted = true; options.error(); } };
    }
  }
  class DirectoryModel extends Model {}
  const previous = new View();
  previous.el = main.firstElementChild as HTMLElement;
  previous.Page = { name: 'native-progress', dispose: () => lifecycle.push('previous-page-dispose') };
  const original = function (this: unknown, ...args: unknown[]) {
    calls.push({ receiver: this, args });
    if (module.Data.directoryId !== args[0]) {
      module.Data.searchVal = '';
      module.Data.searchFacets = [];
      module.Data.searchRun = false;
      module.Data.directoryId = args[0];
      module.Data.viewType = -1;
    }
    const model = new module.Ms.Directory({ DirectoryId: args[0] });
    model.fetch({
      data: { directoryId: args[0] },
      success: () => {
        const native = new View();
        native.template = 'directory/directory.template.html';
        native.model = model;
        native.Page = { name: 'native-directory', dispose() {} };
        native.el.textContent = 'Native directory';
        app.renderMainPage(native);
      },
      error: () => lifecycle.push('native-directory-error'),
    });
    return 'native-result';
  };
  const owner = { renderDirectory: original };
  const module = { Data: { directoryId: null as unknown, searchVal: '' as unknown, searchFacets: [] as unknown, searchRun: false as unknown, viewType: -1 as unknown },
    Us: owner, Ms: { Directory: DirectoryModel }, Vs: { Directory: function () {} } };
  const app = {
    _currentMainView: previous,
    _modules: { 'shared/directory': module },
    Layout: { Containers: { MainPage: { 0: main } } },
    Data: { Context: { get: (key: string) => key === 'Directories' ? directories : undefined } },
    Config: { PhotonForUserPhotoUrl: 'https://example.myschoolapp.com/user/' },
    renderMainPage(view: View) {
      const before = this._currentMainView;
      if (before.Page && view.Page && before.Page.name !== view.Page.name) before.Page.dispose();
      if (main.childElementCount > 0) {
        before.remove();
        before.off();
        before.dispose?.();
      }
      main.replaceChildren();
      if (view.render) view.render(); else main.append(view.el);
      this._currentMainView = view;
      lifecycle.push('render-main-page');
    },
  };
  Object.defineProperty(page, 'p3', { value: app, writable: true, configurable: true });
  Object.defineProperty(page, 'Bb', { value: { View }, writable: true, configurable: true });
  const responses: Array<Record<string, unknown>> = [];
  page.document.addEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, (event) => {
    responses.push(JSON.parse((event as CustomEvent).detail));
  });
  const send = (action: string, token = gate, directoryId?: string) => page.document.dispatchEvent(new page.CustomEvent(INDEPENDENT_DIRECTORY_REQUEST_EVENT, {
    detail: JSON.stringify({ action, token, ...(directoryId ? { directoryId } : {}) }),
  }));
  const bridge = installIndependentDirectoryPageBridge(page);
  const navigate = (id = '438', args: unknown[] = [id], receiver: unknown = owner) => {
    page.location.hash = `#directory/${id}`;
    return owner.renderDirectory.apply(receiver, args);
  };
  const lease = () => String(responses.filter((value) => value.status === 'shell').at(-1)?.token);
  const root = () => main.firstElementChild as HTMLElement;
  return { page, dom, app, main, owner, module, directories, calls, lifecycle, responses, send, navigate, lease, root, bridge, View, DirectoryModel, metadata,
    deferMetadata: () => { deferMetadata = true; },
    original, close() { bridge(); dom.window.close(); } };
}

test('protocol validates bounded actions and requires a positive directory only for lease actions', () => {
  assert.deepEqual(independentDirectoryRequest(JSON.stringify({ action: 'enable', token: gate })), { action: 'enable', token: gate });
  assert.deepEqual(independentDirectoryRequest(JSON.stringify({ action: 'acquire', token: request, directoryId: '912' })), { action: 'acquire', token: request, directoryId: '912' });
  for (const input of [null, {}, 'null', '[]', '{', JSON.stringify({ action: 'enable', token: 'short' }),
    JSON.stringify({ action: 'disable', token: gate, directoryId: '438' }),
    JSON.stringify({ action: 'acquire', token: request }),
    JSON.stringify({ action: 'original', token: gate, directoryId: '-1' }),
    JSON.stringify({ action: 'original', token: gate, directoryId: '000438' }),
    JSON.stringify({ action: 'original', token: gate, directoryId: '9007199254740992' }),
    JSON.stringify({ action: 'eval', token: gate, directoryId: '438' })]) assert.equal(independentDirectoryRequest(input), null);
});

test('enabled startup mounts the lightweight shell through the native lifecycle without running native startup', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  assert.equal(frame.responses.at(-1)!.status, 'enabled');
  frame.navigate();
  assert.equal(frame.calls.length, 0);
  assert.equal(frame.root().getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), '438');
  assert.equal(frame.root().getAttribute(DIRECTORY_OWNER_ATTRIBUTE), frame.lease());
  assert.equal(frame.root().querySelector(':scope > #overview h1')?.textContent, 'Students');
  assert.equal(frame.root().querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}] p`)?.textContent, 'Loading directory…');
  assert.deepEqual(frame.lifecycle, ['previous-page-dispose', 'remove', 'off', 'render-main-page']);
  assert.equal(frame.app._currentMainView.template, 'blackbaud-next/directory');
  assert.equal(frame.app._currentMainView.Page?.name, 'blackbaud-next-directory');
  frame.send('acquire', request, '438');
  assert.deepEqual(frame.responses.at(-1), {
    token: request, status: 'ready', directoryId: '438', leaseToken: frame.lease(),
    name: 'Students', photoBaseUrl: 'https://example.myschoolapp.com/user/',
  });
  assert.equal('records' in frame.responses.at(-1)!, false);
});

test('an early gate waits for the first authorized native route before creating its directory shell', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const context = frame.app.Data;
  frame.main.remove();
  frame.main.replaceChildren();
  Object.defineProperty(frame.app, '_currentMainView', { value: undefined, writable: true, configurable: true });
  Object.defineProperty(frame.app, 'Data', { value: undefined, writable: true, configurable: true });
  frame.page.history.replaceState({}, '', '#directory/438');
  frame.send('enable');
  assert.deepEqual(frame.responses.at(-1), { token: gate, status: 'enabled' });
  frame.send('acquire', request, '438');
  t.mock.timers.tick(100);
  assert.equal(frame.responses.some((value) => value.token === request), false);
  frame.page.document.body.append(frame.main);
  frame.app.Data = context;
  Object.defineProperty(frame.app, '_currentMainView', { value: false, writable: true, configurable: true });
  frame.owner.renderDirectory('438');
  assert.equal(frame.calls.length, 0);
  assert.equal(frame.metadata.length, 0);
  assert.equal(frame.app._currentMainView.template, 'blackbaud-next/directory');
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.responses.at(-1)!.token, request);
});

test('startup readiness timeout prevents a late native callback from creating an ownerless shell', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  const context = frame.app.Data;
  frame.main.remove();
  Object.defineProperty(frame.app, 'Data', { value: undefined, writable: true, configurable: true });
  frame.page.history.replaceState({}, '', '#directory/438');
  frame.send('acquire', request, '438');
  t.mock.timers.tick(100);
  assert.equal(frame.responses.some((value) => value.token === request), false);
  t.mock.timers.tick(2_000);
  assert.deepEqual(frame.responses.slice(-2), [
    { token: gate, status: 'unsupported' },
    { token: request, status: 'unsupported', directoryId: '438' },
  ]);
  frame.page.document.body.append(frame.main);
  frame.app.Data = context;
  frame.navigate();
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
  assert.equal(frame.responses.some((value) => value.status === 'shell'), false);
});

test('unsupported initial view values forward startup without calling renderMainPage early', () => {
  for (const value of [undefined, null, true, 0, 1, 'native']) {
    const frame = fixture();
    try {
      frame.send('enable');
      frame.deferMetadata();
      Object.defineProperty(frame.app, '_currentMainView', { value, writable: true, configurable: true });
      let renders = 0;
      frame.app.renderMainPage = () => { renders++; throw new Error('Native startup has not initialized its view.'); };
      assert.equal(frame.navigate(), 'native-result');
      assert.equal(frame.calls.length, 1);
      assert.equal(frame.metadata.length, 1);
      assert.equal(renders, 0);
    } finally { frame.close(); }
  }
});

test('a current native directory is never replaced by acquisition when the gate missed startup', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.navigate();
  const native = frame.app._currentMainView;
  frame.send('enable');
  frame.send('acquire', request, '438');
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
  assert.equal(frame.app._currentMainView, native);
  assert.equal(frame.calls.length, 1);
});

test('acquisition before the native route callback waits for its independent shell instead of falling back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.page.location.hash = '#directory/438';
  frame.send('acquire', request, '438');
  t.mock.timers.tick(100);
  assert.equal(frame.responses.some((value) => value.token === request), false);
  frame.owner.renderDirectory('438');
  assert.deepEqual(frame.responses.at(-1), {
    token: request, status: 'ready', directoryId: '438', leaseToken: frame.lease(),
    name: 'Students', photoBaseUrl: 'https://example.myschoolapp.com/user/',
  });
  assert.equal(frame.calls.length, 0);
  t.mock.timers.tick(2_100);
  assert.equal(frame.responses.filter((value) => value.token === request).length, 1);
  assert.notEqual(frame.owner.renderDirectory, frame.original);
});

test('a queued acquisition falls back promptly when an earlier native startup produces the matching view', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const render = frame.app.renderMainPage;
  let native: InstanceType<typeof frame.View> | null = null;
  frame.app.renderMainPage = function (view) {
    if (view.template === 'directory/directory.template.html') { native = view; return; }
    render.call(this, view);
  };
  frame.navigate();
  frame.send('enable');
  frame.send('acquire', request, '438');
  t.mock.timers.tick(50);
  assert.equal(frame.responses.some((value) => value.token === request), false);
  assert.ok(native);
  render.call(frame.app, native);
  t.mock.timers.tick(50);
  assert.deepEqual(frame.responses.at(-1), { token: request, status: 'unsupported', directoryId: '438' });
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.app._currentMainView, native);
  assert.notEqual(frame.owner.renderDirectory, frame.original);
  t.mock.timers.tick(2_100);
  assert.equal(frame.responses.filter((value) => value.token === request).length, 1);
});

test('a queued acquisition does not mistake the previous directory for the target native view', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.navigate('912');
  frame.send('enable');
  frame.page.location.hash = '#directory/438';
  frame.send('acquire', request, '438');
  t.mock.timers.tick(50);
  assert.equal(frame.responses.some((value) => value.token === request), false);
  frame.owner.renderDirectory('438');
  assert.equal(frame.responses.at(-1)!.token, request);
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.deepEqual(frame.calls.map((call) => call.args), [['912']]);
});

test('departure cancels a queued acquisition without calling its obsolete native route', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.page.location.hash = '#directory/438';
  frame.send('acquire', request, '438');
  frame.page.location.hash = '#studentmyday/schedule';
  frame.page.dispatchEvent(new frame.page.Event('hashchange'));
  assert.deepEqual(frame.responses.at(-1), { token: request, status: 'unsupported', directoryId: '438' });
  t.mock.timers.tick(2_100);
  assert.equal(frame.calls.length, 0);
  assert.notEqual(frame.owner.renderDirectory, frame.original);
  assert.equal(frame.responses.filter((value) => value.token === request).length, 1);
});

test('replacing a queued acquisition leaves only the latest request eligible', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.page.location.hash = '#directory/438';
  frame.send('acquire', request, '438');
  frame.send('acquire', other, '438');
  assert.deepEqual(frame.responses.at(-1), { token: request, status: 'unsupported', directoryId: '438' });
  frame.owner.renderDirectory('438');
  assert.equal(frame.responses.at(-1)!.status, 'ready');
  assert.equal(frame.responses.at(-1)!.token, other);
  t.mock.timers.tick(2_100);
  assert.equal(frame.responses.filter((value) => value.token === other).length, 1);
  assert.equal(frame.calls.length, 0);
});

test('canceling pending acquisition lets the upcoming native callback run once without an orphan shell', () => {
  for (const action of ['release', 'original']) {
    const frame = fixture();
    try {
      frame.send('enable');
      frame.page.location.hash = '#directory/438';
      frame.send('acquire', request, '438');
      frame.send(action, request, '438');
      assert.deepEqual(frame.responses.at(-1), { token: request, status: 'unsupported', directoryId: '438' });
      assert.equal(frame.owner.renderDirectory('438'), 'native-result');
      assert.equal(frame.calls.length, 1);
      assert.equal(frame.root().hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), false);
      frame.navigate('912');
      assert.equal(frame.root().getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), '912');
      assert.equal(frame.calls.length, 1);
    } finally { frame.close(); }
  }
});

test('a canceled pending route cannot bypass interception after leaving that directory', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.page.location.hash = '#directory/438';
  frame.send('acquire', request, '438');
  frame.send('release', request, '438');
  frame.page.location.hash = '#studentmyday/schedule';
  frame.page.dispatchEvent(new frame.page.Event('hashchange'));
  frame.navigate();
  assert.equal(frame.calls.length, 0);
  assert.equal(frame.root().getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), '438');
});

test('queued readiness timeout disables interception before returning fallback to the content runtime', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.page.location.hash = '#directory/438';
  frame.send('acquire', request, '438');
  t.mock.timers.tick(2_050);
  assert.deepEqual(frame.responses.slice(-2), [
    { token: gate, status: 'unsupported' },
    { token: request, status: 'unsupported', directoryId: '438' },
  ]);
  assert.equal(frame.owner.renderDirectory, frame.original);
  assert.equal(frame.owner.renderDirectory('438'), 'native-result');
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.root().hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), false);
  t.mock.timers.tick(4_000);
  assert.equal(frame.responses.filter((value) => value.token === request).length, 1);
});

test('unsupported IDs, routes and unknown directories preserve native receivers, arguments and return values', () => {
  for (const item of [
    { hash: '#directory/-1', args: ['-1'] }, { hash: '#directory/438?search=ada', args: ['438'] },
    { hash: '#profile/438', args: ['438'] }, { hash: '#directory/438', args: ['912'] },
    { hash: '#directory/912', args: ['912', 'query'] }, { hash: '#directory/999', args: ['999'] },
  ]) {
    const frame = fixture();
    try {
      frame.send('enable');
      frame.page.location.hash = item.hash;
      const receiver = { custom: 'receiver' };
      assert.equal(frame.owner.renderDirectory.apply(receiver, item.args), 'native-result');
      assert.deepEqual(frame.calls, [{ receiver, args: item.args }]);
      assert.equal(frame.root().hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), false);
    } finally { frame.close(); }
  }
});

test('native context names and arbitrary authorized IDs work without hardcoded directory names', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate('912');
  frame.send('acquire', request, '912');
  assert.equal(frame.responses.at(-1)!.name, 'Custom Coaches');
  assert.equal(frame.calls.length, 0);
});

test('independent route transitions clear stale native filters and keep profile return state on the selected directory', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  Object.assign(frame.module.Data, { directoryId: '438', searchVal: 'previous query', searchFacets: ['previous-grade'], searchRun: true, viewType: 2 });
  frame.send('enable');
  frame.navigate('912');
  assert.deepEqual(frame.module.Data, { directoryId: '912', searchVal: '', searchFacets: [], searchRun: false, viewType: -1 });
  frame.navigate('438');
  frame.send('original', frame.lease(), '438');
  assert.deepEqual(frame.module.Data, { directoryId: '438', searchVal: '', searchFacets: [], searchRun: false, viewType: -1 });
  assert.deepEqual(frame.calls.map((call) => call.args), [['438']]);
});

test('same-directory startup preserves shared native search state just as the native route does', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const originalState = { directoryId: '438', searchVal: 'existing query', searchFacets: ['existing-grade'], searchRun: true, viewType: 2 };
  Object.assign(frame.module.Data, originalState);
  frame.send('enable');
  frame.navigate();
  assert.deepEqual(frame.module.Data, originalState);
  frame.send('original', frame.lease(), '438');
  assert.deepEqual(frame.module.Data, originalState);
});

test('malformed or ambiguous context and replaced main containers fail open to native startup', () => {
  for (const change of [
    (frame: ReturnType<typeof fixture>) => { frame.directories.push({ DirectoryID: 438, DirectoryName: 'duplicate' }); },
    (frame: ReturnType<typeof fixture>) => { frame.directories[0] = { DirectoryID: '438', DirectoryName: 'wrong type' }; },
    (frame: ReturnType<typeof fixture>) => { frame.directories[0] = { DirectoryID: 438, DirectoryName: '' }; },
    (frame: ReturnType<typeof fixture>) => { frame.app.Layout.Containers.MainPage[0] = frame.page.document.createElement('div'); },
    (frame: ReturnType<typeof fixture>) => { frame.app.Data.Context.get = () => { throw new Error('missing context'); }; },
  ]) {
    const frame = fixture();
    try {
      frame.send('enable');
      change(frame);
      frame.navigate();
      assert.equal(frame.calls.length, 1);
      assert.equal(frame.root().hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), false);
    } finally { frame.close(); }
  }
});

test('explicit original, release and pending fallback each resume the saved native callback exactly once', () => {
  for (const action of ['original', 'release', 'button']) {
    const frame = fixture();
    try {
      frame.send('enable');
      const receiver = { native: true };
      frame.navigate('438', ['438', null, 'retained'], receiver);
      const token = frame.lease();
      if (action === 'button') frame.root().querySelector<HTMLButtonElement>('button')!.click();
      else frame.send(action, token, '438');
      frame.send('original', token, '438');
      frame.send('release', token, '438');
      assert.deepEqual(frame.calls, [{ receiver, args: ['438', null, 'retained'] }]);
      assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
      assert.equal(frame.responses.filter((value) => value.token === token && value.status === 'released').length, 1);
      frame.send('acquire', request, '438');
      assert.equal(frame.responses.at(-1)!.status, 'unsupported');
    } finally { frame.close(); }
  }
});

test('stale lease and gate tokens cannot release or disable the current shell', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  const root = frame.root();
  frame.send('original', other, '438');
  frame.send('release', frame.lease(), '912');
  frame.send('disable', other);
  assert.equal(frame.root(), root);
  assert.equal(frame.calls.length, 0);
  frame.send('acquire', request, '438');
  assert.equal(frame.responses.at(-1)!.status, 'ready');
});

test('departure and rapid directory replacement never replay obsolete native callbacks', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  const oldToken = frame.lease();
  frame.navigate('912');
  const newRoot = frame.root();
  frame.send('release', oldToken, '438');
  assert.equal(frame.calls.length, 0);
  assert.equal(frame.root(), newRoot);
  frame.page.location.hash = '#studentmyday/schedule';
  frame.page.dispatchEvent(new frame.page.Event('hashchange'));
  frame.send('release', frame.lease(), '912');
  assert.equal(frame.calls.length, 0);
  assert.equal(newRoot.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
});

test('a late native callback cannot strand a newer independent route in the old directory', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.navigate('912');
  const lateNativeView = frame.app._currentMainView;
  frame.send('enable');
  frame.navigate();
  const token = frame.lease();
  frame.app.renderMainPage(lateNativeView);
  t.mock.timers.tick(1);
  frame.send('release', token, '438');
  assert.deepEqual(frame.calls.map((call) => call.args), [['912'], ['438']]);
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
  assert.equal(frame.root().hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.responses.filter((value) => value.status === 'released' && value.token === token).length, 1);
  t.mock.timers.tick(4_000);
  assert.equal(frame.calls.length, 2);
});

test('native fallback leaves a status message while native initialization is pending', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const render = frame.app.renderMainPage;
  let pendingNative: InstanceType<typeof frame.View> | null = null;
  frame.app.renderMainPage = function (view) {
    if (view.template === 'directory/directory.template.html') { pendingNative = view; return; }
    return render.call(this, view);
  };
  frame.send('enable');
  frame.navigate();
  frame.root().querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`)!.remove();
  frame.send('release', frame.lease(), '438');
  assert.equal(frame.root().querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`)?.textContent, 'Loading original directory…');
  assert.equal(frame.calls.length, 1);
  assert.ok(pendingNative);
  render.call(frame.app, pendingNative);
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
});

test('a delayed native fallback completes normally and restores the inherited fetch method immediately', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  const fetch = frame.DirectoryModel.prototype.fetch;
  frame.send('enable');
  frame.navigate();
  frame.send('original', frame.lease(), '438');
  assert.equal(frame.metadata.length, 1);
  assert.equal(frame.DirectoryModel.prototype.fetch, fetch);
  assert.equal(Object.hasOwn(frame.DirectoryModel.prototype, 'fetch'), false);
  assert.equal(frame.app._currentMainView.template, 'blackbaud-next/directory');
  frame.metadata[0]!.options.success();
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
  assert.equal(frame.metadata[0]!.aborted, false);
  assert.equal(frame.calls.length, 1);
});

for (const [name, flags] of [
  ['writable nonconfigurable', { writable: true, configurable: false, enumerable: true }],
  ['configurable readonly', { writable: false, configurable: true, enumerable: false }],
] as const) {
  test(`native fallback guards a ${name} fetch method and restores every descriptor flag`, (t) => {
    const frame = fixture();
    t.after(() => frame.close());
    frame.deferMetadata();
    const prototype = frame.DirectoryModel.prototype;
    Object.defineProperty(prototype, 'fetch', { ...flags, value: prototype.fetch });
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'fetch');
    frame.send('enable');
    assert.equal(frame.responses.at(-1)!.status, 'enabled');
    frame.navigate();
    frame.send('original', frame.lease(), '438');
    assert.equal(frame.metadata.length, 1);
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'fetch'), descriptor);
    frame.metadata[0]!.options.success();
    assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
    assert.equal(frame.metadata[0]!.aborted, false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'fetch'), descriptor);
  });
}

test('feature disable preserves an already requested native fallback until it finishes', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.send('enable');
  frame.navigate();
  frame.send('original', frame.lease(), '438');
  frame.send('disable');
  assert.equal(frame.metadata[0]!.aborted, false);
  assert.equal(frame.owner.renderDirectory, frame.original);
  frame.metadata[0]!.options.success();
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
});

test('adapter teardown cancels a prior pending native fallback and ignores its later callbacks', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.send('enable');
  frame.navigate();
  frame.send('original', frame.lease(), '438');
  const view = frame.app._currentMainView;
  frame.bridge();
  assert.equal(frame.metadata[0]!.aborted, true);
  frame.metadata[0]!.options.success();
  frame.metadata[0]!.options.error();
  assert.equal(frame.app._currentMainView, view);
  assert.equal(frame.lifecycle.includes('native-directory-error'), false);
});

test('adapter teardown still starts native recovery for its current independent shell', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.send('enable');
  frame.navigate();
  frame.bridge();
  assert.equal(frame.metadata.length, 1);
  frame.bridge();
  assert.equal(frame.metadata[0]!.aborted, false);
  frame.metadata[0]!.options.success();
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
});

test('the temporary fetch guard captures only a matching model and directory query', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.page.history.replaceState({}, '', '#directory/438');
  const fetch = frame.DirectoryModel.prototype.fetch;
  let unrelated = 0;
  let captured = 0;
  const cancel = startNativeDirectory(frame.page, frame.DirectoryModel, '438', () => true, () => {
    new frame.DirectoryModel({ DirectoryId: '912' }).fetch({ data: { directoryId: '438' }, success: () => unrelated++, error() {} });
    new frame.DirectoryModel({ DirectoryId: '438' }).fetch({ data: { directoryId: '912' }, success: () => unrelated++, error() {} });
    new frame.DirectoryModel({ DirectoryId: '438' }).fetch({ data: { directoryId: '438' }, success: () => captured++, error() {} });
  });
  assert.equal(frame.DirectoryModel.prototype.fetch, fetch);
  assert.equal(Object.hasOwn(frame.DirectoryModel.prototype, 'fetch'), false);
  cancel();
  assert.deepEqual(frame.metadata.map((read) => read.aborted), [false, false, true]);
  for (const read of frame.metadata) read.options.success();
  assert.equal(unrelated, 2);
  assert.equal(captured, 0);
});

test('a frozen uncaptured fetch shadow forwards later native startup after its guard settles', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.page.history.replaceState({}, '', '#directory/438');
  const prototype = frame.DirectoryModel.prototype;
  const fetch = prototype.fetch;
  startNativeDirectory(frame.page, frame.DirectoryModel, '438', () => true, () => {
    // A later native/third-party descriptor change can prevent restoration
    // even when our synchronous startup did not make a matching request.
    Object.defineProperty(prototype, 'fetch', { configurable: false, writable: false });
  });
  assert.notEqual(prototype.fetch, fetch);
  assert.equal(frame.metadata.length, 0);
  frame.navigate();
  assert.equal(frame.metadata.length, 1);
  assert.equal(frame.metadata[0]!.aborted, false);
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
  assert.equal(frame.calls.length, 1);
});

test('departure after native fallback starts aborts its metadata and cannot replace Resources or show an obsolete error', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.send('enable');
  frame.navigate();
  frame.send('original', frame.lease(), '438');
  const href = frame.page.location.href;
  frame.page.history.replaceState({}, '', '#resourceboard');
  frame.page.dispatchEvent(new frame.page.HashChangeEvent('hashchange', { oldURL: href, newURL: frame.page.location.href }));
  const resources = new frame.View();
  resources.template = 'resourceboard/resourceboard.template.html';
  resources.el.textContent = 'Native Resources';
  frame.app.renderMainPage(resources);
  assert.equal(frame.metadata[0]!.aborted, true);
  frame.metadata[0]!.options.success();
  frame.metadata[0]!.options.error();
  assert.equal(frame.app._currentMainView, resources);
  assert.equal(frame.root(), resources.el);
  assert.equal(frame.page.location.hash, '#resourceboard');
  assert.equal(frame.lifecycle.includes('native-directory-error'), false);
});

test('leaving and returning to the same directory cannot revive a previous native fallback', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.send('enable');
  frame.navigate();
  frame.send('original', frame.lease(), '438');
  const href = frame.page.location.href;
  const departed = new URL('#resourceboard', href).href;
  // Both transitions can precede their queued events. Retain transition
  // evidence even though the live URL already returned to the original ID.
  frame.page.history.replaceState({}, '', departed);
  frame.page.history.replaceState({}, '', href);
  frame.page.dispatchEvent(new frame.page.HashChangeEvent('hashchange', { oldURL: href, newURL: departed }));
  frame.owner.renderDirectory('438');
  const replacement = frame.app._currentMainView;
  assert.equal(frame.metadata[0]!.aborted, true);
  frame.metadata[0]!.options.success();
  frame.metadata[0]!.options.error();
  assert.equal(frame.app._currentMainView, replacement);
  assert.equal(replacement.template, 'blackbaud-next/directory');
  assert.equal(frame.root().getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), '438');
  assert.equal(frame.lifecycle.includes('native-directory-error'), false);
});

test('a replacement view on the same URL invalidates a pending native fallback', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.deferMetadata();
  frame.send('enable');
  frame.navigate();
  frame.send('original', frame.lease(), '438');
  const replacement = new frame.View();
  replacement.template = 'resourceboard/resourceboard.template.html';
  frame.app.renderMainPage(replacement);
  frame.metadata[0]!.options.success();
  assert.equal(frame.metadata[0]!.aborted, true);
  assert.equal(frame.app._currentMainView, replacement);
});

test('a native model prototype that cannot be guarded keeps normal startup available without independent interception', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const fetch = frame.DirectoryModel.prototype.fetch;
  Object.preventExtensions(frame.DirectoryModel.prototype);
  frame.send('enable');
  t.mock.timers.tick(12_100);
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
  assert.equal(frame.owner.renderDirectory, frame.original);
  assert.equal(frame.DirectoryModel.prototype.fetch, fetch);
  frame.navigate();
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
  assert.equal(frame.calls.length, 1);
});

test('disabling or teardown resumes a current shell and restores the original property descriptor', () => {
  for (const action of ['disable', 'teardown']) {
    const frame = fixture();
    try {
      const descriptor = { value: frame.original, writable: true, configurable: true, enumerable: false };
      Object.defineProperty(frame.owner, 'renderDirectory', descriptor);
      frame.send('enable');
      frame.navigate();
      if (action === 'disable') frame.send('disable'); else frame.bridge();
      assert.equal(frame.calls.length, 1);
      assert.deepEqual(Object.getOwnPropertyDescriptor(frame.owner, 'renderDirectory'), descriptor);
      frame.send('disable');
      assert.equal(frame.calls.length, 1);
    } finally { frame.close(); }
  }
});

test('another patch is never overwritten during disabling and current native fallback remains available', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  const later = () => 'another extension';
  frame.owner.renderDirectory = later;
  frame.send('disable');
  assert.equal(frame.owner.renderDirectory, later);
  assert.equal(frame.calls.length, 1);
});

test('a later frozen descriptor cannot break disabling and its remaining wrapper forwards natively', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  const wrapped = frame.owner.renderDirectory;
  Object.defineProperty(frame.owner, 'renderDirectory', { value: wrapped, writable: false, configurable: false });
  assert.doesNotThrow(() => frame.send('disable'));
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.navigate('912'), 'native-result');
  assert.equal(frame.calls.length, 2);
});

test('replacement of the directory module disables the old hook and recovers its current shell', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  frame.app._modules['shared/directory'] = { ...frame.module, Us: { renderDirectory: frame.original } };
  frame.send('heartbeat');
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.owner.renderDirectory, frame.original);
  frame.send('acquire', request, '438');
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
});

test('pagehide drops the gate and shell without starting a departing native request', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  frame.page.dispatchEvent(new frame.page.Event('pagehide'));
  assert.equal(frame.calls.length, 0);
  assert.equal(frame.owner.renderDirectory, frame.original);
  assert.equal(frame.root().hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
});

test('persisted pageshow recovers an ownerless independent shell exactly once without a departing request', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  const cachedRoot = frame.root();
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: true }));
  // The isolated runtime discards its rendered UI while Chrome retains the
  // native view object and DOM for BFCache.
  cachedRoot.querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`)?.remove();
  assert.equal(frame.calls.length, 0);
  assert.equal(cachedRoot.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE), false);
  assert.equal(frame.app._currentMainView.template, 'blackbaud-next/directory');
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(frame.calls.length, 1);
  frame.send('enable', other);
  frame.send('acquire', request, '438');
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
  assert.equal(frame.calls.length, 1);
});

test('a fresh enable racing persisted pageshow chooses native recovery without rearming an orphan shell', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: true }));
  frame.send('enable', other);
  assert.deepEqual(frame.responses.at(-1), { token: other, status: 'unsupported' });
  assert.equal(frame.owner.renderDirectory, frame.original);
  assert.equal(frame.calls.length, 0);
  frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.app._currentMainView.template, 'directory/directory.template.html');
});

test('persisted pageshow does not replay after unrelated route, view, app or new ownership', () => {
  for (const change of [
    (frame: ReturnType<typeof fixture>) => { frame.page.location.hash = '#studentmyday/schedule'; },
    (frame: ReturnType<typeof fixture>) => { frame.app.renderMainPage(new frame.View()); },
    (frame: ReturnType<typeof fixture>) => { Object.defineProperty(frame.page, 'p3', { value: { ...frame.app } }); },
    (frame: ReturnType<typeof fixture>) => { frame.root().setAttribute(DIRECTORY_OWNER_ATTRIBUTE, other); },
    (frame: ReturnType<typeof fixture>) => { frame.main.replaceChildren(); },
  ]) {
    const frame = fixture();
    try {
      frame.send('enable');
      frame.navigate();
      frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: true }));
      change(frame);
      frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: true }));
      assert.equal(frame.calls.length, 0);
    } finally { frame.close(); }
  }
});

test('ordinary departures and nonpersisted pageshow never retain a native replay', () => {
  for (const pair of [{ hide: false, show: true }, { hide: true, show: false }]) {
    const frame = fixture();
    try {
      frame.send('enable');
      frame.navigate();
      frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pagehide', { persisted: pair.hide }));
      frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: pair.show }));
      frame.page.dispatchEvent(new frame.page.PageTransitionEvent('pageshow', { persisted: true }));
      assert.equal(frame.calls.length, 0);
    } finally { frame.close(); }
  }
});

test('heartbeat expiry recovers once while valid heartbeats keep the gate alive', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  frame.send('enable');
  frame.navigate();
  t.mock.timers.tick(INDEPENDENT_DIRECTORY_GATE_LIFETIME - 2_000);
  frame.send('heartbeat');
  t.mock.timers.tick(INDEPENDENT_DIRECTORY_GATE_LIFETIME - 2_000);
  assert.equal(frame.calls.length, 0);
  frame.send('heartbeat', other);
  t.mock.timers.tick(4_000);
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.owner.renderDirectory, frame.original);
  t.mock.timers.tick(INDEPENDENT_DIRECTORY_GATE_LIFETIME);
  assert.equal(frame.calls.length, 1);
});

test('enable polls delayed native module discovery and cancellation prevents a late hook', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  const original = frame.module.Us;
  Reflect.deleteProperty(frame.module, 'Us');
  frame.send('enable');
  assert.equal(frame.responses.length, 0);
  t.mock.timers.tick(300);
  frame.module.Us = original;
  t.mock.timers.tick(100);
  assert.equal(frame.responses.at(-1)!.status, 'enabled');
  frame.send('disable');
  Reflect.deleteProperty(frame.module, 'Us');
  frame.send('enable', other);
  frame.send('disable', other);
  frame.module.Us = original;
  t.mock.timers.tick(12_100);
  assert.equal(frame.owner.renderDirectory, frame.original);
  assert.equal(frame.responses.filter((value) => value.token === other).length, 0);
  assert.equal(frame.navigate(), 'native-result');
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.root().hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), false);
});

test('unsupported native APIs and non-writable hooks stop bounded discovery without modifying native startup', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 });
  const frame = fixture();
  t.after(() => frame.close());
  Reflect.deleteProperty(frame.module, 'Vs');
  frame.send('enable');
  t.mock.timers.tick(12_100);
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
  assert.equal(frame.owner.renderDirectory, frame.original);
  Object.assign(frame.module, { Vs: { Directory: function () {} } });
  Object.defineProperty(frame.owner, 'renderDirectory', { value: frame.original, writable: false, configurable: true });
  frame.send('enable', other);
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
  assert.equal(frame.owner.renderDirectory, frame.original);
});

test('failed shell mounting preserves the native route and cannot leave an acquired orphan', (t) => {
  const frame = fixture();
  t.after(() => frame.close());
  const render = frame.app.renderMainPage;
  frame.app.renderMainPage = function (view) {
    if (view.template === 'blackbaud-next/directory') throw new Error('Unsupported native layout');
    return render.call(this, view);
  };
  frame.send('enable');
  frame.navigate();
  assert.equal(frame.calls.length, 1);
  assert.equal(frame.root().hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE), false);
  frame.send('acquire', request, '438');
  assert.equal(frame.responses.at(-1)!.status, 'unsupported');
});
