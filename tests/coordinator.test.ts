import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCoordinator, installCoordinator } from '../src/background/coordinator.ts';
import { AUTH_CONTEXT_PREFIX, createAuthContext } from '../src/blackbaud/auth.ts';
import { claimAuthAttempt } from '../src/shared/auth-flow.ts';
import type { AuthRequest } from '../src/shared/coordinator.ts';
import type { ExtensionApi, MessageListener, MessageSender, StorageArea } from '../src/shared/extension.ts';

const googleUrl = 'https://accounts.google.com/signin?redirect_uri=https%3A%2F%2Fid.blackbaud.com%2Fcallback';
const schoolHostname = 'polytechnic.myschoolapp.com';
const schoolLoginUrl = `https://${schoolHostname}/app#login`;
const studentUrl = `https://${schoolHostname}/app/student?svcid=edu#studentmyday/progress`;
const channel = 'blackbaud-next-coordinator-v1';

function fixture() {
  const flow = createAuthContext(schoolHostname, 'shared-flow');
  const tabId = 7;
  const key = `${AUTH_CONTEXT_PREFIX}${tabId}`;
  const sessionValues: Record<string, unknown> = { [key]: flow };
  const localValues: Record<string, unknown> = {};
  const syncValues: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>): StorageArea => ({
    async get(keys) {
      return structuredClone(keys ? Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in values).map((key) => [key, values[key]])) : values);
    },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  });
  let listener: MessageListener | undefined;
  const api: ExtensionApi = {
    storage: { sync: area(syncValues), local: area(localValues), session: area(sessionValues), onChanged: { addListener() {}, removeListener() {} } },
    runtime: {
      id: 'coordinator-fixture', getURL: (path) => `chrome-extension://coordinator-fixture/${path}`,
      sendMessage: async () => undefined,
      onMessage: { addListener: (next) => { listener = next; }, removeListener: () => { listener = undefined; } },
    },
  };
  const sender = (url = googleUrl, owner = tabId): MessageSender => ({ id: api.runtime.id, url, tab: { id: owner }, frameId: 0 });
  let handle = createCoordinator(api);
  const auth = (request: AuthRequest, url = googleUrl, owner = tabId) => handle({ channel, kind: 'auth', request }, sender(url, owner));
  api.runtime.sendMessage = async (message) => {
    try { return { ok: true, value: await handle(message, sender()) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Failed' }; }
  };
  return { api, flow, key, tabId, localValues, sessionValues, syncValues, auth, sender,
    handle: (message: unknown, url?: string) => handle(message, sender(url)),
    dispatch: (message: unknown, identity: MessageSender) => handle(message, identity),
    restart() { handle = createCoordinator(api); },
    listener: () => listener,
  };
}

test('two provider documents in one tab cannot click against one shared attempt', async () => {
  const state = fixture();
  const pages = [new JSDOM('<button>Choose account</button>'), new JSDOM('<button>Choose account</button>')];
  const previous = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  Object.assign(globalThis, { chrome: state.api });
  let clicks = 0;
  for (const page of pages) page.window.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
  try {
    const results = await Promise.all(pages.map((page) => claimAuthAttempt(page.window.document, state.flow, 'google', new AbortController().signal,
      () => page.window.document.querySelector<HTMLButtonElement>('button'))));
    assert.equal(clicks, 1);
    assert.equal(results.filter(({ clicked }) => clicked).length, 1);
    state.restart();
    assert.equal(await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'after-restart' }), null,
      'a fresh worker must respect the persisted attempt');
  } finally {
    for (const page of pages) page.window.close();
    Object.assign(globalThis, { chrome: previous });
  }
});

test('a pause queued during a claim prevents confirmation and survives rollback', async () => {
  const state = fixture();
  const originalSet = state.api.storage.session.set;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  state.api.storage.session.set = async (patch) => { await originalSet(patch); entered(); await pending; };
  const claim = state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'reserved' });
  await started;
  const pause = state.auth({ action: 'pause', id: state.flow.id });
  release();
  await claim;
  await pause;
  assert.equal(await state.auth({ action: 'confirm', id: state.flow.id, step: 'google', token: 'reserved' }), null);
  await state.auth({ action: 'release', id: state.flow.id, step: 'google', token: 'reserved' });
  assert.deepEqual(state.sessionValues[state.key], { ...state.flow, paused: true });
});

test('an obsolete release cannot undo another claim or its pause state', async () => {
  const state = fixture();
  await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'current' });
  await state.auth({ action: 'pause', id: state.flow.id });
  const owned = structuredClone(state.sessionValues[state.key]);
  await state.auth({ action: 'release', id: state.flow.id, step: 'google', token: 'obsolete' });
  assert.deepEqual(state.sessionValues[state.key], owned);
});

test('an unconfirmed claim is released when its persisted reply is lost', async () => {
  const state = fixture();
  const page = new JSDOM('<button>Choose account</button>');
  const previous = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  Object.assign(globalThis, { chrome: state.api });
  const send = state.api.runtime.sendMessage;
  let loseReply = true;
  state.api.runtime.sendMessage = async (message) => {
    const response = await send(message);
    if (loseReply && (message as { request?: AuthRequest }).request?.action === 'claim') {
      loseReply = false;
      state.restart();
      throw new Error('Message channel closed');
    }
    return response;
  };
  let clicks = 0;
  const button = page.window.document.querySelector<HTMLButtonElement>('button')!;
  button.addEventListener('click', () => { clicks++; });
  try {
    await assert.rejects(claimAuthAttempt(page.window.document, state.flow, 'google', new AbortController().signal, () => button), /channel closed/);
    assert.deepEqual(state.sessionValues[state.key], state.flow);
    const result = await claimAuthAttempt(page.window.document, state.flow, 'google', new AbortController().signal, () => button);
    assert.equal(result.clicked, true);
    assert.equal(clicks, 1);
  } finally { page.window.close(); Object.assign(globalThis, { chrome: previous }); }
});

test('a rejected storage operation does not block subsequent auth work', async () => {
  const state = fixture();
  const set = state.api.storage.session.set;
  state.api.storage.session.set = async () => { throw new Error('Write unavailable'); };
  await assert.rejects(state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'failed' }), /unavailable/);
  state.api.storage.session.set = set;
  assert.ok(await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'recovered' }));
});

test('callback messaging owns pending settings writes independently of the sender', async () => {
  const state = fixture();
  const set = state.api.storage.sync.set;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  state.api.storage.sync.set = async (patch) => { await pending; await set(patch); };
  const dispose = installCoordinator(state.api);
  const listener = state.listener()!;
  const replies: unknown[] = [];
  const sender = { id: state.api.runtime.id, url: state.api.runtime.getURL('popup.html') };
  assert.equal(listener({ channel, kind: 'settings', update: { rosterTools: false } }, sender, () => { throw new Error('Sender closed'); }), true);
  assert.equal(listener({ channel, kind: 'settings', update: { resourceSearch: false } }, sender, (value) => replies.push(value)), true);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(state.syncValues.rosterTools, false);
  assert.equal(state.syncValues.resourceSearch, false);
  assert.equal(replies.length, 1);
  dispose();
});

test('the coordinator rejects foreign senders, arbitrary pages and provider mismatches', async () => {
  const state = fixture();
  const handle = createCoordinator(state.api);
  const settings = { channel, kind: 'settings', update: { enabled: false } };
  await assert.rejects(handle(settings, { id: 'another-extension', url: state.api.runtime.getURL('popup.html') }), /sender/);
  await assert.rejects(state.handle(settings, googleUrl), /sender/);
  await assert.rejects(state.handle({ channel, kind: 'auth', request: { action: 'list' } }, 'https://accounts.google.com/'), /sender/);
  await assert.rejects(state.auth({ action: 'claim', id: state.flow.id, step: 'blackbaud', token: 'wrong-provider' }), /provider/);
  await assert.rejects(state.handle({ channel, kind: 'auth', request: { action: 'create', id: 'other-school', hostname: 'chandler.myschoolapp.com' } }, 'https://polytechnic.myschoolapp.com/app#login'), /school/);
  assert.deepEqual(state.syncValues, {});
  assert.deepEqual(state.sessionValues[state.key], state.flow);
});

test('same-school tabs cannot read or mutate each other even with a forged payload tab ID', async () => {
  const state = fixture();
  const otherTab = 8;
  const otherFlow = await state.auth({ action: 'create', id: 'other-tab-flow', hostname: schoolHostname }, schoolLoginUrl, otherTab);
  assert.ok(otherFlow);
  await state.auth({ action: 'pause', id: 'other-tab-flow' }, schoolLoginUrl, otherTab);
  const otherKey = `${AUTH_CONTEXT_PREFIX}${otherTab}`;
  const otherPaused = structuredClone(state.sessionValues[otherKey]);
  await state.auth({ action: 'create', id: 'pending-other-tab-flow', hostname: schoolHostname }, schoolLoginUrl, 9);
  const pendingKey = `${AUTH_CONTEXT_PREFIX}9`;
  const otherPending = structuredClone(state.sessionValues[pendingKey]);
  assert.deepEqual(await state.auth({ action: 'list' }), [state.flow]);
  assert.deepEqual(await state.auth({ action: 'list' }, googleUrl, otherTab), [otherPaused]);
  for (const id of ['other-tab-flow', 'pending-other-tab-flow']) {
    const operations: AuthRequest[] = [
      { action: 'claim', id, step: 'google', token: 'forged' },
      { action: 'confirm', id, step: 'google', token: 'forged' },
      { action: 'release', id, step: 'google', token: 'forged' },
      { action: 'pause', id },
      { action: 'recover', id },
      { action: 'remove', id, hostname: schoolHostname },
    ];
    for (const request of operations) {
      const response = await state.dispatch({ channel, kind: 'auth', request: { ...request, tabId: otherTab } }, state.sender('step' in request ? googleUrl : studentUrl));
      assert.equal(response, null, request.action);
    }
  }
  assert.deepEqual(await state.dispatch({ channel, kind: 'auth', request: { action: 'list', tabId: otherTab } }, state.sender()), [state.flow]);
  assert.deepEqual(state.sessionValues[otherKey], otherPaused);
  assert.deepEqual(state.sessionValues[pendingKey], otherPending);
  assert.deepEqual(state.sessionValues[state.key], state.flow);
});

test('auth requires a valid top-level trusted tab while popup settings remain tabless', async () => {
  const state = fixture();
  const request = { channel, kind: 'auth', request: { action: 'list' } };
  const invalidSenders: MessageSender[] = [
    { id: state.api.runtime.id, url: googleUrl },
    { ...state.sender(), tab: {} },
    { ...state.sender(), tab: { id: -1 } },
    { ...state.sender(), tab: { id: 0.5 } },
    { ...state.sender(), tab: { id: Number.NaN } },
    { ...state.sender(), tab: { id: Number.MAX_SAFE_INTEGER + 1 } },
    { ...state.sender(), frameId: undefined },
    { ...state.sender(), frameId: 1 },
  ];
  for (const sender of invalidSenders) await assert.rejects(state.dispatch(request, sender));
  assert.deepEqual(await state.auth({ action: 'list' }, googleUrl, 0), []);
  await state.dispatch({ channel, kind: 'settings', update: { enabled: false } }, {
    id: state.api.runtime.id, url: state.api.runtime.getURL('popup.html'),
  });
  assert.equal(state.syncValues.enabled, false);
  assert.deepEqual(state.sessionValues[state.key], state.flow);
});

test('same-generation creation preserves pause and spent attempts; a fresh explicit generation replaces it', async () => {
  const state = fixture();
  await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'spent' });
  await state.auth({ action: 'pause', id: state.flow.id });
  const paused = structuredClone(state.sessionValues[state.key]);
  const repeated = await state.auth({ action: 'create', id: state.flow.id, hostname: schoolHostname }, schoolLoginUrl);
  assert.deepEqual(repeated, paused);
  assert.deepEqual(state.sessionValues[state.key], paused);
  const next = await state.auth({ action: 'create', id: 'explicit-next-flow', hostname: schoolHostname }, schoolLoginUrl);
  assert.deepEqual(await state.auth({ action: 'list' }), [next]);
  assert.equal(await state.auth({ action: 'confirm', id: state.flow.id, step: 'google', token: 'spent' }), null);
  assert.deepEqual(Object.keys(state.sessionValues), [state.key]);
});

test('late completion and release cannot remove or recreate a newer generation', async () => {
  const state = fixture();
  await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'old-claim' });
  const next = await state.auth({ action: 'create', id: 'newer-intent', hostname: schoolHostname }, schoolLoginUrl);
  await state.auth({ action: 'remove', id: state.flow.id, hostname: schoolHostname }, studentUrl);
  assert.deepEqual(await state.auth({ action: 'list' }), [next]);
  assert.equal(await state.auth({ action: 'confirm', id: state.flow.id, step: 'google', token: 'old-claim' }), null);
  await state.auth({ action: 'release', id: state.flow.id, step: 'google', token: 'old-claim' });
  assert.deepEqual(state.sessionValues[state.key], next);
  state.restart();
  await state.auth({ action: 'remove', id: 'newer-intent', hostname: schoolHostname }, studentUrl);
  assert.deepEqual(await state.auth({ action: 'list' }), []);
  await state.auth({ action: 'release', id: 'newer-intent', step: 'google', token: 'late-release' });
  assert.deepEqual(state.sessionValues, {});
});

test('completion requires the supported same-school return route and exact generation', async () => {
  const state = fixture();
  await state.auth({ action: 'pause', id: state.flow.id });
  const paused = structuredClone(state.sessionValues[state.key]);
  const remove: AuthRequest = { action: 'remove', id: state.flow.id, hostname: schoolHostname };
  for (const url of [
    `https://${schoolHostname}/`,
    `https://${schoolHostname}/app`,
    schoolLoginUrl,
    `https://${schoolHostname}/app/student#login`,
    `https://${schoolHostname}/lms-assignment/assignment-center`,
    'https://app.blackbaud.com/signin',
    googleUrl,
  ]) {
    await assert.rejects(state.auth(remove, url));
    assert.deepEqual(state.sessionValues[state.key], paused);
  }
  await assert.rejects(state.auth({ action: 'remove', id: state.flow.id, hostname: 'chandler.myschoolapp.com' }, studentUrl));
  assert.deepEqual(state.sessionValues[state.key], paused);
  // A manual successful sign-in also finishes the paused intent it belongs to.
  await state.auth(remove, studentUrl);
  assert.deepEqual(await state.auth({ action: 'list' }), []);
  await state.auth(remove, studentUrl);
  assert.deepEqual(state.sessionValues, {});
});

test('a new browser session does not import legacy local flows or change stored preferences', async () => {
  const state = fixture();
  const legacy = { ...state.flow, paused: true, blackbaudAttempts: 1 };
  state.localValues[`${AUTH_CONTEXT_PREFIX}${state.flow.id}`] = legacy;
  state.localValues.savedPreference = 'untouched';
  state.syncValues.accountPreference = 'students.polytechnic.org';
  const savedLocal = structuredClone(state.localValues);
  const savedSync = structuredClone(state.syncValues);
  delete state.sessionValues[state.key];
  state.restart();
  assert.deepEqual(await state.auth({ action: 'list' }), []);
  assert.equal(await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'revive' }), null);
  assert.deepEqual(state.localValues, savedLocal);
  assert.deepEqual(state.syncValues, savedSync);
  const fresh = await state.auth({ action: 'create', id: 'new-session-flow', hostname: schoolHostname }, schoolLoginUrl);
  assert.deepEqual(await state.auth({ action: 'list' }), [fresh]);
  assert.deepEqual(state.localValues, savedLocal);
});
