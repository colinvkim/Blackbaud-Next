import assert from 'node:assert/strict';
import test from 'node:test';
import { setupSettingsUi, flush } from './fixtures/settings-ui.ts';

const setup = (options?: Parameters<typeof setupSettingsUi>[1]) => setupSettingsUi('options', options);

test('pausing keeps preferences and disables feature controls until resumed', async () => {
  const popup = setup();
  try {
    await flush();
    assert.equal(popup.input('rosterTools').checked, true);
    popup.input('mode-off').click();
    assert.equal(popup.input('rosterTools').disabled, true);
    await flush();
    assert.equal(popup.values.enabled, false);
    assert.equal(popup.values.rosterTools, true);
    assert.equal(popup.input('account-preference').disabled, true);
    popup.input('mode-full').click();
    await flush();
    assert.equal(popup.input('rosterTools').disabled, false);
    assert.equal(popup.input('rosterTools').checked, true);
    assert.deepEqual(popup.writes, [{ schemaVersion: 2, enabled: false }, { schemaVersion: 2, enabled: true, mode: 'full' }]);
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
    assert.equal(popup.document.getElementById('save-feedback')!.hidden, false);
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
    assert.equal(popup.messages.length, 3, 'every accepted change is handed to the worker immediately');
    await flush();
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
    assert.equal(popup.document.getElementById('save-feedback')!.hidden, true, 'Completed writes leave no permanent status bar');
  } finally { popup.cleanup(); }
});

test('closing Advanced settings cannot discard settings accepted behind a pending save', async () => {
  const popup = setup();
  try {
    await flush();
    popup.holdWrites(true);
    popup.toggle('rosterTools', false);
    popup.toggle('resourceSearch', false);
    assert.equal(popup.messages.length, 2);
    await flush();
    popup.close();
    popup.releaseWrite();
    await flush();
    popup.releaseWrite();
    await flush();
    assert.equal(popup.values.rosterTools, false);
    assert.equal(popup.values.resourceSearch, false);
  } finally { popup.cleanup(); }
});

test('a settings change during the initial read is refreshed rather than missed', async () => {
  const popup = setup({ holdInitialRead: true });
  try {
    assert.equal(popup.listeners.size, 1);
    popup.values.enabled = false;
    popup.values.resourceSearch = false;
    popup.notify();
    popup.releaseRead();
    await flush();
    assert.equal(popup.input('mode-off').checked, true);
    assert.equal(popup.input('resourceSearch').checked, false);
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
    assert.equal(popup.input('mode-full').disabled, true);
    assert.equal(popup.input('rosterTools').disabled, true);
    assert.equal(popup.document.getElementById('load-error')!.hidden, false);
    popup.failReads(false);
    popup.document.getElementById('retry')!.click();
    await flush();
    assert.equal(popup.input('mode-full').disabled, false);
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
    assert.equal(popup.input('mode-full').disabled, false);
    assert.equal(popup.document.getElementById('load-error')!.hidden, true);
    assert.equal(popup.listeners.size, 1);
    popup.cleanup();
    assert.equal(popup.listeners.size, 0);
  } finally { popup.cleanup(); }
});
