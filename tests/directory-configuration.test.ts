import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchDirectoryConfiguration, normalizeDirectoryConfiguration } from '../src/blackbaud/directory-configuration.ts';
import type { DirectoryTarget } from '../src/blackbaud/directory.ts';

const origin = 'https://example.myschoolapp.com';
const target: DirectoryTarget = { directoryId: '27', origin };
const configuration = { DirectoryID: 27, DirectoryName: 'Community volunteers', DefaultResults: true };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function currentUrl(url = `${origin}/app/student?svcid=edu#directory/27`): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { location: new URL(url) } });
}

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('configuration keeps a bounded display name and the native search-first policy only', () => {
  const payload = { ...configuration, DirectoryName: '  Families  & friends – École  ', PrivateExtra: 'Not retained' };
  const projected = normalizeDirectoryConfiguration(payload, target);
  assert.deepEqual(projected, { name: 'Families & friends – École', searchOnly: false });
  assert.deepEqual(normalizeDirectoryConfiguration({ ...payload, DefaultResults: false }, target), { name: 'Families & friends – École', searchOnly: true });
  assert.deepEqual(normalizeDirectoryConfiguration({ ...payload, DirectoryName: 'A'.repeat(200) }, target), { name: 'A'.repeat(200), searchOnly: false });
  payload.DirectoryName = 'Changed raw payload';
  assert.equal(projected.name, 'Families & friends – École');
});

test('configuration rejects unknown structures, mismatched IDs and missing or coercible search policies', () => {
  for (const payload of [
    null, [], [configuration], true, 'directory', {},
    { ...configuration, DirectoryID: 28 }, { ...configuration, DirectoryID: '27' },
    { ...configuration, DirectoryID: 0 }, { ...configuration, DirectoryID: 27.5 },
    { ...configuration, DirectoryID: Number.MAX_SAFE_INTEGER + 1 },
    { ...configuration, DefaultResults: undefined }, { ...configuration, DefaultResults: null },
    { ...configuration, DefaultResults: 'false' }, { ...configuration, DefaultResults: 0 },
  ]) assert.throws(() => normalizeDirectoryConfiguration(payload, target), /unsupported format/);
  for (const directoryId of ['0', '027', '-1', '27&other=true', '9007199254740992']) {
    assert.throws(() => normalizeDirectoryConfiguration(configuration, { ...target, directoryId }), /unsupported format/);
  }
});

test('configuration rejects empty, excessive, HTML and control-bearing names', () => {
  for (const DirectoryName of ['', '   ', undefined, 27, 'A'.repeat(201), '<b>People</b>', 'Names\nOther', 'Names\tOther', '\u0000People', 'People\u007f', 'People\u0085']) {
    assert.throws(() => normalizeDirectoryConfiguration({ ...configuration, DirectoryName }, target), /unsupported format/);
  }
});

test('configuration fetch uses the current directory API with normal authentication and cancellation', async (t) => {
  currentUrl();
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, options?: RequestInit) => {
    requests += 1;
    assert.equal(String(path), '/api/directory/directoryget?directoryId=27');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.signal, controller.signal);
    assert.deepEqual(options?.headers, { accept: 'application/json' });
    return new Response(JSON.stringify(configuration));
  });
  assert.deepEqual(await fetchDirectoryConfiguration(target, controller.signal), { name: 'Community volunteers', searchOnly: false });
  for (const invalid of [
    { ...target, directoryId: '28' }, { ...target, directoryId: '027' },
    { ...target, directoryId: '27&other=true' }, { ...target, origin: 'https://other.myschoolapp.com' },
  ]) await assert.rejects(fetchDirectoryConfiguration(invalid, controller.signal), /identifier is invalid/);
  currentUrl(`${origin}/app/student?svcid=edu#studentmyday/progress`);
  await assert.rejects(fetchDirectoryConfiguration(target, controller.signal), /identifier is invalid/);
  assert.equal(requests, 1);
});

test('an already aborted configuration fetch never issues a request', async (t) => {
  currentUrl();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response(JSON.stringify(configuration)); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchDirectoryConfiguration(target, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 0);
});

test('a response arriving after cancellation is rejected before parsing its body', async (t) => {
  currentUrl();
  const controller = new AbortController();
  let resolve!: (response: Response) => void;
  let parsed = false;
  const response = new Response(JSON.stringify(configuration));
  t.mock.method(response, 'json', async () => { parsed = true; return configuration; });
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  const pending = fetchDirectoryConfiguration(target, controller.signal);
  controller.abort();
  resolve(response);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(parsed, false);
});

test('configuration rejects an exact route change before parsing a late response', async (t) => {
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  for (const destination of [
    `${origin}/app/student?svcid=edu#directory/28`, `${origin}/app/teacher?svcid=edu#directory/27`,
    `${origin}/app/student?svcid=other#directory/27`, `${origin}/app/student?svcid=edu#directory/27?view=list`,
    'https://other.myschoolapp.com/app/student?svcid=edu#directory/27',
  ]) {
    currentUrl();
    let parsed = false;
    const response = new Response(JSON.stringify(configuration));
    t.mock.method(response, 'json', async () => { parsed = true; return configuration; });
    const pending = fetchDirectoryConfiguration(target, new AbortController().signal);
    currentUrl(destination);
    resolve(response);
    await assert.rejects(pending, /directory changed/);
    assert.equal(parsed, false);
  }
});

test('configuration rejects navigation or cancellation while JSON parsing finishes', async (t) => {
  for (const cancel of [false, true]) {
    currentUrl();
    const controller = new AbortController();
    let resolve!: (payload: unknown) => void;
    let parsing!: () => void;
    const started = new Promise<void>((done) => { parsing = done; });
    const response = new Response('{}');
    t.mock.method(response, 'json', () => {
      parsing();
      return new Promise<unknown>((done) => { resolve = done; });
    });
    t.mock.method(globalThis, 'fetch', async () => response);
    const pending = fetchDirectoryConfiguration(target, controller.signal);
    await started;
    if (cancel) controller.abort();
    else currentUrl(`${origin}/app/student?svcid=edu#directory/28`);
    resolve(configuration);
    if (cancel) await assert.rejects(pending, { name: 'AbortError' });
    else await assert.rejects(pending, /directory changed/);
  }
});

test('configuration fails closed on HTTP failures, redirects, malformed JSON and mismatched payloads, then can retry', async (t) => {
  currentUrl();
  const redirected = new Response(JSON.stringify(configuration));
  Object.defineProperty(redirected, 'redirected', { value: true });
  for (const [response, expected] of [
    [new Response('Unavailable', { status: 503 }), /503/],
    [new Response('Unauthorized', { status: 401 }), /401/],
    [redirected, /redirected/],
    [new Response('<html>Sign in</html>'), /JSON/],
    [new Response(JSON.stringify({ ...configuration, DirectoryID: 28 })), /unsupported format/],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(fetchDirectoryConfiguration(target, new AbortController().signal), expected);
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(configuration)));
  assert.deepEqual(await fetchDirectoryConfiguration(target, new AbortController().signal), { name: 'Community volunteers', searchOnly: false });
});
