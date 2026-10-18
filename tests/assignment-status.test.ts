import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { AssignmentCompletionError, COMPLETION_NATIVE_ATTRIBUTE, completionSettledEvent, isAssignmentCompletionBusy, isAssignmentCompletionPage, readAssignmentCompletionTarget, setAssignmentCompletion } from '../src/blackbaud/assignment-status.ts';
import type { AssignmentCompletionTarget, ManualAssignmentStatus } from '../src/blackbaud/assignment-status.ts';
import { ASSIGNMENT_STATUS_REQUEST_EVENT, ASSIGNMENT_STATUS_RESPONSE_EVENT, assignmentStatusRequest } from '../src/blackbaud/assignment-status-protocol.ts';
import type { AssignmentStatusResponse } from '../src/blackbaud/assignment-status-protocol.ts';
import type { Cleanup } from '../src/shared/types.ts';

const pageUrl = 'https://example.myschoolapp.com/lms-assignment/assignment-center/student/?svcid=edu';
const labels = { todo: 'To do', 'in-progress': 'In progress', completed: 'Completed', overdue: 'Overdue' } as const;
const values = { todo: -1, 'in-progress': 0, completed: 1, overdue: 2 } as const;
let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
const cleanups: Cleanup[] = [];

function row(id = 123, status: ManualAssignmentStatus = 'todo'): string {
  return `<sky-repeater-item class="assignment-repeater-item"><app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/${id}">Example assignment ${id}</a></app-assignment-title-link><app-assignment-status-display><button type="button">${labels[status]}</button></app-assignment-status-display></sky-repeater-item>`;
}

function fixture(html = row(), url = pageUrl) {
  dom = new JSDOM(`<button id="focus">Original focus</button>${html}`, { url, pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  return dom.window;
}

function target(id = 123): AssignmentCompletionTarget {
  const link = document.querySelector<HTMLAnchorElement>(`a[href$="/${id}"]`)!;
  const result = readAssignmentCompletionTarget(link.closest<HTMLElement>('sky-repeater-item')!);
  assert.ok(result);
  return result;
}

function modal(previous: ManualAssignmentStatus, unfinished: 'todo' | 'overdue' = 'todo') {
  const host = document.createElement('sky-modal-host');
  host.innerHTML = `<div class="sky-modal-host-backdrop"></div><div></div><app-status-change-modal>
    ${[unfinished, 'in-progress', 'completed'].map((status) => `<sky-radio><input type="radio" name="sky-radio-group-1" aria-label="${labels[status as ManualAssignmentStatus]}" value="${values[status as ManualAssignmentStatus]}"${status === previous ? ' checked' : ''}>${labels[status as ManualAssignmentStatus]}</sky-radio>`).join('')}
    <button type="button" id="print-button" class="sky-btn sky-btn-primary">Save</button><button type="button" id="cancel-button">Cancel</button>
  </app-status-change-modal>`;
  const root = host.querySelector<HTMLElement>('app-status-change-modal')!;
  const save = root.querySelector<HTMLButtonElement>('#print-button')!;
  const cancel = root.querySelector<HTMLButtonElement>('#cancel-button')!;
  const close = () => root.remove();
  cancel.addEventListener('click', close);
  return { host, root, save, cancel, close };
}

function bridge() {
  let armed: { token: string; assignmentIndexId: number; assignmentStatus: -1 | 0 | 1 | 2 } | null = null;
  let cancellations = 0;
  const response = (result: AssignmentStatusResponse) => document.dispatchEvent(new dom!.window.CustomEvent(ASSIGNMENT_STATUS_RESPONSE_EVENT, { detail: JSON.stringify(result) }));
  const listen = (event: Event) => {
    if (!(event instanceof dom!.window.CustomEvent)) return;
    const request = assignmentStatusRequest(event.detail);
    if (!request) return;
    if (request.action === 'arm') {
      armed = request;
      response({ token: request.token, status: 'ready' });
    } else {
      cancellations += 1;
      response({ token: request.token, status: 'released' });
    }
  };
  document.addEventListener(ASSIGNMENT_STATUS_REQUEST_EVENT, listen);
  cleanups.push(() => document.removeEventListener(ASSIGNMENT_STATUS_REQUEST_EVENT, listen));
  return {
    get armed() { return armed; },
    get cancellations() { return cancellations; },
    reply(status: 'sent' | 'saved' | 'released') { assert.ok(armed); response({ token: armed.token, status }); },
    failed() { assert.ok(armed); response({ token: armed.token, status: 'failed', httpStatus: 503 }); },
    response,
  };
}

function start(current: AssignmentCompletionTarget, original: ManualAssignmentStatus = current.status, unfinished: 'todo' | 'overdue' = 'todo') {
  const ui = modal(original, unfinished);
  let saves = 0;
  let cancels = 0;
  current.button.addEventListener('click', () => document.body.append(ui.host), { once: true });
  ui.save.addEventListener('click', () => { saves += 1; });
  ui.cancel.addEventListener('click', () => { cancels += 1; });
  return { ...ui, get saves() { return saves; }, get cancels() { return cancels; } };
}

function control() {
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  return controller;
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function rejectsKind(kind: AssignmentCompletionError['kind']) {
  return (error: unknown) => error instanceof AssignmentCompletionError && error.kind === kind;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  dom?.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('completion pages accept secure student center aliases, native queries and fragments only', () => {
  for (const url of [pageUrl, pageUrl.replace('/student/', '/student'), `${pageUrl}&envid=example#filter`, pageUrl.replace('?svcid=edu', '')]) {
    assert.equal(isAssignmentCompletionPage(new URL(url)), true);
  }
  for (const url of [pageUrl.replace('https:', 'http:'), pageUrl.replace('example.myschoolapp.com', 'foreign.example'),
    pageUrl.replace('https://', 'https://user:secret@'), pageUrl.replace('/student/', '/teacher/'), pageUrl.replace('/student/', '/student/other/'),
    'https://example.myschoolapp.com/app/student?svcid=edu#studentmyday/assignment-center']) assert.equal(isAssignmentCompletionPage(new URL(url)), false);
});

test('target parsing requires one same-origin assignment and an editable native manual status', () => {
  fixture(row());
  const current = target();
  assert.equal(current.assignmentIndexId, '123');
  assert.equal(current.title, 'Example assignment 123');
  assert.equal(current.component.tagName, 'APP-ASSIGNMENT-STATUS-DISPLAY');
  for (const status of ['Submitted', 'Graded', 'Unknown']) {
    current.button.textContent = status;
    assert.equal(readAssignmentCompletionTarget(current.row), null);
  }
  current.button.textContent = 'Completed';
  current.button.disabled = true;
  assert.equal(readAssignmentCompletionTarget(current.row), null);
  current.button.disabled = false;
  current.row.setAttribute('inert', '');
  assert.equal(readAssignmentCompletionTarget(current.row), null);
  current.row.removeAttribute('inert');
  current.row.querySelector('a')!.setAttribute('href', 'https://foreign.example/lms-assignment/assignment/assignment-student-view/123');
  assert.equal(readAssignmentCompletionTarget(current.row), null);
});

test('owned hidden native components and shortcut-hidden rows stay usable without changing filters', () => {
  fixture(row());
  const current = target();
  current.component.setAttribute(COMPLETION_NATIVE_ATTRIBUTE, '');
  const style = document.createElement('style');
  style.textContent = `[${COMPLETION_NATIVE_ATTRIBUTE}], [data-blackbaud-next-shortcut-hidden="true"] { display:none!important; }`;
  document.head.append(style);
  current.row.setAttribute('data-blackbaud-next-shortcut-hidden', 'true');
  assert.ok(readAssignmentCompletionTarget(current.row));
  assert.equal(current.row.getAttribute('data-blackbaud-next-shortcut-hidden'), 'true');
  current.row.hidden = true;
  assert.equal(readAssignmentCompletionTarget(current.row), null);
  current.row.hidden = false;
  current.component.setAttribute('aria-disabled', 'true');
  assert.equal(readAssignmentCompletionTarget(current.row), null);
});

test('completion invokes the native radio and Save only after observer readiness and waits for network plus native state', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  let resolved = false;
  promise.then(() => { resolved = true; });
  assert.equal(ui.saves, 1);
  assert.equal(ui.root.querySelector<HTMLInputElement>('input[value="1"]')!.checked, true);
  assert.equal(observer.armed?.assignmentIndexId, 123);
  assert.equal(observer.armed?.assignmentStatus, 1);
  assert.equal(isAssignmentCompletionBusy(), true);
  assert.equal(isAssignmentCompletionBusy('123'), true);
  assert.equal(isAssignmentCompletionBusy('456'), false);
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'hidden');
  observer.reply('sent');
  current.button.textContent = 'Completed';
  ui.host.remove();
  await flush();
  assert.equal(resolved, false, 'Native optimistic status or modal closure cannot confirm the save.');
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(isAssignmentCompletionBusy(), false);
  assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
  assert.equal(document.querySelector('style'), null);
});

test('a native Save can capture and confirm its request synchronously without retaining ownership', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  let releases = 0;
  document.addEventListener(completionSettledEvent, () => { releases += 1; });
  ui.save.addEventListener('click', () => {
    observer.reply('sent');
    current.button.textContent = 'Completed';
    ui.close();
    observer.reply('saved');
  });

  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  assert.equal(ui.saves, 1);
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(isAssignmentCompletionBusy(), false);
  assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
  assert.equal(ui.root.hasAttribute('data-blackbaud-next-completion-modal'), false);
  assert.equal(document.querySelector('style'), null);
  t.mock.timers.tick(35_000);
  await flush();
  assert.equal(releases, 1);
});

test('a saved response waits for a replacement row with the same identity and ignores an unrelated row', async () => {
  fixture(row() + row(456));
  const current = target();
  const observer = bridge();
  start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  observer.reply('saved');
  target(456).button.textContent = 'Completed';
  await flush();
  assert.equal(isAssignmentCompletionBusy(), true);
  current.row.outerHTML = row(123, 'completed');
  await flush();
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
});

test('unfinished saves use the native available overdue option without deriving status from a date', async () => {
  fixture(row(123, 'completed'));
  const current = target();
  const observer = bridge();
  const ui = start(current, 'completed', 'overdue');
  const promise = setAssignmentCompletion(current, 'unfinished', control().signal);
  assert.equal(ui.root.querySelector<HTMLInputElement>('input[value="2"]')!.checked, true);
  assert.equal(observer.armed?.assignmentStatus, 2);
  current.button.textContent = 'Overdue';
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'completed', current: 'overdue' });
});

test('captured initially checked In progress survives a completed change and exact Undo', async () => {
  fixture(row(123, 'in-progress'));
  const observer = bridge();
  const first = target();
  start(first, 'in-progress');
  const completion = setAssignmentCompletion(first, 'completed', control().signal);
  first.button.textContent = 'Completed';
  observer.reply('saved');
  const result = await completion;
  assert.deepEqual(result, { previous: 'in-progress', current: 'completed' });
  document.querySelector('sky-modal-host')?.remove();
  const second = target();
  start(second, 'completed');
  const undo = setAssignmentCompletion(second, result.previous, control().signal);
  assert.equal(observer.armed?.assignmentStatus, 0);
  second.button.textContent = 'In progress';
  observer.reply('saved');
  assert.deepEqual(await undo, { previous: 'completed', current: 'in-progress' });
});

test('one active document operation rejects concurrent changes and stays active after feature abort and pagehide', async () => {
  fixture(row() + row(456));
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const controller = control();
  const promise = setAssignmentCompletion(current, 'completed', controller.signal);
  observer.reply('sent');
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'hidden');
  controller.abort();
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'visible', 'Disabling the feature must reveal the pending native dialog.');
  assert.equal(ui.cancels, 0, 'UI cleanup cannot cancel a captured native save.');
  assert.equal(ui.root.isConnected, true);
  assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), true, 'Terminal cleanup still owns this exact dialog.');
  dom!.window.dispatchEvent(new dom!.window.Event('pagehide'));
  assert.equal(isAssignmentCompletionBusy(), true);
  await assert.rejects(setAssignmentCompletion(target(456), 'completed', control().signal), rejectsKind('busy'));
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('native HTTP failure releases the operation without overwriting optimistic native state', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  let settled = 0;
  document.addEventListener(completionSettledEvent, () => { settled += 1; });
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  current.button.textContent = 'Completed';
  observer.failed();
  await assert.rejects(promise, rejectsKind('failed'));
  assert.equal(current.button.textContent, 'Completed');
  assert.equal(isAssignmentCompletionBusy(), false);
  assert.equal(settled, 1);
  assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
});

test('abort before a delayed Save cancels only the owned native modal and restores exact focus', async () => {
  fixture(row());
  const current = target();
  const focused = document.querySelector<HTMLButtonElement>('#focus')!;
  focused.focus();
  const ui = start(current);
  ui.save.disabled = true;
  const controller = control();
  const promise = setAssignmentCompletion(current, 'completed', controller.signal);
  const rejected = assert.rejects(promise, { name: 'AbortError' });
  assert.equal(ui.saves, 0);
  ui.root.querySelector<HTMLInputElement>('input')!.focus();
  controller.abort();
  await rejected;
  assert.equal(ui.cancels, 1);
  assert.equal(ui.root.isConnected, false);
  assert.equal(ui.host.isConnected, true);
  assert.equal(document.activeElement, focused);
  assert.equal(isAssignmentCompletionBusy(), false);
  ui.save.disabled = false;
  await flush();
  assert.equal(ui.saves, 0);
});

test('pre-Save cancellation preserves moved focus when native Cancel restores its opener', async () => {
  fixture(`<input id="search" aria-label="Search">${row()}`);
  const current = target();
  const original = document.querySelector<HTMLButtonElement>('#focus')!;
  const search = document.querySelector<HTMLInputElement>('#search')!;
  original.focus();
  const ui = start(current);
  ui.save.disabled = true;
  ui.cancel.addEventListener('click', () => original.focus());
  const controller = control();
  const promise = setAssignmentCompletion(current, 'completed', controller.signal);
  const rejected = assert.rejects(promise, { name: 'AbortError' });
  search.focus();
  controller.abort();
  await rejected;
  assert.equal(document.activeElement, search);
  assert.equal(ui.cancels, 1);
  assert.equal(ui.saves, 0);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('pre-Save cancellation leaves a newly focused unrelated native control alone', async () => {
  fixture(`<input id="search" aria-label="Search">${row()}`);
  const current = target();
  const original = document.querySelector<HTMLButtonElement>('#focus')!;
  const search = document.querySelector<HTMLInputElement>('#search')!;
  original.focus();
  const ui = start(current);
  ui.save.disabled = true;
  ui.cancel.addEventListener('click', () => search.focus());
  const controller = control();
  const promise = setAssignmentCompletion(current, 'completed', controller.signal);
  const rejected = assert.rejects(promise, { name: 'AbortError' });
  ui.root.querySelector<HTMLInputElement>('input')!.focus();
  controller.abort();
  await rejected;
  assert.equal(document.activeElement, search);
  assert.equal(ui.cancels, 1);
  assert.equal(ui.saves, 0);
});

test('an observer timeout before capturing native XHR releases the canceled dialog for other assignments', async () => {
  fixture(row() + row(456));
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unconfirmed'));
  assert.equal(ui.saves, 1);
  assert.ok(observer.armed);
  observer.response({ token: observer.armed.token, status: 'unavailable', reason: 'timeout' });
  await rejected;
  assert.equal(ui.cancels, 1);
  assert.equal(ui.root.isConnected, false);
  assert.equal(ui.host.isConnected, true);
  assert.equal(document.querySelector('style'), null);
  assert.equal(isAssignmentCompletionBusy(), false);
  const next = target(456);
  const nextUi = start(next);
  const nextSave = setAssignmentCompletion(next, 'completed', control().signal);
  assert.equal(nextUi.saves, 1);
  next.button.textContent = 'Completed';
  observer.reply('saved');
  await nextSave;
});

test('an unavailable observer cannot release a captured native request before its terminal result', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unconfirmed'));
  observer.reply('sent');
  assert.ok(observer.armed);
  observer.response({ token: observer.armed.token, status: 'unavailable', reason: 'timeout' });
  await rejected;
  assert.equal(isAssignmentCompletionBusy(), true);
  assert.equal(ui.cancels, 0);
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'visible');
  current.button.textContent = 'Completed';
  observer.reply('saved');
  await flush();
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('an existing native modal and malformed labels fail open without saving or hiding unrelated dialogs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const existing = modal('todo');
  document.body.append(existing.host);
  await assert.rejects(setAssignmentCompletion(current, 'completed', control().signal), rejectsKind('unsupported'));
  assert.equal(existing.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
  existing.host.remove();
  const ui = start(current);
  ui.root.querySelector('sky-radio')!.lastChild!.textContent = 'Unexpected option';
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unsupported'));
  t.mock.timers.tick(5_000);
  await rejected;
  assert.equal(ui.saves, 0);
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('missing observer readiness cancels the owned dialog before Save', async () => {
  fixture(row());
  const ui = start(target());
  await assert.rejects(setAssignmentCompletion(target(), 'completed', control().signal), rejectsKind('unsupported'));
  assert.equal(ui.saves, 0);
  assert.equal(ui.cancels, 1);
  assert.equal(document.querySelector('style'), null);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('a delayed native modal becomes ready through mutations and validates the row again before Save', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = modal('todo');
  ui.save.disabled = true;
  let saves = 0;
  ui.save.addEventListener('click', () => { saves += 1; });
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unsupported'));
  document.body.append(ui.host);
  await flush();
  assert.equal(saves, 0);
  current.row.querySelector('a')!.setAttribute('href', '/lms-assignment/assignment/assignment-student-view/456');
  ui.save.disabled = false;
  await flush();
  await rejected;
  assert.equal(saves, 0);
  assert.equal(observer.armed, null);
});

test('a long save is unconfirmed while the document stays busy until the native request actually settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unconfirmed'));
  observer.reply('sent');
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(isAssignmentCompletionBusy(), true);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  await flush();
  assert.equal(isAssignmentCompletionBusy(), false);
});

for (const confirmation of ['updated', 'expired'] as const) {
  test(`a success near the caller deadline retains ownership until list confirmation is ${confirmation}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    fixture(row());
    const current = target();
    const observer = bridge();
    const ui = start(current);
    let releases = 0;
    document.addEventListener(completionSettledEvent, () => { releases += 1; });
    const promise = setAssignmentCompletion(current, 'completed', control().signal);
    const rejected = assert.rejects(promise, rejectsKind('unconfirmed'));
    observer.reply('sent');
    t.mock.timers.tick(29_000);
    observer.reply('saved');
    t.mock.timers.tick(1_000);
    await rejected;
    assert.equal(isAssignmentCompletionBusy(), true);
    assert.equal(releases, 0);
    assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'visible');

    if (confirmation === 'updated') {
      current.button.textContent = 'Completed';
      await flush();
      assert.equal(ui.cancels, 1);
    } else {
      t.mock.timers.tick(4_000);
      await flush();
      assert.equal(current.button.textContent, 'To do');
      assert.equal(ui.cancels, 0);
    }
    assert.equal(isAssignmentCompletionBusy(), false);
    assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(releases, 1);
  });
}

test('a native failure after the caller deadline releases ownership for a fresh explicit retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unconfirmed'));
  observer.reply('sent');
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(isAssignmentCompletionBusy(), true);
  observer.failed();
  await flush();
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), false);

  const retry = start(target());
  const retried = setAssignmentCompletion(target(), 'completed', control().signal);
  assert.equal(retry.saves, 1);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await retried, { previous: 'todo', current: 'completed' });
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('a successful native request with a missing row becomes unconfirmed rather than painting a detached row', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('unconfirmed'));
  current.row.remove();
  observer.reply('saved');
  t.mock.timers.tick(5_000);
  await rejected;
  assert.equal(current.button.textContent, 'To do');
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('native successful filtering may remove the confirmed row and closed modal without losing acknowledgement', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  current.row.remove();
  ui.host.remove();
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(current.button.textContent, 'To do', 'The adapter cannot paint a detached row.');
  assert.equal(readAssignmentCompletionTarget(current.row), null);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('malformed native 2xx responses are unconfirmed and never treated as a safe automatic retry', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  assert.ok(observer.armed);
  observer.response({ token: observer.armed.token, status: 'failed', httpStatus: 200 });
  await assert.rejects(promise, rejectsKind('unconfirmed'));
  assert.equal(current.button.textContent, 'To do');
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('a dialog whose initially selected status does not match the triggering row is never saved', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current, 'completed');
  await assert.rejects(setAssignmentCompletion(current, 'completed', control().signal), rejectsKind('unsupported'));
  assert.equal(ui.saves, 0);
  assert.equal(observer.armed, null);
  assert.equal(ui.cancels, 1);
});

test('native due-date normalization between To do and Overdue is accepted and retained for Undo', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current, 'overdue', 'overdue');
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'overdue', current: 'completed' });
  ui.host.remove();
  start(target(), 'completed', 'overdue');
  const undo = setAssignmentCompletion(target(), 'todo', control().signal);
  assert.equal(observer.armed?.assignmentStatus, 2);
  current.button.textContent = 'Overdue';
  observer.reply('saved');
  assert.deepEqual(await undo, { previous: 'completed', current: 'overdue' });
});

test('synchronous native radio handlers cannot save a stale assignment', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  ui.root.querySelector<HTMLInputElement>('input[value="1"]')!.addEventListener('click', () => {
    current.row.querySelector('a')!.setAttribute('href', '/lms-assignment/assignment/assignment-student-view/456');
  });
  await assert.rejects(setAssignmentCompletion(current, 'completed', control().signal), rejectsKind('unsupported'));
  assert.equal(ui.saves, 0);
  assert.equal(observer.armed, null);
});

test('navigation during observer readiness cancels before the native Save can fire', async () => {
  fixture(row());
  const current = target();
  bridge();
  const ui = start(current);
  document.addEventListener(ASSIGNMENT_STATUS_REQUEST_EVENT, (event) => {
    if (!(event instanceof dom!.window.CustomEvent)) return;
    if (assignmentStatusRequest(event.detail)?.action === 'arm') dom!.reconfigure({ url: `${pageUrl}#different-filter` });
  });
  await assert.rejects(setAssignmentCompletion(current, 'completed', control().signal), rejectsKind('unsupported'));
  assert.equal(ui.saves, 0);
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('successful residual modal animation remains concealed until its native close finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  ui.cancel.removeEventListener('click', ui.close);
  ui.cancel.addEventListener('click', () => { setTimeout(ui.close, 200); });
  const other = document.createElement('sky-modal-host');
  other.innerHTML = '<app-other-modal>Another native dialog</app-other-modal>';
  document.body.append(other);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), true);
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'hidden');
  assert.equal(dom!.window.getComputedStyle(other).visibility, 'visible');
  t.mock.timers.tick(200);
  await flush();
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(isAssignmentCompletionBusy(), false);
  assert.equal(document.querySelector('style'), null);
  assert.equal(other.isConnected, true);
});

test('known HTTP failure closes only the owned modal and permits a fresh explicit retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  ui.cancel.removeEventListener('click', ui.close);
  ui.cancel.addEventListener('click', () => { setTimeout(ui.close, 200); });
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('failed'));
  observer.failed();
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), true);
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'hidden');
  t.mock.timers.tick(200);
  await flush();
  await rejected;
  assert.equal(isAssignmentCompletionBusy(), false);
  const retryUi = start(target());
  const retry = setAssignmentCompletion(target(), 'completed', control().signal);
  assert.equal(retryUi.saves, 1);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await retry, { previous: 'todo', current: 'completed' });
});

test('late acknowledgement cleans only its exact dialog when another native status modal has opened', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const controller = control();
  const promise = setAssignmentCompletion(current, 'completed', controller.signal);
  observer.reply('sent');
  controller.abort();
  const other = modal('todo');
  let otherCancels = 0;
  other.cancel.addEventListener('click', () => { otherCancels += 1; });
  document.body.append(other.host);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(ui.cancels, 1);
  assert.equal(ui.root.isConnected, false);
  assert.equal(ui.host.isConnected, true);
  assert.equal(other.host.isConnected, true);
  assert.equal(otherCancels, 0);
  assert.equal(other.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
});

test('the owned native modal background accessibility mask preserves editable targets through Save and Cancel', async () => {
  fixture(`<app-root>${row()}${row(456)}</app-root>`);
  const current = target();
  const background = document.querySelector<HTMLElement>('app-root')!;
  const observer = bridge();
  const ui = start(current);
  current.button.addEventListener('click', () => background.setAttribute('aria-hidden', 'true'), { once: true });
  ui.cancel.addEventListener('click', () => background.removeAttribute('aria-hidden'));
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  assert.equal(ui.saves, 1);
  assert.equal(background.getAttribute('aria-hidden'), 'true', 'The adapter must not edit SkyModal accessibility state.');
  assert.ok(readAssignmentCompletionTarget(current.row));
  assert.ok(readAssignmentCompletionTarget(target(456).row), 'Other controls stay mounted under the same owned page mask.');
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(background.hasAttribute('aria-hidden'), false);
  assert.equal(ui.cancels, 1);
  assert.equal(isAssignmentCompletionBusy(), false);
});

test('pre-existing and unrelated accessibility masks remain rejected while an owned modal is pending', async () => {
  fixture(`<app-root>${row()}${row(456)}</app-root><app-root id="other" aria-hidden="true">${row(789)}</app-root>`);
  const background = document.querySelector<HTMLElement>('app-root')!;
  const rowElement = background.querySelector<HTMLElement>('sky-repeater-item')!;
  background.setAttribute('aria-hidden', 'true');
  assert.equal(readAssignmentCompletionTarget(rowElement), null);
  background.removeAttribute('aria-hidden');
  const current = target();
  const observer = bridge();
  const ui = start(current);
  current.button.addEventListener('click', () => background.setAttribute('aria-hidden', 'true'), { once: true });
  ui.cancel.addEventListener('click', () => background.removeAttribute('aria-hidden'));
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const unrelated = document.querySelector<HTMLElement>('#other sky-repeater-item')!;
  assert.equal(readAssignmentCompletionTarget(unrelated), null);
  current.row.setAttribute('aria-hidden', 'true');
  assert.equal(readAssignmentCompletionTarget(current.row), null);
  current.row.removeAttribute('aria-hidden');
  background.setAttribute('inert', '');
  assert.equal(readAssignmentCompletionTarget(current.row), null);
  background.removeAttribute('inert');
  current.button.textContent = 'Completed';
  observer.reply('saved');
  await promise;
  background.setAttribute('aria-hidden', 'true');
  assert.equal(readAssignmentCompletionTarget(current.row), null, 'The temporary exception ends with its owning operation.');
});

test('terminal failure restores a persistent native host and permits a new modal to reuse it', async () => {
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  const rejected = assert.rejects(promise, rejectsKind('failed'));
  observer.failed();
  await rejected;
  assert.equal(ui.root.isConnected, false);
  assert.equal(ui.host.isConnected, true);
  assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
  assert.equal(document.querySelector('style'), null);
  assert.equal(isAssignmentCompletionBusy(), false);
  const next = modal('todo');
  ui.host.append(next.root);
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'visible');
  assert.equal(next.root.hasAttribute('data-blackbaud-next-completion-modal'), false);
});

test('a reused persistent host cannot conceal a newer modal or extend the old background mask', async () => {
  fixture(`<app-root>${row()}</app-root>`);
  const current = target();
  const background = document.querySelector<HTMLElement>('app-root')!;
  const observer = bridge();
  const ui = start(current);
  current.button.addEventListener('click', () => background.setAttribute('aria-hidden', 'true'), { once: true });
  const promise = setAssignmentCompletion(current, 'completed', control().signal);
  observer.reply('sent');
  assert.ok(readAssignmentCompletionTarget(current.row));
  ui.root.remove();
  const next = modal('todo');
  let nextCanceled = 0;
  next.cancel.addEventListener('click', () => { nextCanceled += 1; });
  ui.host.append(next.root);
  assert.equal(dom!.window.getComputedStyle(ui.host).visibility, 'visible');
  assert.equal(readAssignmentCompletionTarget(current.row), null, 'A host alone cannot grant an accessibility exception.');
  background.removeAttribute('aria-hidden');
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await promise, { previous: 'todo', current: 'completed' });
  assert.equal(ui.host.isConnected, true);
  assert.equal(next.root.isConnected, true);
  assert.equal(nextCanceled, 0);
  assert.equal(ui.host.hasAttribute('data-blackbaud-next-completion-modal'), false);
  assert.equal(document.querySelector('style'), null);
});

test('property-only radio initialization becomes ready on the first save and a persistent-host Retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const observer = bridge();
  const ui = start(current);
  for (const input of ui.root.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
  const first = setAssignmentCompletion(current, 'completed', control().signal);
  const firstRejected = assert.rejects(first, rejectsKind('failed'));
  await flush();
  assert.equal(ui.saves, 0);
  ui.root.querySelector<HTMLInputElement>('input[value="-1"]')!.checked = true;
  await flush();
  assert.equal(ui.saves, 0, 'Setting checked alone must not rely on an attribute mutation.');
  t.mock.timers.tick(100);
  assert.equal(ui.saves, 1);
  let scans = 0;
  const query = document.querySelectorAll.bind(document);
  t.mock.method(document, 'querySelectorAll', (selector: string) => { scans += 1; return query(selector); });
  t.mock.timers.tick(500);
  assert.equal(scans, 0, 'Readiness polling must stop once native Save fires.');
  observer.failed();
  await firstRejected;
  assert.equal(ui.host.isConnected, true);
  const retry = modal('todo');
  for (const input of retry.root.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
  let retrySaves = 0;
  current.button.addEventListener('click', () => ui.host.append(retry.root), { once: true });
  retry.save.addEventListener('click', () => { retrySaves += 1; });
  const second = setAssignmentCompletion(target(), 'completed', control().signal);
  await flush();
  assert.equal(retrySaves, 0);
  retry.root.querySelector<HTMLInputElement>('input[value="-1"]')!.checked = true;
  await flush();
  assert.equal(retrySaves, 0);
  t.mock.timers.tick(100);
  assert.equal(retrySaves, 1);
  current.button.textContent = 'Completed';
  observer.reply('saved');
  assert.deepEqual(await second, { previous: 'todo', current: 'completed' });
  const settledScans = scans;
  t.mock.timers.tick(30_000);
  assert.equal(scans, settledScans, 'No readiness timer may remain after release.');
  assert.equal(retrySaves, 1);
});

test('canceling property-only initialization removes its readiness timer before later native checks', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fixture(row());
  const current = target();
  const ui = start(current);
  for (const input of ui.root.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
  const controller = control();
  const promise = setAssignmentCompletion(current, 'completed', controller.signal);
  const rejected = assert.rejects(promise, { name: 'AbortError' });
  controller.abort();
  await rejected;
  ui.root.querySelector<HTMLInputElement>('input[value="-1"]')!.checked = true;
  let scans = 0;
  const query = document.querySelectorAll.bind(document);
  t.mock.method(document, 'querySelectorAll', (selector: string) => { scans += 1; return query(selector); });
  t.mock.timers.tick(5_000);
  assert.equal(scans, 0);
  assert.equal(ui.saves, 0);
  assert.equal(isAssignmentCompletionBusy(), false);
});
