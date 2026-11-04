import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, effectiveSettings, isFullCustomized, normalizeAccountPreference, normalizeSettings, updateSettings } from '../src/shared/settings.ts';
import { createCoordinator } from '../src/background/coordinator.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';

function coordinate(api: ExtensionApi): ExtensionApi {
  api.runtime = { id: 'settings-fixture', getURL: (path) => `chrome-extension://settings-fixture/${path}` } as ExtensionApi['runtime'];
  const handle = createCoordinator(api);
  api.runtime.sendMessage = async (message) => {
    try { return { ok: true, value: await handle(message, { id: api.runtime.id, url: api.runtime.getURL('popup.html') }) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Failed' }; }
  };
  return api;
}

test('normalization uses canonical settings and ignores retired control names', () => {
  const settings = normalizeSettings({ uiMode: 'original', copyRosterTools: false, loginFix: false, fixBrokenAssignmentCenter: false, oldAssignmentCenter: true, classicAssignmentCenter: false });
  assert.equal(settings.enabled, true);
  assert.equal(settings.rosterTools, true);
  assert.equal(settings.optimizeLoginPage, true);
  assert.equal(settings.fixInvalidPages, true);
  assert.equal(isFullCustomized(settings), false);
  assert.equal(normalizeSettings({ rosterTools: false }).rosterTools, false);
});

test('invalid storage data uses typed defaults and respects the new enabled flag', () => {
  assert.deepEqual(normalizeSettings({ automaticLogin: 'false', accountPreference: {}, enabled: true, uiMode: 'original' }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ enabled: false, uiMode: 'next' }).enabled, false);
});

for (const [parent, child] of [['assignmentCompletion', 'assignmentStatusLabels'], ['classSwitching', 'classSearch']] as const) {
  test(`${child} remains independent of ${parent} after migration`, async () => {
    const scope = globalThis as typeof globalThis & { chrome?: unknown };
    const previous = scope.chrome;
    let raw: Record<string, unknown> = { fullDefaultsVersion: 1, [parent]: false, [child]: false };
    scope.chrome = coordinate({ storage: { sync: {
      get: async () => ({ ...raw }),
      set: async (patch: Record<string, unknown>) => { Object.assign(raw, patch); },
    } } } as unknown as ExtensionApi);
    try {
      assert.equal(normalizeSettings(raw)[child], false);
      await updateSettings({ [parent]: true });
      assert.equal(normalizeSettings(raw)[parent], true);
      assert.equal(normalizeSettings(raw)[child], false, 'Changing one switch preserves its companion’s state');
      raw = { fullDefaultsVersion: 1 };
      await updateSettings({ [parent]: false });
      assert.equal(normalizeSettings(raw)[child], true, 'Disabling one half preserves the other default');
      await updateSettings({ [child]: false });
      assert.equal(normalizeSettings(raw)[parent], false);
      assert.equal(normalizeSettings(raw)[child], false);
      raw = { fullDefaultsVersion: 1, [parent]: false, [child]: false };
      await Promise.all([updateSettings({ [parent]: true }), updateSettings({ [child]: true }), updateSettings({ [parent]: false })]);
      assert.equal(normalizeSettings(raw)[parent], false);
      assert.equal(normalizeSettings(raw)[child], true, 'Queued writes preserve independent choices');
    } finally { scope.chrome = previous; }
  });
}

test('legacy settings retain Full by default and the lighter mode does not mutate the saved setup', () => {
  const full = normalizeSettings({ rosterTools: false, assignmentPreviews: false, automaticLogin: false });
  assert.equal(full.mode, 'full');
  const saved = { ...full, mode: 'essentials' as const };
  const effective = effectiveSettings(saved);
  assert.equal(effective.assignmentPreviews, true);
  assert.equal(effective.automaticLogin, true);
  assert.equal(effective.pageAppearance, false);
  assert.equal(effective.rosterTools, false);
  assert.equal(saved.assignmentPreviews, false);
  assert.equal(saved.automaticLogin, false);
  assert.equal(effectiveSettings({ ...saved, mode: 'full' }).assignmentPreviews, false);
  assert.equal(normalizeSettings({ mode: 'unrecognized' }).mode, 'full');
});

test('account preferences accept complete email addresses or domains', () => {
  assert.equal(normalizeAccountPreference(' @STUDENTS.EXAMPLE.ORG '), 'students.example.org');
  assert.equal(normalizeAccountPreference('Student@Example.org'), 'student@example.org');
  for (const value of ['example', 'https://example.org', 'user@', 'a b@example.org']) assert.equal(normalizeAccountPreference(value), '');
});

test('saving one switch writes a patch and rejects invalid account preferences', async () => {
  let saved: Record<string, unknown> | null = null;
  const scope = globalThis as typeof globalThis & { chrome?: unknown };
  const previous = scope.chrome;
  scope.chrome = coordinate({ storage: { sync: { get: async () => ({ fullDefaultsVersion: 1 }), set: async (value: Record<string, unknown>) => { saved = value; } } } } as unknown as ExtensionApi);
  try {
    await updateSettings({ rosterTools: false });
    assert.deepEqual(saved, { schemaVersion: 2, rosterTools: false });
    await assert.rejects(() => updateSettings({ accountPreference: 'invalid' }), /valid email/);
  } finally { scope.chrome = previous; }
});
