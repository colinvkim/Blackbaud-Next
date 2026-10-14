import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installAssignmentStatusPageBridge } from '../src/blackbaud/assignment-status-page.ts';
import { ASSIGNMENT_STATUS_REQUEST_EVENT, ASSIGNMENT_STATUS_RESPONSE_EVENT, assignmentStatusRequest, assignmentStatusResponse, isAssignmentStatusPage } from '../src/blackbaud/assignment-status-protocol.ts';
import type { AssignmentStatusResponse } from '../src/blackbaud/assignment-status-protocol.ts';
import type { Cleanup } from '../src/shared/types.ts';

const sourceUrl = 'https://example.myschoolapp.com/lms-assignment/assignment-center/student/?svcid=edu';
const endpoint = '/api/assignment2/assignmentstatusupdate';
const firstToken = '11111111-1111-4111-8111-111111111111';
const secondToken = '22222222-2222-4222-8222-222222222222';
const body = JSON.stringify({ assignmentIndexId: 123, assignmentStatus: 1 });
const cleanups: Cleanup[] = [];

function fixture(url = sourceUrl) {
  const dom = new JSDOM('<main>Native assignments</main>', { url });
  const win = dom.window;
  const responses: AssignmentStatusResponse[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  win.setTimeout = (handler: TimerHandler) => {
    const timer = ++nextTimer;
    timers.set(timer, () => { if (typeof handler === 'function') handler(); });
    return timer;
  };
  win.clearTimeout = (timer?: number) => { if (timer !== undefined) timers.delete(timer); };
  class FakeXHR extends win.EventTarget {
    status = 0;
    opened: unknown[][] = [];
    bodies: unknown[][] = [];
    openError: Error | null = null;
    sendError: Error | null = null;
    immediateStatus: number | null = null;
    responseType = '';
    responseTextValue = '{}';
    responseReads = 0;
    get responseText() { this.responseReads++; return this.responseTextValue; }
    get response(): never { throw new Error('Response bodies must remain unread.'); }
    open(...args: unknown[]) {
      this.opened.push(args);
      if (this.openError) throw this.openError;
      return 'native-open-result';
    }
    send(...args: unknown[]) {
      this.bodies.push(args);
      if (this.sendError) throw this.sendError;
      if (this.immediateStatus !== null) this.complete(this.immediateStatus);
      return 'native-send-result';
    }
    complete(status: number) {
      this.status = status;
      this.dispatchEvent(new win.Event('loadend'));
    }
  }
  const open = Object.getOwnPropertyDescriptor(FakeXHR.prototype, 'open');
  const send = Object.getOwnPropertyDescriptor(FakeXHR.prototype, 'send');
  Object.defineProperty(win, 'XMLHttpRequest', { configurable: true, value: FakeXHR });
  win.document.addEventListener(ASSIGNMENT_STATUS_RESPONSE_EVENT, (event) => {
    const response = assignmentStatusResponse('detail' in event ? event.detail : undefined);
    if (response) responses.push(response);
  });
  const cleanup = installAssignmentStatusPageBridge(win as unknown as Window & typeof globalThis);
  cleanups.push(cleanup, () => dom.window.close());
  const request = (value: unknown) => win.document.dispatchEvent(new win.CustomEvent(ASSIGNMENT_STATUS_REQUEST_EVENT, { detail: JSON.stringify(value) }));
  const arm = (token = firstToken, assignmentStatus = 1, assignmentIndexId = 123) => request({ action: 'arm', token, assignmentIndexId, assignmentStatus });
  const cancel = (token = firstToken) => request({ action: 'cancel', token });
  const assertRestored = () => {
    assert.deepEqual(Object.getOwnPropertyDescriptor(FakeXHR.prototype, 'open'), open);
    assert.deepEqual(Object.getOwnPropertyDescriptor(FakeXHR.prototype, 'send'), send);
  };
  return { dom, win, FakeXHR, responses, timers, request, arm, cancel, cleanup, assertRestored };
}

afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

test('status protocol accepts only bounded typed operations and current secure student-center routes', () => {
  for (const assignmentStatus of [-1, 0, 1, 2]) {
    const request = { action: 'arm', token: firstToken, assignmentIndexId: 123, assignmentStatus };
    assert.deepEqual(assignmentStatusRequest(JSON.stringify(request)), request);
  }
  assert.deepEqual(assignmentStatusRequest(JSON.stringify({ action: 'cancel', token: firstToken })), { action: 'cancel', token: firstToken });
  for (const fields of [{ token: 'not-a-uuid' }, { assignmentIndexId: 0 }, { assignmentIndexId: 1.5 }, { assignmentIndexId: Number.MAX_SAFE_INTEGER + 1 },
    { assignmentIndexId: '123' }, { assignmentStatus: 3 }, { assignmentStatus: '1' }, { action: 'write' }]) {
    assert.equal(assignmentStatusRequest(JSON.stringify({ action: 'arm', token: firstToken, assignmentIndexId: 123, assignmentStatus: 1, ...fields })), null);
  }
  for (const value of [null, {}, 'bad json', 'x'.repeat(501)]) assert.equal(assignmentStatusRequest(value), null);
  assert.equal(assignmentStatusResponse(JSON.stringify({ token: firstToken, status: 'failed', httpStatus: '503' })), null);
  assert.equal(assignmentStatusResponse(JSON.stringify({ token: firstToken, status: 'unavailable', reason: 'write' })), null);
  assert.equal(assignmentStatusResponse(JSON.stringify({ token: firstToken, status: 'invented' })), null);
  for (const url of [sourceUrl, sourceUrl.replace('/student/', '/student'), `${sourceUrl}&envid=1#native-filter`]) assert.equal(isAssignmentStatusPage(new URL(url)), true);
  for (const url of [sourceUrl.replace('https:', 'http:'), sourceUrl.replace('example.myschoolapp.com', 'foreign.example'),
    sourceUrl.replace('/student/', '/faculty/'), sourceUrl.replace('/student/', '/student/details'), sourceUrl.replace('https://', 'https://user:secret@')]) assert.equal(isAssignmentStatusPage(new URL(url)), false);
});

test('arming observes only a native matching send and restores descriptors before its response', () => {
  const { FakeXHR, responses, arm, assertRestored, timers } = fixture();
  arm();
  assert.deepEqual(responses, [{ token: firstToken, status: 'ready' }]);
  const xhr = new FakeXHR();
  assert.equal(xhr.open('POST', endpoint, true), 'native-open-result');
  const nativeBody = '{ "assignmentIndexId": 123, "assignmentStatus": 1 }';
  assert.equal(xhr.send(nativeBody), 'native-send-result');
  assert.deepEqual(xhr.opened, [['POST', endpoint, true]]);
  assert.deepEqual(xhr.bodies, [[nativeBody]]);
  assertRestored();
  assert.equal(timers.size, 0);
  assert.equal(responses.at(-1)?.status, 'sent');
  xhr.complete(204);
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'saved' });
  xhr.complete(503);
  assert.equal(responses.length, 3);
});

test('other methods, destinations, credentials and bodies remain native without settling the armed operation', () => {
  const { FakeXHR, responses, arm, assertRestored } = fixture();
  arm();
  const calls: [string, string, unknown, string?][] = [
    ['GET', endpoint, body], ['POST', '/api/assignment2/other', body], ['POST', `${endpoint}?query=1`, body], ['POST', `${endpoint}#fragment`, body],
    ['POST', `https://foreign.example${endpoint}`, body], ['POST', `https://user:secret@example.myschoolapp.com${endpoint}`, body],
    ['POST', endpoint, body, 'explicit-user'], ['POST', endpoint, JSON.stringify({ assignmentIndexId: 456, assignmentStatus: 1 })],
    ['POST', endpoint, JSON.stringify({ assignmentIndexId: 123, assignmentStatus: -1 })], ['POST', endpoint, JSON.stringify({ assignmentIndexId: 123, assignmentStatus: 1, extra: true })],
    ['POST', endpoint, 'invalid json'], ['POST', endpoint, { assignmentIndexId: 123, assignmentStatus: 1 }],
  ];
  for (const [method, url, value, username] of calls) {
    const xhr = new FakeXHR();
    xhr.open(method, url, true, username);
    assert.equal(xhr.send(value), 'native-send-result');
    assert.deepEqual(xhr.bodies, [[value]]);
    xhr.complete(200);
    assert.equal(xhr.responseReads, 0);
  }
  assert.deepEqual(responses, [{ token: firstToken, status: 'ready' }]);
  const matching = new FakeXHR();
  matching.open('post', `https://example.myschoolapp.com${endpoint}`);
  matching.send(body);
  assertRestored();
  matching.complete(200);
  assert.deepEqual(responses.map(({ status }) => status), ['ready', 'sent', 'saved']);
});

test('an unsent arm rejects busy operations, ignores another token and releases cleanly on cancellation', () => {
  const { responses, arm, cancel, assertRestored } = fixture();
  arm();
  arm(secondToken);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'unavailable', reason: 'busy' });
  cancel(secondToken);
  assert.equal(responses.length, 2);
  cancel();
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'released' });
  assertRestored();
  arm(secondToken, -1);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'ready' });
});

test('captured saves remain busy after cancellation until their exact HTTP failure settles', () => {
  const { FakeXHR, responses, arm, cancel, assertRestored } = fixture();
  arm();
  const xhr = new FakeXHR();
  xhr.open('POST', endpoint);
  xhr.send(body);
  cancel();
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'sent' });
  arm(secondToken);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'unavailable', reason: 'busy' });
  assertRestored();
  xhr.complete(503);
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'failed', httpStatus: 503 });
  arm(secondToken);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'ready' });
});

test('network abort and synchronous send failures report failure without swallowing native exceptions', () => {
  const { FakeXHR, responses, arm, assertRestored } = fixture();
  arm();
  const aborted = new FakeXHR();
  aborted.open('POST', endpoint);
  aborted.send(body);
  aborted.complete(0);
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'failed', httpStatus: 0 });
  arm(secondToken);
  const throwing = new FakeXHR();
  throwing.open('POST', endpoint);
  const error = new Error('Native send failed.');
  throwing.sendError = error;
  assert.throws(() => throwing.send(body), (caught) => caught === error);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'failed', httpStatus: 0 });
  assertRestored();
});

test('arm deadlines and unsupported source routes never create native requests', () => {
  const { responses, arm, timers, assertRestored, dom } = fixture();
  arm();
  assert.equal(timers.size, 1);
  for (const [timer, expire] of timers) { timers.delete(timer); expire(); }
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'unavailable', reason: 'timeout' });
  assertRestored();
  dom.reconfigure({ url: 'https://example.myschoolapp.com/lms-assignment/assignment/assignment-student-view/123' });
  arm(secondToken);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'unavailable', reason: 'unsupported' });
  assertRestored();
});

test('native open errors preserve their exception and cannot later match a send from that failed open', () => {
  const { FakeXHR, responses, arm, cancel, assertRestored } = fixture();
  arm();
  const xhr = new FakeXHR();
  const error = new Error('Native open failed.');
  xhr.openError = error;
  assert.throws(() => xhr.open('POST', endpoint), (caught) => caught === error);
  xhr.send(body);
  assert.deepEqual(responses, [{ token: firstToken, status: 'ready' }]);
  cancel();
  assertRestored();
});

test('restoration preserves later prototype method replacements', () => {
  const { FakeXHR, arm, cancel } = fixture();
  const originalSend = FakeXHR.prototype.send;
  arm();
  const replacement = () => 'another native owner';
  FakeXHR.prototype.open = replacement;
  cancel();
  assert.equal(FakeXHR.prototype.open, replacement);
  assert.equal(FakeXHR.prototype.send, originalSend);
});

test('pagehide releases unsent arms but a restored document remains usable and sent writes stay observed', () => {
  const { win, FakeXHR, responses, arm, assertRestored } = fixture();
  arm();
  win.dispatchEvent(new win.Event('pagehide'));
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'released' });
  assertRestored();
  arm(secondToken);
  const xhr = new FakeXHR();
  xhr.open('POST', endpoint);
  xhr.send(body);
  win.dispatchEvent(new win.Event('pagehide'));
  arm();
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'unavailable', reason: 'busy' });
  xhr.complete(200);
  assert.deepEqual(responses.at(-1), { token: secondToken, status: 'saved' });
  arm();
  assert.deepEqual(responses.at(-1), { token: firstToken, status: 'ready' });
});

test('explicit installer cleanup removes hooks and tracked result listeners without claiming a sent cancellation', () => {
  const { FakeXHR, responses, arm, cleanup, assertRestored } = fixture();
  arm();
  const xhr = new FakeXHR();
  xhr.open('POST', endpoint);
  xhr.send(body);
  cleanup();
  assertRestored();
  const count = responses.length;
  xhr.complete(200);
  arm(secondToken);
  assert.equal(responses.length, count);
});

test('synchronous synthetic terminal responses retain ready, sent, saved ordering and original send results', () => {
  const { FakeXHR, responses, arm, assertRestored } = fixture();
  arm();
  const xhr = new FakeXHR();
  xhr.immediateStatus = 200;
  xhr.open('POST', endpoint);
  assert.equal(xhr.send(body), 'native-send-result');
  assert.deepEqual(responses.map(({ status }) => status), ['ready', 'sent', 'saved']);
  assertRestored();
});

test('successful HTTP responses require native-compatible JSON syntax without retaining or forwarding response content', () => {
  const { FakeXHR, responses, arm } = fixture();
  for (const [value, responseType, expected] of [
    ['{}', '', 'saved'], ['{"privateNativeData":"not forwarded"}', 'text', 'saved'], ['', '', 'saved'], ['null', 'text', 'saved'],
    ['invalid native JSON', 'text', 'failed'], ['<html>Sign in</html>', '', 'failed'], [' ', 'text', 'failed'], ['', 'json', 'saved'],
  ]) {
    arm();
    const xhr = new FakeXHR();
    xhr.responseTextValue = value!;
    xhr.responseType = responseType!;
    xhr.open('POST', endpoint);
    xhr.send(body);
    xhr.complete(200);
    assert.equal(responses.at(-1)?.status, expected);
    assert.equal(xhr.responseReads, responseType === 'json' ? 0 : 1);
  }
  assert.equal(JSON.stringify(responses).includes('privateNativeData'), false);
  assert.equal(JSON.stringify(responses).includes('invalid native JSON'), false);
});
