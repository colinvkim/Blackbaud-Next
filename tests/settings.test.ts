import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, getSettings, normalizeAccountPreference, normalizeSettings, updateSettings } from '../src/shared/settings.ts';
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

test('old modes migrate while preserving individual switches and aliases', () => {
  assert.equal(normalizeSettings({ uiMode: 'original' }).enabled, false);
  for (const uiMode of ['enhanced', 'next']) {
    const settings = normalizeSettings({ uiMode, copyRosterTools: false, loginFix: false, fixBrokenAssignmentCenter: false });
    assert.equal(settings.enabled, true);
    assert.equal(settings.rosterTools, false);
    assert.equal(settings.optimizeLoginPage, false);
    assert.equal(settings.fixInvalidPages, false);
  }
  assert.equal(normalizeSettings({ rosterTools: true, copyRosterTools: false }).rosterTools, true);
});

test('invalid storage data uses typed defaults and respects the new enabled flag', () => {
  assert.deepEqual(normalizeSettings({ automaticLogin: 'false', accountPreference: {}, enabled: true, uiMode: 'original' }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ enabled: false, uiMode: 'next' }).enabled, false);
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
  scope.chrome = coordinate({ storage: { sync: { set: async (value: Record<string, unknown>) => { saved = value; } } } } as unknown as ExtensionApi);
  try {
    await updateSettings({ rosterTools: false });
    assert.deepEqual(saved, { schemaVersion: 2, rosterTools: false });
    await assert.rejects(() => updateSettings({ accountPreference: 'invalid' }), /valid email/);
  } finally { scope.chrome = previous; }
});

test('legacy reads cannot overwrite a newer preference saved by another tab', async () => {
  const scope = globalThis as typeof globalThis & { chrome?: unknown };
  const previous = scope.chrome;
  let raw: Record<string, unknown> = { uiMode: 'enhanced', copyRosterTools: false };
  const pendingReads: (() => void)[] = [];
  const writes: Record<string, unknown>[] = [];
  scope.chrome = coordinate({
    storage: {
      sync: {
        get: async () => {
          const snapshot = { ...raw };
          await new Promise<void>((resolve) => pendingReads.push(resolve));
          return snapshot;
        },
        set: async (patch: Record<string, unknown>) => {
          writes.push(patch);
          raw = { ...raw, ...patch };
        },
      },
    },
  } as unknown as ExtensionApi);
  try {
    const first = getSettings();
    const second = getSettings();
    await updateSettings({ enabled: false });
    for (const resolve of pendingReads) resolve();
    const normalized = await Promise.all([first, second]);
    assert.equal(normalized[0].rosterTools, false);
    assert.equal(normalized[1].schemaVersion, 2);
    assert.equal(raw.enabled, false);
    assert.deepEqual(writes, [{ schemaVersion: 2, enabled: false }]);
  } finally { scope.chrome = previous; }
});
