import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mountPopup } from '../src/popup/controller.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const html = await readFile(new URL('../src/popup/index.html', import.meta.url), 'utf8');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(options: { failRead?: boolean } = {}) {
  const dom = new JSDOM(html, { url: 'https://extension.example/popup.html' });
  const document = dom.window.document;
  const values: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  const writes: Record<string, unknown>[] = [];
  const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
  const heldWrites: (() => void)[] = [];
  const scope = globalThis as typeof globalThis & { chrome?: unknown };
  const previousChrome = scope.chrome;
  let failRead = options.failRead ?? false;
  let failWrite = false;
  let holdWrites = false;
  const notify = () => { for (const listener of listeners) listener({}, 'sync'); };
  const storage = {
    async get() {
      if (failRead) throw new Error('Storage unavailable');
      return { ...values };
    },
    async set(patch: Record<string, unknown>) {
      writes.push(patch);
      if (holdWrites) await new Promise<void>((resolve) => heldWrites.push(resolve));
      if (failWrite) throw new Error('Write unavailable');
      Object.assign(values, patch);
      notify();
    },
    async remove() {},
  };
  scope.chrome = {
    storage: {
      sync: storage,
      local: storage,
      onChanged: {
        addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => listeners.add(listener),
        removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => listeners.delete(listener),
      },
    },
    runtime: { getURL: (path: string) => path },
  };
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const toggle = (id: string, checked: boolean) => {
    input(id).checked = checked;
    input(id).dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const editAccount = (value: string) => {
    input('account-preference').value = value;
    input('account-preference').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const submitAccount = () => document.getElementById('account-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const dispose = mountPopup(document, dom.window as unknown as Window);
  return {
    document, values, writes, listeners, input, toggle, editAccount, submitAccount, notify,
    failReads: (value: boolean) => { failRead = value; },
    failWrites: (value: boolean) => { failWrite = value; },
    holdWrites: (value: boolean) => { holdWrites = value; },
    releaseWrite: () => { assert.ok(heldWrites.length); heldWrites.shift()!(); },
    cleanup() {
      dispose();
      dom.window.close();
      if (previousChrome === undefined) delete scope.chrome;
      else scope.chrome = previousChrome;
    },
  };
}

test('pausing keeps preferences and disables feature controls until resumed', async () => {
  const popup = setup();
  try {
    await flush();
    assert.equal(popup.input('rosterTools').checked, true);
    popup.toggle('enabled', false);
    assert.equal(popup.input('rosterTools').disabled, true);
    await flush();
    assert.equal(popup.values.enabled, false);
    assert.equal(popup.values.rosterTools, true);
    assert.equal(popup.input('account-preference').disabled, true);
    popup.toggle('enabled', true);
    await flush();
    assert.equal(popup.input('rosterTools').disabled, false);
    assert.equal(popup.input('rosterTools').checked, true);
    assert.deepEqual(popup.writes, [{ schemaVersion: 2, enabled: false }, { schemaVersion: 2, enabled: true }]);
  } finally { popup.cleanup(); }
});

test('failed saves restore the persisted switch and announce the failure', async () => {
  const popup = setup();
  try {
    await flush();
    popup.failWrites(true);
    popup.toggle('rosterTools', false);
    assert.equal(popup.input('rosterTools').checked, false);
    await flush();
    assert.equal(popup.values.rosterTools, true);
    assert.equal(popup.input('rosterTools').checked, true);
    assert.match(popup.document.getElementById('save-status')!.textContent!, /previous setting was restored/);
  } finally { popup.cleanup(); }
});

test('rapid choices are written sequentially and stale notifications cannot undo them', async () => {
  const popup = setup();
  try {
    await flush();
    popup.holdWrites(true);
    popup.toggle('rosterTools', false);
    popup.toggle('rosterTools', true);
    popup.toggle('pageAppearance', false);
    assert.deepEqual(popup.writes, [{ schemaVersion: 2, rosterTools: false }]);
    assert.equal(popup.input('rosterTools').checked, true);
    assert.equal(popup.input('pageAppearance').checked, false);
    popup.notify();
    await flush();
    assert.equal(popup.input('pageAppearance').checked, false);
    popup.releaseWrite();
    await flush();
    assert.deepEqual(popup.writes, [{ schemaVersion: 2, rosterTools: false }, { schemaVersion: 2, rosterTools: true }]);
    popup.releaseWrite();
    await flush();
    popup.releaseWrite();
    await flush();
    assert.equal(popup.values.rosterTools, true);
    assert.equal(popup.values.pageAppearance, false);
    assert.equal(popup.input('rosterTools').checked, true);
    assert.equal(popup.input('pageAppearance').checked, false);
  } finally { popup.cleanup(); }
});

test('external updates preserve account edits and keyboard focus; account saves normalize values', async () => {
  const popup = setup();
  try {
    await flush();
    const account = popup.input('account-preference');
    account.focus();
    popup.editAccount(' Student@School.EDU ');
    popup.values.rosterTools = false;
    popup.notify();
    await flush();
    assert.equal(popup.input('rosterTools').checked, false);
    assert.equal(account.value, ' Student@School.EDU ');
    assert.equal(popup.document.activeElement, account);
    popup.submitAccount();
    await flush();
    assert.equal(popup.values.accountPreference, 'student@school.edu');
    assert.equal(account.value, 'student@school.edu');
    assert.equal(popup.input('save-account').disabled, true);
  } finally { popup.cleanup(); }
});

test('invalid account preferences are rejected and empty preferences restore automatic selection', async () => {
  const popup = setup();
  try {
    await flush();
    popup.editAccount('not an account');
    popup.submitAccount();
    assert.equal(popup.writes.length, 0);
    assert.equal(popup.input('account-preference').getAttribute('aria-invalid'), 'true');
    assert.equal(popup.document.getElementById('account-error')!.hidden, false);
    popup.editAccount('@School.EDU');
    popup.submitAccount();
    await flush();
    assert.equal(popup.values.accountPreference, 'school.edu');
    popup.editAccount('');
    popup.submitAccount();
    await flush();
    assert.equal(popup.values.accountPreference, '');
  } finally { popup.cleanup(); }
});

test('an initial storage failure disables controls and can recover with retry', async () => {
  const popup = setup({ failRead: true });
  try {
    await flush();
    assert.equal(popup.input('enabled').disabled, true);
    assert.equal(popup.input('rosterTools').disabled, true);
    assert.equal(popup.document.getElementById('load-error')!.hidden, false);
    popup.failReads(false);
    popup.document.getElementById('retry')!.click();
    await flush();
    assert.equal(popup.input('enabled').disabled, false);
    assert.equal(popup.document.getElementById('load-error')!.hidden, true);
    assert.equal(popup.listeners.size, 1);
  } finally { popup.cleanup(); }
});

test('an external storage read failure retains the loaded preferences', async () => {
  const popup = setup();
  try {
    await flush();
    popup.failReads(true);
    popup.notify();
    await flush();
    assert.match(popup.document.getElementById('save-status')!.textContent!, /Couldn’t reload settings/);
    assert.equal(popup.input('rosterTools').checked, true);
    popup.failReads(false);
    popup.document.getElementById('retry')!.click();
    await flush();
    assert.equal(popup.input('enabled').disabled, false);
    assert.equal(popup.document.getElementById('load-error')!.hidden, true);
    assert.equal(popup.listeners.size, 1);
    popup.cleanup();
    assert.equal(popup.listeners.size, 0);
  } finally { popup.cleanup(); }
});
