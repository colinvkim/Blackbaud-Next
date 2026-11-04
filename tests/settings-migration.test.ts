import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoordinator } from '../src/background/coordinator.ts';
import { getSettings, updateSettings } from '../src/shared/settings.ts';
import type { ExtensionApi, StorageArea } from '../src/shared/extension.ts';

// Preference keys shipped in v2026.4.2 / 1.3.1, with customized values.
const aprilPreferences = {
  automaticLogin: false, loadBetweenPages: false, fixFavicon: false,
  oldAssignmentCenter: true, loginFix: false, wideUI: true,
  copyRosterTools: false, downloadFullAvatar: false, fixBrokenAssignmentCenter: false,
};

function fixture(initial: Record<string, unknown>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const values = { ...initial };
  const writes: Record<string, unknown>[] = [];
  const storage: StorageArea = {
    async get() { return { ...values }; },
    async set(patch) { writes.push({ ...patch }); Object.assign(values, patch); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
  const api = {
    storage: { sync: storage },
    runtime: { id: 'migration-fixture', getURL: (path: string) => `chrome-extension://migration-fixture/${path}` },
  } as unknown as ExtensionApi;
  let handle = createCoordinator(api);
  api.runtime.sendMessage = async message => {
    try { return { ok: true, value: await handle(message, { id: api.runtime.id, url: api.runtime.getURL('popup.html') }) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Failed' }; }
  };
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: api });
  return { values, writes, storage,
    restart() { handle = createCoordinator(api); },
    cleanup() { if (previous) Object.defineProperty(globalThis, 'chrome', previous); else Reflect.deleteProperty(globalThis, 'chrome'); },
  };
}

for (const [name, initial] of [
  ['April release', aprilPreferences],
  ['Off', { enabled: false, mode: 'full', rosterTools: false }],
  ['Essentials', { enabled: true, mode: 'essentials', assignmentPreviews: false }],
] as const) {
  test(`${name} receives Full defaults once and later choices survive worker restart`, async () => {
    const state = fixture({ ...initial, accountPreference: 'student@school.test', assignmentCenterView: 'calendar' });
    try {
      const settings = await getSettings();
      assert.equal(settings.enabled, true);
      assert.equal(settings.mode, 'full');
      for (const key of ['automaticLogin', 'optimizeLoginPage', 'rosterTools', 'assignmentPreviews', 'downloadFullAvatar'] as const) assert.equal(settings[key], true);
      assert.equal(settings.accountPreference, 'student@school.test');
      assert.equal(state.values.assignmentCenterView, 'calendar');
      assert.equal(state.values.fullDefaultsVersion, 1);
      await updateSettings({ enabled: false, mode: 'essentials', rosterTools: false });
      state.restart();
      const later = await getSettings();
      assert.equal(later.enabled, false);
      assert.equal(later.mode, 'essentials');
      assert.equal(later.rosterTools, false);
      assert.equal(state.writes.filter(patch => patch.fullDefaultsVersion === 1).length, 1);
    } finally { state.cleanup(); }
  });
}

test('a user setting write before the first read takes effect after the one-time setup', async () => {
  const state = fixture(aprilPreferences);
  try {
    await updateSettings({ enabled: false, mode: 'essentials', rosterTools: false });
    const settings = await getSettings();
    assert.equal(settings.enabled, false);
    assert.equal(settings.mode, 'essentials');
    assert.equal(settings.rosterTools, false);
    assert.equal(state.values.fullDefaultsVersion, 1);
  } finally { state.cleanup(); }
});

test('concurrent first reads and a user change are serialized without a second reset', async () => {
  const state = fixture(aprilPreferences);
  let release: () => void = () => {};
  let started: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; });
  const set = state.storage.set;
  state.storage.set = async patch => {
    if (patch.fullDefaultsVersion === 1) { started(); await pending; }
    await set(patch);
  };
  try {
    const first = getSettings();
    const second = getSettings();
    await writing;
    const choice = updateSettings({ enabled: false, assignmentPreviews: false });
    release();
    await Promise.all([first, second, choice]);
    const current = await getSettings();
    assert.equal(current.enabled, false);
    assert.equal(current.assignmentPreviews, false);
    assert.equal(state.writes.filter(patch => patch.fullDefaultsVersion === 1).length, 1);
  } finally { release(); state.cleanup(); }
});

test('failed migration writes retry without marking completion or losing account/view choices', async () => {
  const state = fixture({ enabled: false, accountPreference: 'school.test', assignmentCenterView: 'list' });
  const set = state.storage.set;
  state.storage.set = async () => { throw new Error('Storage unavailable'); };
  try {
    await assert.rejects(getSettings(), /unavailable/);
    assert.equal(state.values.fullDefaultsVersion, undefined);
    state.storage.set = set;
    const settings = await getSettings();
    assert.equal(settings.enabled, true);
    assert.equal(settings.accountPreference, 'school.test');
    assert.equal(state.values.assignmentCenterView, 'list');
  } finally { state.cleanup(); }
});

test('a newer migration marker preserves choices when running an older extension build', async () => {
  const state = fixture({ fullDefaultsVersion: 2, enabled: false, mode: 'essentials', rosterTools: false });
  try {
    const settings = await getSettings();
    assert.equal(settings.enabled, false);
    assert.equal(settings.mode, 'essentials');
    assert.equal(settings.rosterTools, false);
    assert.deepEqual(state.writes, []);
  } finally { state.cleanup(); }
});
