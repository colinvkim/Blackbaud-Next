import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mountPopup } from '../../src/popup/controller.ts';
import { mountAdvancedSettings } from '../../src/options/controller.ts';
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts';
import { createCoordinator } from '../../src/background/coordinator.ts';
import type { ExtensionApi } from '../../src/shared/extension.ts';

const pages = {
  popup: await readFile(new URL('../../src/popup/index.html', import.meta.url), 'utf8'),
  options: await readFile(new URL('../../src/options/index.html', import.meta.url), 'utf8'),
};
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

export function setupSettingsUi(kind: 'popup' | 'options', options: { failRead?: boolean; holdInitialRead?: boolean; values?: Record<string, unknown> } = {}) {
  const dom = new JSDOM(pages[kind], { url: `chrome-extension://popup-fixture/${kind}.html` });
  const document = dom.window.document;
  const values: Record<string, unknown> = { fullDefaultsVersion: 1, ...DEFAULT_SETTINGS, ...options.values };
  const writes: Record<string, unknown>[] = [];
  const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
  const heldWrites: (() => void)[] = [];
  const heldReads: (() => void)[] = [];
  const messages: unknown[] = [];
  let holdNextRead = options.holdInitialRead ?? false;
  const scope = globalThis as typeof globalThis & { chrome?: unknown };
  const previousChrome = scope.chrome;
  let failRead = options.failRead ?? false;
  let failWrite = false;
  let holdWrites = false;
  const notify = () => { for (const listener of listeners) listener({}, 'sync'); };
  const storage = {
    async get() {
      if (failRead) throw new Error('Storage unavailable');
      const snapshot = { ...values };
      if (holdNextRead) {
        holdNextRead = false;
        await new Promise<void>((resolve) => heldReads.push(resolve));
      }
      return snapshot;
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
  const api = {
    storage: {
      sync: storage,
      local: storage,
      onChanged: {
        addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => listeners.add(listener),
        removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => listeners.delete(listener),
      },
    },
    runtime: { id: 'popup-fixture', getURL: (path: string) => `chrome-extension://popup-fixture/${path}` },
  } as unknown as ExtensionApi;
  const handle = createCoordinator(api);
  api.runtime.sendMessage = async (message) => {
    messages.push(message);
    try { return { ok: true, value: await handle(message, { id: api.runtime.id, url: api.runtime.getURL(`${kind}.html`) }) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Failed' }; }
  };
  scope.chrome = api;
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
  const dispose = (kind === 'popup' ? mountPopup : mountAdvancedSettings)(document, dom.window as unknown as Window);
  return {
    document, values, writes, messages, listeners, input, toggle, editAccount, submitAccount, notify,
    failReads: (value: boolean) => { failRead = value; },
    failWrites: (value: boolean) => { failWrite = value; },
    holdWrites: (value: boolean) => { holdWrites = value; },
    releaseWrite: () => { assert.ok(heldWrites.length); heldWrites.shift()!(); },
    releaseRead: () => { assert.ok(heldReads.length); heldReads.shift()!(); },
    close() { dispose(); dom.window.close(); },
    cleanup() {
      dispose();
      dom.window.close();
      if (previousChrome === undefined) delete scope.chrome;
      else scope.chrome = previousChrome;
    },
  };
}
