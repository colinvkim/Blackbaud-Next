import assert from 'node:assert/strict';
import test from 'node:test';
import { setupSettingsUi, flush } from './fixtures/settings-ui.ts';

test('mode choices retain the Full setup and account preference', async () => {
  const popup = setupSettingsUi('popup', { values: { rosterTools: false, accountPreference: 'student@example.test' } });
  try {
    await flush();
    assert.equal(popup.input('mode-full').checked, true);
    assert.equal(popup.document.getElementById('customized')!.hidden, false);
    for (const mode of ['off', 'essentials', 'full']) {
      popup.input(`mode-${mode}`).click();
      await flush();
      assert.equal(popup.input(`mode-${mode}`).checked, true);
      assert.equal(popup.values.rosterTools, false);
      assert.equal(popup.values.accountPreference, 'student@example.test');
      assert.equal(popup.document.getElementById('save-status')!.hidden, true, 'Successful changes remain quiet');
    }
    assert.deepEqual(popup.writes, [
      { schemaVersion: 2, enabled: false },
      { schemaVersion: 2, enabled: true, mode: 'essentials' },
      { schemaVersion: 2, enabled: true, mode: 'full' },
    ]);
  } finally { popup.cleanup(); }
});

test('resetting Full restores recommended features without changing the active mode or account', async () => {
  const popup = setupSettingsUi('popup', { values: { enabled: false, mode: 'essentials', rosterTools: false, resourceSearch: false, accountPreference: 'school.test' } });
  try {
    await flush();
    popup.document.getElementById('reset-full')!.click();
    await flush();
    assert.equal(popup.values.rosterTools, true);
    assert.equal(popup.values.resourceSearch, true);
    assert.equal(popup.values.enabled, false);
    assert.equal(popup.values.mode, 'essentials');
    assert.equal(popup.values.accountPreference, 'school.test');
    assert.equal(popup.document.getElementById('customized')!.hidden, true);
    assert.equal(popup.document.getElementById('reset-full')!.hidden, true);
  } finally { popup.cleanup(); }
});

test('a failed mode save restores the selection and a failed initial read can retry', async () => {
  const popup = setupSettingsUi('popup', { failRead: true });
  try {
    await flush();
    assert.equal(popup.input('mode-full').disabled, true);
    assert.equal(popup.document.getElementById('load-error')!.hidden, false);
    popup.failReads(false);
    popup.document.getElementById('retry')!.click();
    await flush();
    assert.equal(popup.input('mode-full').checked, true);
    popup.failWrites(true);
    popup.input('mode-essentials').click();
    assert.equal(popup.input('mode-essentials').checked, true);
    await flush();
    assert.equal(popup.input('mode-full').checked, true);
    assert.match(popup.document.getElementById('save-status')!.textContent!, /previous setting was restored/);
    assert.equal(popup.document.getElementById('save-status')!.hidden, false);
  } finally { popup.cleanup(); }
});

test('accepted mode changes finish in order after the popup closes', async () => {
  const popup = setupSettingsUi('popup');
  try {
    await flush();
    popup.holdWrites(true);
    popup.input('mode-essentials').click();
    popup.input('mode-off').click();
    await flush();
    assert.equal(popup.messages.length, 2);
    popup.close();
    popup.releaseWrite();
    await flush();
    popup.releaseWrite();
    await flush();
    assert.equal(popup.values.mode, 'essentials');
    assert.equal(popup.values.enabled, false);
  } finally { popup.cleanup(); }
});
