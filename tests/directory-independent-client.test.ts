import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { acquireIndependentDirectory, enableIndependentDirectory, independentDirectoryRequested } from '../src/blackbaud/directory-independent.ts';
import { createDirectoryLoadingManager, registerDirectoryLoadingManager } from '../src/blackbaud/directory-loading.ts';
import { prepareDirectorySnapshot } from '../src/blackbaud/directory.ts';
import {
  INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE,
  INDEPENDENT_DIRECTORY_REQUEST_EVENT, INDEPENDENT_DIRECTORY_RESPONSE_EVENT,
} from '../src/blackbaud/directory-independent-protocol.ts';
import { DIRECTORY_OWNER_ATTRIBUTE } from '../src/blackbaud/directory-protocol.ts';
import type { Cleanup } from '../src/shared/types.ts';

const target = { directoryId: '123', origin: 'https://example.myschoolapp.com' };
const href = `${target.origin}/app/student?svcid=edu#directory/${target.directoryId}`;
const leaseToken = 'independent-directory-lease-01';
const configuration = { DirectoryID: 123, DirectoryName: 'Community directory', DefaultResults: true };
const row = (id = 1, total = 1) => ({
  UserID: id, FirstName: 'Ada', LastName: 'Example', UserNameFormatted: 'Ada Example', PublishUserProfile: true,
  PublishEmail: true, EmailBad: false, Email: 'ada@example.org', LargeFileName: 'large_user_example.jpg', GradeDisplay: '9', TotalCount: total,
});
const cleanups: Cleanup[] = [];

interface FixtureOptions {
  enable?: boolean;
  enableStatus?: string;
  enableTiming?: 'microtask' | 'manual';
  acquireReply?: (request: Record<string, unknown>) => unknown;
  replyTiming?: 'microtask' | 'manual';
  root?: 'missing' | 'nested' | 'missing-header' | 'wrong-owner' | 'wrong-attribute' | 'wrong-directory';
}

function fixture(options: FixtureOptions = {}) {
  const dom = new JSDOM('<main id="site-main"></main>', { url: href });
  const page = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: page, document: page.document, CustomEvent: page.CustomEvent })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  cleanups.push(() => {
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const root = page.document.createElement('section');
  root.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, options.root === 'wrong-directory' ? '456' : target.directoryId);
  root.setAttribute(DIRECTORY_OWNER_ATTRIBUTE, options.root === 'wrong-owner' ? 'other-directory-owner-01' : leaseToken);
  root.innerHTML = `<header id="overview"><h1>Loading directory</h1></header><p ${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}>Loading people…</p>`;
  if (options.root === 'missing-header') root.querySelector('#overview')!.remove();
  if (options.root === 'wrong-attribute') root.removeAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE);
  if (options.root === 'nested') {
    const wrapper = page.document.createElement('div');
    wrapper.append(root);
    page.document.querySelector('#site-main')!.append(wrapper);
  } else if (options.root !== 'missing') page.document.querySelector('#site-main')!.append(root);
  const requests: Array<Record<string, unknown>> = [];
  const pendingReplies: unknown[] = [];
  const pendingEnableReplies: unknown[] = [];
  const reply = (value: unknown) => page.document.dispatchEvent(new page.CustomEvent(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, {
    detail: JSON.stringify(value),
  }));
  const sendRaw = (detail: unknown) => page.document.dispatchEvent(new page.CustomEvent(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, { detail }));
  page.document.addEventListener(INDEPENDENT_DIRECTORY_REQUEST_EVENT, (event) => {
    const request = JSON.parse((event as CustomEvent).detail) as Record<string, unknown>;
    requests.push(request);
    if (request.action === 'enable') {
      const value = { token: request.token, status: options.enableStatus ?? 'enabled' };
      if (options.enableTiming === 'manual') pendingEnableReplies.push(value);
      else if (options.enableTiming === 'microtask') queueMicrotask(() => reply(value));
      else reply(value);
    }
    if (request.action === 'acquire') {
      const value = options.acquireReply?.(request) ?? {
        token: request.token, directoryId: request.directoryId, status: 'ready', leaseToken,
        photoBaseUrl: `${target.origin}/user/`,
      };
      if (options.replyTiming === 'manual') pendingReplies.push(value);
      else if (options.replyTiming === 'microtask') queueMicrotask(() => reply(value));
      else reply(value);
    }
    if (request.action === 'release' || request.action === 'original' || request.action === 'disable') root.remove();
  });
  const controller = new AbortController();
  const enable = () => {
    const cleanup = enableIndependentDirectory(controller.signal);
    cleanups.push(cleanup);
    return cleanup;
  };
  if (options.enable !== false) enable();
  return {
    dom, page, root, requests, reply, sendRaw, controller, enable,
    finishEnable: () => {
      assert.equal(pendingEnableReplies.length, 1);
      reply(pendingEnableReplies.shift());
    },
    finishHandshake: () => {
      assert.equal(pendingReplies.length, 1);
      reply(pendingReplies.shift());
    },
    actions: (action: string) => requests.filter((request) => request.action === action),
  };
}

function immediateReads(t: TestContext, config: unknown = configuration, people: unknown = [row()]) {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const path = String(input);
    requests.push(path);
    return new Response(JSON.stringify(path.includes('/directoryget?') ? config : people));
  });
  return requests;
}

function deferredReads(t: TestContext) {
  const requests: Array<{ path: string; signal: AbortSignal; resolve(response: Response): void }> = [];
  let started!: () => void;
  const bothStarted = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = options!.signal as AbortSignal;
    requests.push({ path: String(input), signal, resolve });
    if (requests.length === 2) started();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const finish = (kind: 'configuration' | 'people', payload: unknown = kind === 'configuration' ? configuration : [row()]) => {
    const request = requests.find((entry) => entry.path.includes(kind === 'configuration' ? '/directoryget?' : '/directoryresultsget?'));
    assert.ok(request, `The ${kind} read should already be in flight.`);
    request.resolve(new Response(JSON.stringify(payload)));
  };
  return { requests, finish, bothStarted };
}

function deadlines(t: TestContext, page: JSDOM['window']) {
  const callbacks: Array<{ milliseconds: number; callback: () => void }> = [];
  t.mock.method(page, 'setTimeout', (callback: TimerHandler, milliseconds = 0) => {
    assert.equal(typeof callback, 'function');
    callbacks.push({ milliseconds, callback: callback as () => void });
    return callbacks.length;
  });
  return {
    fire: (milliseconds: number) => {
      const index = callbacks.findIndex((entry) => entry.milliseconds === milliseconds);
      assert.notEqual(index, -1, `A ${milliseconds} ms deadline should have been scheduled.`);
      const [entry] = callbacks.splice(index, 1);
      entry!.callback();
    },
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

test('the independent client performs no acquisition or reads until the enabled handshake is acknowledged', async (t) => {
  const frame = fixture({ enable: false, enableStatus: 'unsupported' });
  const requests = immediateReads(t);
  assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
  const disable = frame.enable();
  assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(requests.length, 0);
  disable();
  disable();
  assert.equal(frame.actions('disable').length, 1);
});

test('disabling the preference removes the acquisition gate and sends one disable action', async (t) => {
  const frame = fixture();
  const requests = immediateReads(t);
  frame.controller.abort();
  assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
  assert.equal(frame.actions('disable').length, 1);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(requests.length, 0);
});

test('acquisition waits for delayed MAIN discovery before asking for the shell and starting reads', async (t) => {
  const frame = fixture({ enableTiming: 'microtask', replyTiming: 'microtask' });
  const reads = deferredReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  assert.equal(independentDirectoryRequested(), true);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(reads.requests.length, 0);
  await reads.bothStarted;
  assert.equal(frame.actions('acquire').length, 1);
  reads.finish('configuration');
  reads.finish('people');
  const lease = await pending;
  assert.ok(lease);
  cleanups.push(lease.release);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(frame.actions('disable').length, 0);
});

test('unsupported delayed discovery returns the native path without requesting a shell or data', async (t) => {
  const frame = fixture({ enableTiming: 'manual', enableStatus: 'unsupported' });
  const requests = immediateReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  frame.finishEnable();
  assert.equal(await pending, null);
  assert.equal(independentDirectoryRequested(), false);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(requests.length, 0);
});

test('silent MAIN discovery disables interception before fallback and ignores a late enable acknowledgement', async (t) => {
  const frame = fixture({ enableTiming: 'manual' });
  const clock = deadlines(t, frame.page);
  const requests = immediateReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  clock.fire(3000);
  assert.equal(await pending, null);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(frame.actions('disable').length, 1);
  assert.equal(independentDirectoryRequested(), false);
  frame.finishEnable();
  await Promise.resolve();
  assert.equal(independentDirectoryRequested(), false);
  assert.equal(requests.length, 0);
});

test('canceling discovery on the same route preserves the user request for the original view', async (t) => {
  const frame = fixture({ enableTiming: 'manual' });
  const requests = immediateReads(t);
  const controller = new AbortController();
  const pending = acquireIndependentDirectory(target, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(frame.actions('disable').length, 1);
  assert.equal(frame.actions('acquire').length, 0);
  frame.finishEnable();
  await Promise.resolve();
  assert.equal(independentDirectoryRequested(), false);
  assert.equal(requests.length, 0);
});

test('navigation cancellation leaves pending document discovery available for the next route', async (t) => {
  const frame = fixture({ enableTiming: 'manual' });
  const requests = immediateReads(t);
  const controller = new AbortController();
  const pending = acquireIndependentDirectory(target, controller.signal);
  frame.page.history.replaceState(null, '', '#directory/456');
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(frame.actions('disable').length, 0);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(independentDirectoryRequested(), true);
  frame.finishEnable();
  assert.equal(independentDirectoryRequested(), true);
  assert.equal(requests.length, 0);
});

test('a shell-ready reply delivered after dispatch starts both reads and completes acquisition', async (t) => {
  const frame = fixture({ replyTiming: 'microtask' });
  const reads = deferredReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  assert.equal(frame.actions('acquire').length, 1);
  assert.equal(reads.requests.length, 0);
  await reads.bothStarted;
  assert.equal(reads.requests.length, 2);
  reads.finish('configuration');
  reads.finish('people');
  const lease = await pending;
  assert.ok(lease);
  cleanups.push(lease.release);
  assert.equal(lease.root, frame.root);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(frame.actions('disable').length, 0);
});

test('canceling a pending handshake cancels its MAIN request and ignores a late shell-ready reply', async (t) => {
  const frame = fixture({ replyTiming: 'manual' });
  const requests = immediateReads(t);
  const controller = new AbortController();
  const pending = acquireIndependentDirectory(target, controller.signal);
  const request = frame.actions('acquire')[0]!;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(frame.actions('release').length, 1);
  assert.equal(frame.actions('release')[0]!.token, request.token);
  assert.equal(frame.actions('release')[0]!.directoryId, target.directoryId);
  assert.equal(requests.length, 0);
  frame.finishHandshake();
  await Promise.resolve();
  assert.equal(requests.length, 0);
  assert.equal(frame.actions('release').length, 1);
});

test('canceling just after shell-ready acknowledgement releases the granted lease before any read', async (t) => {
  const frame = fixture({ replyTiming: 'manual' });
  const requests = immediateReads(t);
  const controller = new AbortController();
  const pending = acquireIndependentDirectory(target, controller.signal);
  frame.finishHandshake();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requests.length, 0);
  assert.equal(frame.actions('release').length, 1);
  assert.equal(frame.actions('release')[0]!.token, leaseToken);
});

test('a silent bridge times out by disabling interception before returning the native path', async (t) => {
  const frame = fixture({ replyTiming: 'manual' });
  const clock = deadlines(t, frame.page);
  const requests = immediateReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  assert.equal(requests.length, 0);
  clock.fire(3000);
  assert.equal(await pending, null);
  assert.equal(frame.actions('disable').length, 1);
  assert.equal(frame.actions('disable')[0]!.token, frame.actions('enable')[0]!.token);
  assert.equal(frame.root.isConnected, false);
  assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
  assert.equal(frame.actions('acquire').length, 1);
  frame.finishHandshake();
  await Promise.resolve();
  assert.equal(requests.length, 0);
  assert.equal(frame.actions('disable').length, 1);
});

test('stale target and unrelated request replies cannot start reads or consume the matching handshake', async (t) => {
  const frame = fixture({ replyTiming: 'manual' });
  const requests = immediateReads(t);
  let settled = false;
  const pending = acquireIndependentDirectory(target, new AbortController().signal).then((lease) => { settled = true; return lease; });
  const request = frame.actions('acquire')[0]!;
  frame.reply({ token: request.token, directoryId: '456', status: 'ready', leaseToken });
  frame.reply({ token: 'unrelated-independent-token-01', directoryId: target.directoryId, status: 'ready', leaseToken });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(requests.length, 0);
  frame.reply({ token: request.token, directoryId: target.directoryId, status: 'unsupported' });
  assert.equal(await pending, null);
  frame.finishHandshake();
  await Promise.resolve();
  assert.equal(requests.length, 0);
  assert.equal(frame.actions('disable').length, 0);
});

test('navigation to another directory during the handshake cannot start stale data reads', async (t) => {
  const frame = fixture({ replyTiming: 'manual' });
  const requests = immediateReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  frame.page.history.replaceState(null, '', '#directory/456');
  frame.finishHandshake();
  await assert.rejects(pending);
  assert.equal(requests.length, 0);
  assert.equal(frame.actions('release').length, 1);
});

test('an aborted or mismatched current route cannot request independent shell ownership', async (t) => {
  const frame = fixture();
  const requests = immediateReads(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(acquireIndependentDirectory(target, controller.signal), { name: 'AbortError' });
  for (const wrongTarget of [
    { ...target, directoryId: '456' }, { ...target, origin: 'https://other.myschoolapp.com' },
  ]) assert.equal(await acquireIndependentDirectory(wrongTarget, new AbortController().signal), null);
  frame.page.history.replaceState(null, '', '#studentmyday/progress');
  assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
  assert.equal(frame.actions('acquire').length, 0);
  assert.equal(requests.length, 0);
});

for (const [name, acquireReply] of [
  ['unsupported shell', (request: Record<string, unknown>) => ({ token: request.token, directoryId: target.directoryId, status: 'unsupported' })],
  ['invalid lease token', (request: Record<string, unknown>) => ({ token: request.token, directoryId: target.directoryId, status: 'ready', leaseToken: 'bad"token' })],
] as const) {
  test(`${name} keeps the original path available without starting client data reads`, async (t) => {
    const frame = fixture({ acquireReply });
    const requests = immediateReads(t);
    assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
    assert.equal(frame.actions('acquire').length, 1);
    assert.equal(requests.length, 0);
  });
}

for (const root of ['missing', 'nested', 'missing-header', 'wrong-owner', 'wrong-attribute', 'wrong-directory'] as const) {
  test(`a ${root} independent root requests the original view before any client data read`, async (t) => {
    const frame = fixture({ root });
    const requests = immediateReads(t);
    assert.equal(await acquireIndependentDirectory(target, new AbortController().signal), null);
    assert.equal(frame.actions('original').length, 1);
    assert.equal(frame.actions('original')[0]!.token, leaseToken);
    assert.equal(requests.length, 0);
  });
}

test('configuration and people transfer concurrently while the pending shell remains until both are ready', async (t) => {
  const frame = fixture();
  const reads = deferredReads(t);
  let resolved = false;
  const pending = acquireIndependentDirectory(target, new AbortController().signal).then((lease) => { resolved = true; return lease; });
  await reads.bothStarted;
  assert.deepEqual(reads.requests.map((request) => request.path).sort(), [
    '/api/directory/directoryget?directoryId=123',
    '/api/directory/directoryresultsget?directoryId=123&searchVal=&facets=&searchAll=false',
  ]);
  assert.equal(reads.requests[0]!.signal, reads.requests[1]!.signal);
  reads.finish('people');
  for (let count = 0; count < 5; count++) await Promise.resolve();
  assert.equal(resolved, false);
  assert.ok(frame.root.querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`));
  assert.equal(frame.root.querySelector('h1')!.textContent, 'Loading directory');
  reads.finish('configuration');
  const lease = await pending;
  assert.ok(lease);
  cleanups.push(lease.release);
  assert.equal(lease.root, frame.root);
  assert.equal(lease.name, 'Community directory');
  assert.equal(lease.searchOnly, false);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(lease.snapshot.complete, true);
  assert.equal(lease.snapshot.entries[0]!.photoUrl, `${target.origin}/user/large_user_example.jpg`);
  assert.equal(frame.root.querySelector('h1')!.textContent, 'Community directory');
  assert.equal(frame.root.querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`), null);
  assert.equal(reads.requests.length, 2);
  lease.release();
  lease.release();
  assert.equal(frame.actions('release').length, 1);
  assert.equal(lease.signal.aborted, false);
});

test('search-first configuration prevents a complete blank response from enabling local browsing', async (t) => {
  fixture();
  immediateReads(t, { ...configuration, DefaultResults: false });
  const lease = await acquireIndependentDirectory(target, new AbortController().signal);
  assert.ok(lease);
  cleanups.push(lease.release);
  assert.equal(lease.searchOnly, true);
  assert.equal(lease.snapshot.complete, false);
  // The feature masks initial entries for search-first mode; the lease carries
  // that policy even when an unexpected blank API response contains people.
  assert.equal(lease.snapshot.totalCount, 1);
});

test('a click-captured people read is reused while independent configuration starts separately', async (t) => {
  const frame = fixture();
  const source = new URL(`${target.origin}/app/student?svcid=edu#studentmyday/progress`);
  const destination = new URL(href);
  let current = source;
  let captures = 0;
  let captureSignal: AbortSignal | null = null;
  let finishCapture!: (value: ReturnType<typeof prepareDirectorySnapshot>) => void;
  const manager = createDirectoryLoadingManager((_target, signal) => {
    captures += 1;
    captureSignal = signal;
    return new Promise((resolve) => { finishCapture = resolve; });
  }, () => current, () => 0);
  cleanups.push(registerDirectoryLoadingManager(manager));
  assert.equal(manager.start(target, source, destination), true);
  current = destination;
  const reads = immediateReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  await Promise.resolve();
  assert.deepEqual(reads, ['/api/directory/directoryget?directoryId=123']);
  finishCapture(prepareDirectorySnapshot([row()], target.origin));
  const lease = await pending;
  assert.ok(lease);
  cleanups.push(lease.release);
  assert.equal(captures, 1);
  assert.equal((captureSignal as AbortSignal | null)?.aborted, false);
  assert.equal(lease.snapshot.totalCount, 1);
  assert.equal(frame.root.querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`), null);
});

test('route cancellation aborts both reads and releases independent ownership exactly once', async (t) => {
  const frame = fixture();
  const reads = deferredReads(t);
  const controller = new AbortController();
  const pending = acquireIndependentDirectory(target, controller.signal);
  await reads.bothStarted;
  assert.equal(reads.requests.length, 2);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(reads.requests.every((request) => request.signal.aborted), true);
  assert.equal(frame.actions('release').length, 1);
  assert.equal(frame.root.isConnected, false);
});

test('the exact source href must still match when independent data becomes ready', async (t) => {
  const frame = fixture();
  const reads = deferredReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  await reads.bothStarted;
  frame.page.history.replaceState(null, '', '?svcid=other#directory/123');
  reads.finish('configuration');
  reads.finish('people');
  await assert.rejects(pending, /directory changed/);
  assert.equal(frame.actions('release').length, 1);
});

for (const change of ['detached root', 'replaced owner', 'different directory marker'] as const) {
  test(`a ${change} cannot turn finished responses into a mounted lease`, async (t) => {
    const frame = fixture();
    const reads = deferredReads(t);
    const pending = acquireIndependentDirectory(target, new AbortController().signal);
    await reads.bothStarted;
    if (change === 'detached root') frame.root.remove();
    else if (change === 'replaced owner') frame.root.setAttribute(DIRECTORY_OWNER_ATTRIBUTE, 'replacement-directory-owner-01');
    else frame.root.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, '456');
    reads.finish('configuration');
    reads.finish('people');
    await assert.rejects(pending, /directory changed/);
    assert.equal(frame.actions('release').length, 1);
  });
}

test('an abort during the synchronous acquire reply releases the granted shell without starting data reads', async (t) => {
  const controller = new AbortController();
  const frame = fixture({ acquireReply: (request) => {
    controller.abort();
    return { token: request.token, directoryId: target.directoryId, status: 'ready', leaseToken };
  } });
  const requests = immediateReads(t);
  await assert.rejects(acquireIndependentDirectory(target, controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 0);
  assert.equal(frame.actions('release').length, 1);
  assert.equal(frame.root.isConnected, false);
});

test('page-side release aborts a pending acquisition and its sibling read', async (t) => {
  const frame = fixture();
  const reads = deferredReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  await reads.bothStarted;
  frame.reply({ token: leaseToken, directoryId: target.directoryId, status: 'released' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(reads.requests.every((request) => request.signal.aborted), true);
  assert.equal(frame.actions('release').length, 1);
});

test('page-side departure invalidates an active lease while malformed or unrelated replies cannot release it', async (t) => {
  const frame = fixture();
  immediateReads(t);
  const lease = await acquireIndependentDirectory(target, new AbortController().signal);
  assert.ok(lease);
  cleanups.push(lease.release);
  for (const detail of ['{', 'x'.repeat(4001), null, 123, JSON.stringify([])]) frame.sendRaw(detail);
  frame.reply({ token: 'unrelated-directory-token-01', status: 'released' });
  assert.equal(lease.signal.aborted, false);
  assert.equal(frame.actions('release').length, 0);
  frame.reply({ token: leaseToken, directoryId: target.directoryId, status: 'released' });
  assert.equal(lease.signal.aborted, true);
  assert.equal(frame.actions('release').length, 1);
  frame.reply({ token: leaseToken, status: 'released' });
  lease.release();
  assert.equal(frame.actions('release').length, 1);
});

test('the read deadline aborts both requests and returns ownership for native fallback', async (t) => {
  const frame = fixture();
  const reads = deferredReads(t);
  const clock = deadlines(t, frame.page);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  await reads.bothStarted;
  assert.equal(reads.requests.length, 2);
  clock.fire(15_000);
  await assert.rejects(pending, { name: 'TimeoutError' });
  assert.equal(reads.requests.every((request) => request.signal.aborted), true);
  assert.equal(frame.actions('release').length, 1);
  assert.equal(frame.root.isConnected, false);
});

test('malformed configuration aborts the sibling people read and releases the pending shell', async (t) => {
  const frame = fixture();
  const reads = deferredReads(t);
  const pending = acquireIndependentDirectory(target, new AbortController().signal);
  await reads.bothStarted;
  reads.finish('configuration', { ...configuration, DefaultResults: 'false' });
  await assert.rejects(pending, /unsupported format/);
  assert.equal(reads.requests.every((request) => request.signal.aborted), true);
  assert.equal(frame.actions('release').length, 1);
  assert.equal(frame.root.isConnected, false);
});
