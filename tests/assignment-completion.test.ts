import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { COMPLETION_NATIVE_ATTRIBUTE } from '../src/blackbaud/assignment-status.ts';
import { installAssignmentStatusPageBridge } from '../src/blackbaud/assignment-status-page.ts';
import { assignmentCompletionFeature } from '../src/features/assignment-completion.ts';
import { assignmentShortcutsFeature } from '../src/features/assignment-shortcuts.ts';
import { FeatureController } from '../src/runtime/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Settings } from '../src/shared/settings.ts';
import type { Cleanup } from '../src/shared/types.ts';

const sourceUrl = 'https://example.myschoolapp.com/lms-assignment/assignment-center/student/?svcid=edu';
const endpoint = '/api/assignment2/assignmentstatusupdate';
const hiddenAttribute = 'data-blackbaud-next-shortcut-hidden';
const rowSelector = 'sky-repeater-item.assignment-repeater-item';
const nativeStatuses = [
  { label: 'To do', value: -1 },
  { label: 'In progress', value: 0 },
  { label: 'Completed', value: 1 },
  { label: 'Overdue', value: 2 },
] as const;
type Outcome = 'success' | 'failure' | 'deferred';
interface NativeRequest {
  method: string;
  url: string;
  body: string;
  complete(httpStatus: number): void;
}

let dom: JSDOM | undefined;
let restore: Cleanup = () => {};
let stopBridge: Cleanup = () => {};
let pending: NativeRequest[] = [];
const cleanups: Cleanup[] = [];

function row(id = 123, status = 'To do', component = `<button type="button" aria-label="Native assignment status" aria-haspopup="dialog">${status}</button>`): string {
  return `<sky-repeater-item class="assignment-repeater-item" data-assignment-id="${id}"><div class="sky-repeater-item" role="row"><div class="sky-repeater-item-header"><app-assignment-title-link><a href="/lms-assignment/assignment/assignment-student-view/${id}">Assignment ${id}</a></app-assignment-title-link><div class="assignment-center-middle-block"><div class="assignment-details sky-font-deemphasized">Due: 10/13/2026 8:30 AM | Assigned: 10/1/2026 | 10 pts | Class</div><app-assignment-status-display>${component}</app-assignment-status-display></div></div></div></sky-repeater-item>`;
}

function page(rows = row()): string {
  return `<sky-toolbar><input aria-label="Search items"></sky-toolbar><main id="assignments"><sky-repeater-item id="native-group"><div class="sky-repeater-item-header">Native date group</div><div class="sky-repeater-item-body">${rows}</div></sky-repeater-item></main>`;
}

function fixture(html = page(), overdueIds: number[] = []) {
  dom = new JSDOM(`<app-root>${html}</app-root>`, { url: sourceUrl, pretendToBeVisual: true });
  const win = dom.window;
  const requests: NativeRequest[] = [];
  pending = requests;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: win, document: win.document, MutationObserver: win.MutationObserver })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  let outcome: Outcome = 'success';
  let nativeOpens = 0;
  const bound = new WeakSet<HTMLButtonElement>();
  class FakeXHR extends win.EventTarget {
    status = 0;
    responseType = 'json';
    private method = '';
    private url = '';
    private completed = false;
    get responseText(): never { throw new Error('Completion must not inspect native response bodies.'); }
    get response(): never { throw new Error('Completion must not inspect native response bodies.'); }
    open(method: string, url: string) { this.method = method; this.url = url; }
    send(body: string) {
      const request: NativeRequest = {
        method: this.method,
        url: this.url,
        body,
        complete: (httpStatus) => {
          if (this.completed) return;
          this.completed = true;
          this.status = httpStatus;
          this.dispatchEvent(new win.Event('load'));
          this.dispatchEvent(new win.Event('loadend'));
        },
      };
      requests.push(request);
      const selected = outcome;
      if (selected !== 'deferred') queueMicrotask(() => request.complete(selected === 'success' ? 200 : 503));
    }
  }
  Object.defineProperty(win, 'XMLHttpRequest', { configurable: true, value: FakeXHR });
  const bindNativeRows = () => {
    for (const nativeRow of document.querySelectorAll<HTMLElement>(rowSelector)) {
      const button = nativeRow.querySelector<HTMLButtonElement>('app-assignment-status-display button');
      if (!button || bound.has(button)) continue;
      bound.add(button);
      button.addEventListener('click', () => {
        nativeOpens++;
        if (document.querySelector('app-status-change-modal')) return;
        const assignmentIndexId = Number(nativeRow.dataset.assignmentId);
        const original = button.textContent?.trim();
        const choices = nativeStatuses.filter(({ label }) => label !== (overdueIds.includes(assignmentIndexId) ? 'To do' : 'Overdue'));
        let host = document.querySelector<HTMLElement>('body > sky-modal-host');
        if (!host) {
          host = document.createElement('sky-modal-host');
          const backdrop = document.createElement('div');
          backdrop.className = 'sky-modal-backdrop';
          host.append(backdrop);
        }
        const modal = document.createElement('app-status-change-modal');
        const background = document.querySelector('body > app-root');
        assert.ok(background);
        const previousHidden = background.getAttribute('aria-hidden');
        const close = () => {
          modal.remove();
          if (previousHidden === null) background.removeAttribute('aria-hidden');
          else background.setAttribute('aria-hidden', previousHidden);
        };
        modal.innerHTML = `${choices.map(({ label, value }) => `<sky-radio><label><input type="radio" name="assignment-status" aria-label="${label}" value="${value}"${label === original ? ' checked' : ''}>${label}</label></sky-radio>`).join('')}<button id="print-button" type="button">Save</button><button id="cancel-button" type="button">Cancel</button>`;
        modal.querySelector('#cancel-button')!.addEventListener('click', close);
        modal.querySelector('#print-button')!.addEventListener('click', () => {
          const selected = modal.querySelector<HTMLInputElement>('input[type="radio"]:checked');
          assert.ok(selected);
          const definition = choices.find(({ value }) => String(value) === selected.value);
          assert.ok(definition);
          const xhr = new FakeXHR();
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const current = document.querySelector<HTMLButtonElement>(`[data-assignment-id="${assignmentIndexId}"] app-assignment-status-display button`);
              if (current) current.textContent = definition.label;
              close();
            }
          });
          xhr.open('POST', endpoint);
          xhr.send(JSON.stringify({ assignmentIndexId, assignmentStatus: definition.value }));
        });
        background.setAttribute('aria-hidden', 'true');
        host.append(modal);
        if (!host.isConnected) document.body.append(host);
      });
    }
  };
  bindNativeRows();
  stopBridge = installAssignmentStatusPageBridge(win as unknown as Window & typeof globalThis);
  return { win, requests, bindNativeRows, setOutcome(value: Outcome) { outcome = value; }, get nativeOpens() { return nativeOpens; } };
}

function mount(shortcuts = false) {
  const controller = new FeatureController(shortcuts ? [assignmentShortcutsFeature, assignmentCompletionFeature] : [assignmentCompletionFeature]);
  controller.update(new URL(window.location.href), DEFAULT_SETTINGS);
  cleanups.push(() => controller.dispose());
  return controller;
}

function checkbox(id = 123): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`[data-assignment-id="${id}"] .bn-completion-control input[type="checkbox"]`);
  assert.ok(input, `Missing completion control for assignment ${id}`);
  return input;
}

function nativeButton(id = 123): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-assignment-id="${id}"] app-assignment-status-display button`);
  assert.ok(button);
  return button;
}

function button(label: string, selector = '.bn-completion-notice'): HTMLButtonElement {
  const control = [...document.querySelectorAll<HTMLButtonElement>(`${selector} button`)].find((element) => element.textContent?.trim() === label);
  assert.ok(control, `Missing ${label} action`);
  return control;
}

function assertRequest(request: NativeRequest | undefined, assignmentIndexId: number, assignmentStatus: number) {
  assert.ok(request);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, endpoint);
  assert.deepEqual(JSON.parse(request.body), { assignmentIndexId, assignmentStatus });
}

function nativeModalHost(): HTMLElement {
  const host = document.querySelector<HTMLElement>('body > sky-modal-host');
  assert.ok(host);
  return host;
}

function assertNativeModalClosed(host = nativeModalHost()) {
  assert.equal(host.isConnected, true, 'Native SkyModal keeps its host mounted after closing a dialog.');
  assert.equal(nativeModalHost(), host);
  assert.equal(host.querySelector('app-status-change-modal'), null);
  assert.equal(host.hasAttribute('data-blackbaud-next-completion-modal'), false);
  assert.equal([...document.querySelectorAll('style')].some((style) => style.textContent?.includes('data-blackbaud-next-completion-modal')), false);
}

async function flush() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const request of pending) request.complete(503);
  await flush();
  pending = [];
  stopBridge();
  stopBridge = () => {};
  dom?.window.close();
  dom = undefined;
  restore();
  restore = () => {};
});

test('completion checkbox uses native Save, confirms its result, and Undo restores To do without changing native ARIA', async () => {
  const native = fixture();
  const component = document.querySelector('app-assignment-status-display')!;
  const original = nativeButton();
  const aria = [original.getAttribute('aria-label'), original.getAttribute('aria-haspopup')];
  mount();
  const input = checkbox();
  assert.equal(input.checked, false);
  assert.equal(input.getAttribute('aria-label'), 'Completed: Assignment 123');
  assert.equal(component.getAttribute(COMPLETION_NATIVE_ATTRIBUTE), 'true');
  assert.equal(component.nextElementSibling?.className, 'bn-completion-control');
  input.click();
  const host = nativeModalHost();
  const backdrop = host.querySelector('.sky-modal-backdrop');
  await flush();
  assertRequest(native.requests[0], 123, 1);
  assert.equal(native.nativeOpens, 1);
  assert.equal(nativeButton().textContent, 'Completed');
  assert.equal(checkbox().checked, true);
  assert.equal(checkbox().disabled, false);
  assert.equal(document.querySelector('.bn-completion-control label span')!.textContent, 'Completed');
  assert.equal(document.querySelector('.bn-completion-feedback')!.textContent, '');
  assertNativeModalClosed(host);
  assert.deepEqual([original.getAttribute('aria-label'), original.getAttribute('aria-haspopup')], aria);
  button('Undo').click();
  await flush();
  assertRequest(native.requests[1], 123, -1);
  assert.equal(nativeButton().textContent, 'To do');
  assert.equal(checkbox().checked, false);
  assertNativeModalClosed(host);
  assert.equal(host.querySelector('.sky-modal-backdrop'), backdrop);
  button('Dismiss').click();
  assert.equal(document.querySelector('.bn-completion-notice'), null);
});

test('Undo restores original In progress status rather than collapsing it to To do', async () => {
  const native = fixture(page(row(123, 'In progress')));
  mount();
  assert.equal(document.querySelector('.bn-completion-control label span')!.textContent, 'To do');
  assert.equal(nativeButton().textContent, 'In progress');
  checkbox().click();
  await flush();
  assertRequest(native.requests[0], 123, 1);
  const host = nativeModalHost();
  button('Undo').click();
  await flush();
  assertRequest(native.requests[1], 123, 0);
  assert.equal(nativeButton().textContent, 'In progress');
  assert.equal(checkbox().checked, false);
  assertNativeModalClosed(host);
});

test('Overdue remains a native unfinished status and unchecking Completed chooses the native Overdue option', async () => {
  const native = fixture(page(row(123, 'Overdue')), [123]);
  mount();
  const badge = document.querySelector<HTMLElement>('.bn-completion-overdue')!;
  assert.equal(checkbox().checked, false);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'Overdue');
  checkbox().click();
  await flush();
  assert.equal(checkbox().checked, true);
  assert.equal(badge.hidden, true);
  checkbox().click();
  await flush();
  assertRequest(native.requests[1], 123, 2);
  assert.equal(nativeButton().textContent, 'Overdue');
  assert.equal(checkbox().checked, false);
  assert.equal(badge.hidden, false);
});

test('pending and failed saves keep native status and Unfinished filtering unchanged, then Retry confirms once', async () => {
  const native = fixture();
  native.setOutcome('deferred');
  mount(true);
  await flush();
  button('Unfinished', '.bn-assignment-shortcuts').click();
  const assignment = document.querySelector<HTMLElement>(rowSelector)!;
  checkbox().focus();
  checkbox().click();
  const host = nativeModalHost();
  const backdrop = host.querySelector('.sky-modal-backdrop');
  await flush();
  assertRequest(native.requests[0], 123, 1);
  assert.equal(nativeButton().textContent, 'To do');
  assert.equal(checkbox().checked, false);
  assert.equal(checkbox().disabled, true);
  assert.equal(document.querySelector('.bn-completion-feedback')!.textContent, 'Saving…');
  assert.equal(assignment.hasAttribute(hiddenAttribute), false);
  assert.equal(document.querySelector('.bn-completion-notice'), null);
  native.requests[0]!.complete(503);
  await flush();
  assert.equal(nativeButton().textContent, 'To do');
  assert.equal(checkbox().checked, false);
  assert.equal(checkbox().disabled, false);
  assert.equal(assignment.hasAttribute(hiddenAttribute), false);
  assertNativeModalClosed(host);
  const retry = button('Retry');
  assert.equal(document.activeElement, retry);
  native.setOutcome('success');
  retry.click();
  await flush();
  assert.equal(native.requests.length, 2);
  assertRequest(native.requests[1], 123, 1);
  assert.equal(nativeButton().textContent, 'Completed');
  assert.equal(checkbox().checked, true);
  assert.equal(assignment.getAttribute(hiddenAttribute), 'true');
  assert.ok(button('Undo').isConnected);
  assertNativeModalClosed(host);
  assert.equal(host.querySelector('.sky-modal-backdrop'), backdrop);
});

for (const result of [{ label: 'successful save', status: 200 }, { label: 'failed save with Retry', status: 503 }]) {
  test(`${result.label} does not steal focus from native Search selected while the request was pending`, async () => {
    const native = fixture();
    native.setOutcome('deferred');
    mount();
    checkbox().focus();
    checkbox().click();
    await flush();
    assert.equal(native.requests.length, 1);
    const search = document.querySelector<HTMLInputElement>('sky-toolbar input[aria-label="Search items"]')!;
    search.focus();
    assert.equal(document.activeElement, search);
    native.requests[0]!.complete(result.status);
    await flush();
    assert.equal(document.activeElement, search);
    assert.equal(checkbox().checked, result.status === 200);
    assert.equal(checkbox().disabled, false);
    assert.ok(button(result.status === 200 ? 'Undo' : 'Retry').isConnected);
    assertNativeModalClosed();
    assert.equal(native.requests.length, 1);
  });
}

for (const externalFocus of [false, true]) {
  test(`unsupported native fallback ${externalFocus ? 'preserves focus moved to native Search' : 'returns checkbox focus to the restored native status button'}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const native = fixture();
    const original = nativeButton();
    original.addEventListener('click', () => {
      for (const radio of document.querySelectorAll('app-status-change-modal sky-radio')) radio.remove();
    });
    mount();
    checkbox().focus();
    checkbox().click();
    await flush();
    const search = document.querySelector<HTMLInputElement>('sky-toolbar input[aria-label="Search items"]')!;
    if (externalFocus) search.focus();
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(document.querySelector('.bn-completion-control'), null);
    assert.equal(original.closest(`[${COMPLETION_NATIVE_ATTRIBUTE}]`), null);
    assert.equal(original.disabled, false);
    assert.equal(original.textContent, 'To do');
    assert.equal(document.activeElement, externalFocus ? search : original);
    assert.ok(document.querySelector('.bn-completion-notice[role="alert"]'));
    assertNativeModalClosed();
    assert.equal(native.requests.length, 0);
  });
}

test('confirmed completion hides the last Unfinished row but global Undo restores its native status and checkbox focus', async () => {
  const native = fixture(page(row(123, 'In progress')));
  mount(true);
  await flush();
  button('Unfinished', '.bn-assignment-shortcuts').click();
  const assignment = document.querySelector<HTMLElement>(rowSelector)!;
  const group = document.getElementById('native-group')!;
  checkbox().focus();
  checkbox().click();
  await flush();
  assert.equal(assignment.getAttribute(hiddenAttribute), 'true');
  assert.equal(group.getAttribute(hiddenAttribute), 'true');
  const undo = button('Undo');
  assert.equal(undo.closest(`[${hiddenAttribute}]`), null);
  undo.focus();
  undo.click();
  await flush();
  assertRequest(native.requests[1], 123, 0);
  assert.equal(nativeButton().textContent, 'In progress');
  assert.equal(assignment.hasAttribute(hiddenAttribute), false);
  assert.equal(group.hasAttribute(hiddenAttribute), false);
  assert.equal(checkbox().checked, false);
  assert.equal(document.activeElement, checkbox());
});

test('Undo returns focus to native Search when a native Completed filter removes the restored unfinished row', async (t) => {
  const native = fixture();
  mount();
  checkbox().click();
  await flush();
  const assignment = document.querySelector<HTMLElement>(rowSelector)!;
  const original = nativeButton();
  const nativeCompletedFilter = new dom!.window.MutationObserver(() => {
    if (original.textContent === 'To do') assignment.remove();
  });
  nativeCompletedFilter.observe(original, { childList: true, subtree: true, characterData: true });
  t.after(() => nativeCompletedFilter.disconnect());
  const undo = button('Undo');
  undo.focus();
  undo.click();
  await flush();
  assert.equal(native.requests.length, 2);
  assertRequest(native.requests[1], 123, -1);
  assert.equal(original.textContent, 'To do');
  assert.equal(assignment.isConnected, false);
  assert.equal(assignment.querySelector('.bn-completion-control'), null);
  assert.equal(assignment.querySelector('app-assignment-status-display')!.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  assert.equal(document.activeElement, document.querySelector('sky-toolbar input[aria-label="Search items"]'));
  assertNativeModalClosed();
});

test('locked, graded, static, unknown and foreign assignment controls remain entirely native', async () => {
  const native = fixture(page(
    row(123) +
    row(124, 'To do', '<button type="button" disabled aria-label="Locked status">To do</button>') +
    row(125, 'Graded') +
    row(126, 'Completed', '<span class="native-static-status">Completed</span>') +
    row(127, 'Submitted') +
    row(128, 'Unknown status') +
    row(129).replace('/lms-assignment/assignment/assignment-student-view/129', 'https://foreign.example/lms-assignment/assignment/assignment-student-view/129'),
  ));
  const unchanged = [...document.querySelectorAll<HTMLElement>(rowSelector)].slice(1).map((element) => ({ element, html: element.innerHTML }));
  mount();
  await flush();
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 1);
  for (const { element, html } of unchanged) assert.equal(element.innerHTML, html);
  assert.equal(native.nativeOpens, 0);
  assert.equal(native.requests.length, 0);
});

test('delayed native buttons, replaced components and whole-row rerenders mount one completion control and restore detached state', async () => {
  const native = fixture(page(row(123, 'To do', '')));
  mount();
  await flush();
  assert.equal(document.querySelector('.bn-completion-control'), null);
  const oldComponent = document.querySelector('app-assignment-status-display')!;
  oldComponent.innerHTML = '<button type="button">To do</button>';
  native.bindNativeRows();
  await flush();
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 1);
  oldComponent.outerHTML = '<app-assignment-status-display><button type="button">Completed</button></app-assignment-status-display>';
  native.bindNativeRows();
  await flush();
  assert.equal(oldComponent.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 1);
  assert.equal(checkbox().checked, true);
  const oldRow = document.querySelector<HTMLElement>(rowSelector)!;
  const detachedComponent = oldRow.querySelector('app-assignment-status-display')!;
  oldRow.outerHTML = row(123, 'In progress');
  native.bindNativeRows();
  await flush();
  assert.equal(detachedComponent.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  assert.equal(oldRow.querySelector('.bn-completion-control'), null);
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 1);
  assert.equal(checkbox().checked, false);
  assert.equal(nativeButton().textContent, 'In progress');
  assert.equal(native.requests.length, 0);
});

test('native ancestor visibility mounts and restores completion controls and follows the same row into a new parent', async () => {
  const native = fixture(`<section id="collapsed" hidden>${page()}</section><section id="other-native-parent"></section>`);
  const collapsed = document.getElementById('collapsed')!;
  const destination = document.getElementById('other-native-parent')!;
  const assignment = document.querySelector<HTMLElement>(rowSelector)!;
  const component = assignment.querySelector('app-assignment-status-display')!;
  const nativeMarkup = component.innerHTML;
  mount();
  await flush();
  assert.equal(assignment.querySelector('.bn-completion-control'), null);
  assert.equal(component.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  collapsed.hidden = false;
  await flush();
  assert.equal(assignment.querySelectorAll('.bn-completion-control').length, 1);
  assert.equal(checkbox().checked, false);
  assert.equal(component.getAttribute(COMPLETION_NATIVE_ATTRIBUTE), 'true');
  collapsed.hidden = true;
  await flush();
  assert.equal(assignment.querySelector('.bn-completion-control'), null);
  assert.equal(component.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  assert.equal(component.innerHTML, nativeMarkup);
  destination.append(assignment);
  await flush();
  assert.equal(assignment.querySelectorAll('.bn-completion-control').length, 1);
  assert.equal(component.getAttribute(COMPLETION_NATIVE_ATTRIBUTE), 'true');
  destination.hidden = true;
  await flush();
  assert.equal(assignment.querySelector('.bn-completion-control'), null);
  assert.equal(component.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  collapsed.hidden = false;
  await flush();
  assert.equal(assignment.querySelector('.bn-completion-control'), null, 'The old parent no longer controls the moved row.');
  destination.hidden = false;
  await flush();
  assert.equal(assignment.querySelectorAll('.bn-completion-control').length, 1);
  destination.style.display = 'none';
  await flush();
  assert.equal(assignment.querySelector('.bn-completion-control'), null);
  assert.equal(component.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  destination.style.removeProperty('display');
  await flush();
  assert.equal(assignment.querySelectorAll('.bn-completion-control').length, 1);
  assert.equal(component.innerHTML, nativeMarkup);
  assert.equal(native.nativeOpens, 0);
  assert.equal(native.requests.length, 0);
});

test('a native row replacement during Save receives the confirmed status without painting its detached predecessor', async () => {
  const native = fixture();
  native.setOutcome('deferred');
  mount();
  const originalRow = document.querySelector<HTMLElement>(rowSelector)!;
  const originalComponent = originalRow.querySelector('app-assignment-status-display')!;
  checkbox().click();
  await flush();
  originalRow.outerHTML = row();
  native.bindNativeRows();
  await flush();
  assert.equal(originalRow.querySelector('.bn-completion-control'), null);
  assert.equal(originalComponent.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 1);
  assert.equal(checkbox().disabled, true);
  native.requests[0]!.complete(200);
  await flush();
  assert.equal(nativeButton().textContent, 'Completed');
  assert.equal(checkbox().checked, true);
  assert.equal(checkbox().disabled, false);
  assert.equal(native.requests.length, 1);
  assert.ok(button('Undo').isConnected);
});

test('one pending native save disables other completion controls without creating another request', async () => {
  const native = fixture(page(row(123) + row(456, 'Completed')));
  native.setOutcome('deferred');
  mount();
  checkbox(123).click();
  await flush();
  assert.equal(checkbox(123).disabled, true);
  assert.equal(checkbox(456).disabled, true);
  checkbox(456).click();
  await flush();
  assert.equal(native.requests.length, 1);
  assert.equal(nativeButton(123).textContent, 'To do');
  assert.equal(nativeButton(456).textContent, 'Completed');
  assert.equal(document.querySelector('[data-assignment-id="456"] .bn-completion-feedback')!.textContent, '');
  native.requests[0]!.complete(200);
  await flush();
  assert.equal(checkbox(123).disabled, false);
  assert.equal(checkbox(456).disabled, false);
  assert.equal(checkbox(123).checked, true);
  assert.equal(native.requests.length, 1);
});

test('native SkyModal masking preserves mounted pending controls and closing restores the original background ARIA', async () => {
  const native = fixture(page(row(123) + row(456, 'In progress')));
  native.setOutcome('deferred');
  const background = document.querySelector('body > app-root')!;
  background.setAttribute('aria-hidden', 'false');
  mount();
  checkbox(123).click();
  await flush();
  assertRequest(native.requests[0], 123, 1);
  assert.equal(background.getAttribute('aria-hidden'), 'true');
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 2);
  assert.equal(checkbox(123).disabled, true);
  assert.equal(checkbox(456).disabled, true);
  assert.equal(document.querySelector('[data-assignment-id="123"] .bn-completion-feedback')!.textContent, 'Saving…');
  assert.equal(nativeButton(123).textContent, 'To do');
  assert.equal(nativeButton(456).textContent, 'In progress');
  native.requests[0]!.complete(200);
  await flush();
  assert.equal(background.getAttribute('aria-hidden'), 'false');
  assertNativeModalClosed();
  assert.equal(document.querySelectorAll('.bn-completion-control').length, 2);
  assert.equal(checkbox(123).checked, true);
  assert.equal(checkbox(123).disabled, false);
  assert.equal(checkbox(456).disabled, false);
  assert.equal(document.querySelector('.bn-completion-feedback')!.textContent, '');
});

test('an already-hidden native background does not qualify for the owned modal mask exception', async () => {
  const native = fixture();
  document.querySelector('body > app-root')!.setAttribute('aria-hidden', 'true');
  mount();
  await flush();
  assert.equal(document.querySelector('.bn-completion-control'), null);
  assert.equal(document.querySelector('app-assignment-status-display')!.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  assert.equal(native.nativeOpens, 0);
  assert.equal(native.requests.length, 0);
});

test('disabling removes an existing Undo notice and its detached action cannot save after re-enabling', async () => {
  const native = fixture();
  const controller = mount();
  checkbox().click();
  await flush();
  const oldUndo = button('Undo');
  controller.update(new URL(window.location.href), { ...DEFAULT_SETTINGS, assignmentCompletion: false });
  await flush();
  assert.equal(document.querySelector('.bn-completion-control, .bn-completion-notice'), null);
  assert.equal(document.querySelector('app-assignment-status-display')!.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE), false);
  controller.update(new URL(window.location.href), DEFAULT_SETTINGS);
  await flush();
  assert.equal(checkbox().checked, true);
  assert.equal(document.querySelector('.bn-completion-notice'), null);
  oldUndo.click();
  await flush();
  assert.equal(native.requests.length, 1);
  assert.equal(nativeButton().textContent, 'Completed');
  assert.equal(checkbox().checked, true);
});

const disableCases: Array<{ name: string; settings(settings: Settings): Settings }> = [
  { name: 'feature switch', settings: (settings) => ({ ...settings, assignmentCompletion: false }) },
  { name: 'master switch', settings: (settings) => ({ ...settings, enabled: false }) },
  { name: 'legacy assignment mode', settings: (settings) => ({ ...settings, oldAssignmentCenter: true }) },
];
for (const disabled of disableCases) {
  test(`${disabled.name} restores native state and an already-sent save cannot recreate completion UI`, async () => {
    const native = fixture();
    native.setOutcome('deferred');
    const component = document.querySelector('app-assignment-status-display')!;
    component.setAttribute(COMPLETION_NATIVE_ATTRIBUTE, 'preexisting-native-value');
    const controller = mount();
    const nativeAria = nativeButton().getAttribute('aria-label');
    checkbox().click();
    await flush();
    assert.equal(native.requests.length, 1);
    controller.update(new URL(window.location.href), disabled.settings(DEFAULT_SETTINGS));
    await flush();
    assert.equal(document.querySelector('.bn-completion-control, .bn-completion-notice'), null);
    assert.equal(document.querySelector('#blackbaud-next-assignment-completion'), null);
    assert.equal(component.getAttribute(COMPLETION_NATIVE_ATTRIBUTE), 'preexisting-native-value');
    assert.equal(nativeButton().getAttribute('aria-label'), nativeAria);
    native.requests[0]!.complete(200);
    await flush();
    assert.equal(nativeButton().textContent, 'Completed');
    assert.equal(document.querySelector('.bn-completion-control, .bn-completion-notice'), null);
    assert.equal(component.getAttribute(COMPLETION_NATIVE_ATTRIBUTE), 'preexisting-native-value');
    assert.equal(native.requests.length, 1);
    assertNativeModalClosed();
  });
}

test('pending completion observers yield to real timers and settle before the native network response', { timeout: 7000 }, async () => {
  if (process.env.BLACKBAUD_NEXT_COMPLETION_TIMER_CHILD !== '1') {
    const run = promisify(execFile);
    const environment: NodeJS.ProcessEnv = { ...process.env, BLACKBAUD_NEXT_COMPLETION_TIMER_CHILD: '1' };
    delete environment.NODE_TEST_CONTEXT;
    const { stdout } = await run(process.execPath, ['--experimental-strip-types', '--test', '--test-name-pattern=^pending completion observers yield', 'tests/assignment-completion.test.ts'], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      timeout: 5000,
    });
    assert.match(stdout, /pending completion observers yield to real timers/);
    return;
  }
  const native = fixture();
  native.setOutcome('deferred');
  mount();
  checkbox().click();
  let mutations = 0;
  const observer = new dom!.window.MutationObserver((records) => { mutations += records.length; });
  observer.observe(checkbox(), { attributes: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const settled = mutations;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(mutations, settled, 'Pending completion controls must stop mutating while the native network request is outstanding.');
  assert.equal(checkbox().disabled, true);
  assert.equal(native.requests.length, 1);
  native.requests[0]!.complete(200);
  await flush();
  assert.equal(checkbox().checked, true);
  assert.equal(checkbox().disabled, false);
  observer.disconnect();
});
