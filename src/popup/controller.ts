import {
  FEATURE_DEFINITIONS,
  getSettings,
  normalizeAccountPreference,
  subscribeSettings,
  updateSettings,
  type FeatureKey,
  type Settings,
} from '../shared/settings.ts';

type SettingsPatch = Partial<Omit<Settings, 'schemaVersion'>>;
type PendingWrite = { patch: SettingsPatch };

export function mountPopup(document: Document, window: Window): () => void {
  function element<T extends HTMLElement>(id: string): T {
    const match = document.getElementById(id);
    if (!match) throw new Error(`Missing popup element: ${id}`);
    return match as T;
  }

  const enabledInput = element<HTMLInputElement>('enabled');
  const enabledDescription = element('enabled-description');
  const featureGroups = element('feature-groups');
  const accountForm = element<HTMLFormElement>('account-form');
  const accountInput = element<HTMLInputElement>('account-preference');
  const saveAccountButton = element<HTMLButtonElement>('save-account');
  const accountError = element('account-error');
  const saveStatus = element('save-status');
  const loadError = element('load-error');
  const retryButton = element<HTMLButtonElement>('retry');
  const switches = new Map<FeatureKey, { input: HTMLInputElement; row: HTMLLabelElement }>();

  let storedSettings: Settings | null = null;
  const pendingWrites: PendingWrite[] = [];
  let draining = false;
  let refreshing = false;
  let refreshRequested = false;
  let readVersion = 0;
  let accountDirty = false;
  let lastError = '';
  let lastSaved = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  for (const feature of FEATURE_DEFINITIONS) {
    const row = document.createElement('label');
    row.className = 'feature-row';
    row.htmlFor = feature.key;

    const copy = document.createElement('span');
    copy.className = 'feature-copy';
    const title = document.createElement('span');
    title.className = 'feature-title';
    title.id = `${feature.key}-title`;
    title.textContent = feature.label;
    const description = document.createElement('span');
    description.className = 'feature-description';
    description.id = `${feature.key}-description`;
    description.textContent = feature.description;
    copy.append(title, description);

    const switchElement = document.createElement('span');
    switchElement.className = 'switch';
    const input = document.createElement('input');
    input.id = feature.key;
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-labelledby', title.id);
    input.setAttribute('aria-describedby', description.id);
    const track = document.createElement('span');
    track.className = 'switch-track';
    track.setAttribute('aria-hidden', 'true');
    switchElement.append(input, track);
    row.append(copy, switchElement);
    element(`${feature.group}-options`).append(row);
    switches.set(feature.key, { input, row });
    input.addEventListener('change', () => queueSettings({ [feature.key]: input.checked }));
  }

  function currentSettings(): Settings | null {
    if (!storedSettings) return null;
    return Object.assign({}, storedSettings, ...pendingWrites.map(({ patch }) => patch));
  }

  function render(): void {
    const settings = currentSettings();
    const paused = !settings?.enabled;
    document.body.dataset.enabled = String(!paused);
    enabledInput.checked = Boolean(settings?.enabled);
    enabledInput.disabled = !settings;
    enabledDescription.textContent = !settings
      ? 'Loading your settings…'
      : paused ? 'Paused. Your preferences are kept.' : 'Active on your Blackbaud pages.';
    featureGroups.setAttribute('aria-busy', String(!settings));

    for (const [key, { input, row }] of switches) {
      input.checked = Boolean(settings?.[key]);
      input.disabled = paused;
      row.setAttribute('aria-disabled', String(paused));
    }
    if (settings && !accountDirty) accountInput.value = settings.accountPreference;
    accountInput.disabled = paused;
    const savingAccount = pendingWrites.some(({ patch }) => patch.accountPreference !== undefined);
    saveAccountButton.disabled = paused || !accountDirty || savingAccount;
    saveAccountButton.textContent = savingAccount ? 'Saving…' : 'Save';

    const saving = pendingWrites.length > 0;
    saveStatus.textContent = saving ? 'Saving changes…'
      : lastError || (!settings ? 'Loading your settings…'
        : lastSaved ? 'Changes saved.' : 'Changes apply to open Blackbaud pages.');
    saveStatus.dataset.kind = saving ? 'saving' : lastError ? 'error' : lastSaved ? 'saved' : 'idle';
  }

  function queueSettings(patch: SettingsPatch): void {
    if (!storedSettings || disposed) return;
    // Apply pending choices in order while keeping the last persisted snapshot for rollback.
    readVersion += 1;
    pendingWrites.push({ patch });
    lastError = '';
    lastSaved = false;
    render();
    void drainWrites();
  }

  async function drainWrites(): Promise<void> {
    if (draining) return;
    draining = true;
    while (pendingWrites.length && !disposed) {
      const write = pendingWrites[0];
      try {
        await updateSettings(write.patch);
        if (storedSettings) storedSettings = { ...storedSettings, ...write.patch };
        lastSaved = true;
      } catch {
        lastError = 'Couldn’t save this change. Your previous setting was restored.';
        lastSaved = false;
      }
      pendingWrites.shift();
      render();
    }
    draining = false;
    // A storage notification can arrive before its write promise resolves. Read only
    // after the queue drains so it cannot replace a more recent local choice.
    void refreshSettings();
  }

  async function refreshSettings(): Promise<void> {
    if (disposed) return;
    if (draining || refreshing) {
      refreshRequested = true;
      return;
    }
    refreshing = true;
    refreshRequested = false;
    const version = ++readVersion;
    retryButton.disabled = true;
    try {
      const settings = await getSettings();
      if (disposed || version !== readVersion || pendingWrites.length) return;
      storedSettings = settings;
      loadError.hidden = true;
      if (!unsubscribe) unsubscribe = subscribeSettings(() => { void refreshSettings(); });
    } catch {
      if (disposed || version !== readVersion) return;
      if (storedSettings) lastError = 'Couldn’t reload settings. Try reopening the extension.';
      else {
        loadError.hidden = false;
        lastError = 'Settings are unavailable. Try again to reconnect.';
      }
    } finally {
      refreshing = false;
      retryButton.disabled = false;
      render();
      if (refreshRequested && !draining) void refreshSettings();
    }
  }

  enabledInput.addEventListener('change', () => queueSettings({ enabled: enabledInput.checked }));

  accountInput.addEventListener('input', () => {
    accountDirty = true;
    accountInput.removeAttribute('aria-invalid');
    accountError.hidden = true;
    render();
  });

  accountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saveAccountButton.disabled) return;
    const rawPreference = accountInput.value.trim();
    const preference = normalizeAccountPreference(rawPreference);
    if (rawPreference && !preference) {
      accountInput.setAttribute('aria-invalid', 'true');
      accountError.textContent = 'Enter an email address or a domain, such as school.edu.';
      accountError.hidden = false;
      accountInput.focus();
      return;
    }
    accountDirty = false;
    accountInput.removeAttribute('aria-invalid');
    accountError.hidden = true;
    queueSettings({ accountPreference: preference });
  });

  retryButton.addEventListener('click', () => {
    lastError = '';
    render();
    void refreshSettings();
  });

  function dispose(): void {
    disposed = true;
    unsubscribe?.();
    window.removeEventListener('pagehide', dispose);
  }
  window.addEventListener('pagehide', dispose, { once: true });

  render();
  void refreshSettings();
  return dispose;
}
