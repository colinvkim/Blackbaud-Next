import { getSettings, subscribeSettings, updateSettings, type Settings } from './settings.ts';

export type SettingsUpdate = Partial<Omit<Settings, 'schemaVersion'>>;
type PendingWrite = { patch: SettingsUpdate; saved?: boolean };

/** One ordered, optimistic settings session for each extension UI document. */
export function createSettingsSession(render: () => void) {
  let stored: Settings | null = null;
  const pending: PendingWrite[] = [];
  let refreshing = false;
  let refreshRequested = false;
  let revision = 0;
  let error = '';
  let unavailable = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const settings = () => stored && Object.assign({}, stored, ...pending.map(({ patch }) => patch));
  const refresh = async () => {
    if (disposed) return;
    if (pending.length || refreshing) { refreshRequested = true; return; }
    refreshing = true;
    refreshRequested = false;
    const version = ++revision;
    render();
    try {
      const next = await getSettings();
      if (disposed || version !== revision || pending.length) return;
      stored = next;
      unavailable = false;
    } catch {
      if (disposed || version !== revision) return;
      unavailable = !stored;
      error = stored ? 'Couldn’t reload settings. Try reopening the extension.' : 'Settings are unavailable. Try again to reconnect.';
    } finally {
      refreshing = false;
      if (!disposed) render();
      if (refreshRequested && !pending.length) void refresh();
    }
  };
  const finish = (completed: PendingWrite, success: boolean) => {
    if (disposed) return;
    completed.saved = success;
    while (pending.length && pending[0]!.saved !== undefined) {
      const write = pending.shift()!;
      if (write.saved) {
        if (stored) stored = { ...stored, ...write.patch };
      } else {
        error = 'Couldn’t save this change. Your previous setting was restored.';
      }
    }
    render();
    if (!pending.length) void refresh();
  };
  return {
    settings,
    get saving() { return pending.length > 0; },
    get savingAccount() { return pending.some(({ patch }) => patch.accountPreference !== undefined); },
    get error() { return error; },
    get unavailable() { return unavailable; },
    get refreshing() { return refreshing; },
    start() {
      unsubscribe = subscribeSettings(() => { revision++; void refresh(); });
      render();
      void refresh();
    },
    retry() { error = ''; render(); void refresh(); },
    save(patch: SettingsUpdate) {
      if (!stored || disposed) return;
      revision++;
      const write: PendingWrite = { patch };
      pending.push(write);
      error = '';
      render();
      // Dispatch now: the worker retains accepted writes after this document closes.
      void updateSettings(patch).then(() => finish(write, true), () => finish(write, false));
    },
    dispose() { disposed = true; unsubscribe?.(); },
  };
}
