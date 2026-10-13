import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCoordinator, installCoordinator } from '../src/background/coordinator.ts';
import { AUTH_CONTEXT_PREFIX, createAuthContext } from '../src/blackbaud/auth.ts';
import { claimAuthAttempt } from '../src/shared/auth-flow.ts';
import type { AuthRequest } from '../src/shared/coordinator.ts';
import type { ExtensionApi, MessageListener, StorageArea } from '../src/shared/extension.ts';

const googleUrl = 'https://accounts.google.com/signin?redirect_uri=https%3A%2F%2Fid.blackbaud.com%2Fcallback';
const channel = 'blackbaud-next-coordinator-v1';

function fixture() {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'shared-flow');
  const key = `${AUTH_CONTEXT_PREFIX}${flow.id}`;
  const localValues: Record<string, unknown> = { [key]: flow };
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
    storage: { sync: area(syncValues), local: area(localValues), onChanged: { addListener() {}, removeListener() {} } },
    runtime: {
      id: 'coordinator-fixture', getURL: (path) => `chrome-extension://coordinator-fixture/${path}`,
      sendMessage: async () => undefined,
      onMessage: { addListener: (next) => { listener = next; }, removeListener: () => { listener = undefined; } },
    },
  };
  const sender = (url = googleUrl) => ({ id: api.runtime.id, url });
  let handle = createCoordinator(api);
  const auth = (request: AuthRequest) => handle({ channel, kind: 'auth', request }, sender());
  api.runtime.sendMessage = async (message) => {
    try { return { ok: true, value: await handle(message, sender()) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Failed' }; }
  };
  return { api, flow, key, localValues, syncValues, auth, sender,
    handle: (message: unknown, url?: string) => handle(message, sender(url)),
    restart() { handle = createCoordinator(api); },
    listener: () => listener,
  };
}

test('two independent provider documents cannot click against one shared attempt', async () => {
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
  const originalSet = state.api.storage.local.set;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  state.api.storage.local.set = async (patch) => { await originalSet(patch); entered(); await pending; };
  const claim = state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'reserved' });
  await started;
  const pause = state.auth({ action: 'pause', id: state.flow.id });
  release();
  await claim;
  await pause;
  assert.equal(await state.auth({ action: 'confirm', id: state.flow.id, step: 'google', token: 'reserved' }), null);
  await state.auth({ action: 'release', id: state.flow.id, step: 'google', token: 'reserved' });
  assert.deepEqual(state.localValues[state.key], { ...state.flow, paused: true });
});

test('an obsolete release cannot undo another claim or its pause state', async () => {
  const state = fixture();
  await state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'current' });
  await state.auth({ action: 'pause', id: state.flow.id });
  const owned = structuredClone(state.localValues[state.key]);
  await state.auth({ action: 'release', id: state.flow.id, step: 'google', token: 'obsolete' });
  assert.deepEqual(state.localValues[state.key], owned);
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
    assert.deepEqual(state.localValues[state.key], state.flow);
    const result = await claimAuthAttempt(page.window.document, state.flow, 'google', new AbortController().signal, () => button);
    assert.equal(result.clicked, true);
    assert.equal(clicks, 1);
  } finally { page.window.close(); Object.assign(globalThis, { chrome: previous }); }
});

test('a rejected storage operation does not block subsequent auth work', async () => {
  const state = fixture();
  const set = state.api.storage.local.set;
  state.api.storage.local.set = async () => { throw new Error('Write unavailable'); };
  await assert.rejects(state.auth({ action: 'claim', id: state.flow.id, step: 'google', token: 'failed' }), /unavailable/);
  state.api.storage.local.set = set;
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
  const sender = state.sender(state.api.runtime.getURL('popup.html'));
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
  assert.deepEqual(state.localValues[state.key], state.flow);
});
