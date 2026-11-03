import { FEATURE_DEFINITIONS, normalizeAccountPreference, type FeatureKey } from '../shared/settings.ts';
import { createSettingsSession } from '../shared/settings-session.ts';
import { mountSettingsModes } from '../shared/settings-modes.ts';

export function mountAdvancedSettings(document: Document, window: Window): () => void {
  function element<T extends HTMLElement>(id: string): T {
    const match = document.getElementById(id);
    if (!match) throw new Error(`Missing settings element: ${id}`);
    return match as T;
  }
  const list = element('settings-list');
  const accountRow = element('account-setting');
  const account = element<HTMLInputElement>('account-preference');
  const accountError = element('account-error');
  const saveAccount = element<HTMLButtonElement>('save-account');
  const status = element('save-status');
  const feedback = element('save-feedback');
  const error = element('load-error');
  const retry = element<HTMLButtonElement>('retry');
  const switches = new Map<FeatureKey, { input: HTMLInputElement; row: HTMLLabelElement }>();
  const events = new document.defaultView!.AbortController();
  let accountDirty = false;
  const session = createSettingsSession(render);
  const renderModes = mountSettingsModes(document, patch => session.save(patch), events.signal);

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
    const detail = document.createElement('span');
    detail.className = 'feature-description';
    detail.id = `${feature.key}-description`;
    detail.textContent = feature.description;
    copy.append(title, detail);
    const control = document.createElement('span');
    control.className = 'switch';
    const input = document.createElement('input');
    input.id = feature.key;
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-labelledby', title.id);
    input.setAttribute('aria-describedby', detail.id);
    const track = document.createElement('span');
    track.className = 'switch-track';
    track.setAttribute('aria-hidden', 'true');
    control.append(input, track);
    row.append(copy, control);
    const item = document.createElement('li');
    item.append(row);
    list.append(item);
    if (feature.key === 'loadingOverlay') list.append(accountRow);
    switches.set(feature.key, { input, row });
    input.addEventListener('change', () => session.save({ [feature.key]: input.checked }), { signal: events.signal });
  }

  function render() {
    const settings = session.settings();
    renderModes(settings);
    const paused = !settings?.enabled;
    list.setAttribute('aria-busy', String(!settings));
    for (const [key, { input, row }] of switches) {
      input.checked = Boolean(settings?.[key]);
      input.disabled = paused;
      row.setAttribute('aria-disabled', String(paused));
    }
    if (settings && !accountDirty) account.value = settings.accountPreference;
    account.disabled = paused;
    saveAccount.disabled = paused || !accountDirty || session.savingAccount;
    saveAccount.textContent = session.savingAccount ? 'Saving…' : 'Save';
    error.hidden = !session.unavailable;
    retry.disabled = session.refreshing;
    status.textContent = session.error || (session.saving ? 'Saving changes…' : '');
    status.dataset.kind = session.error ? 'error' : session.saving ? 'saving' : 'idle';
    feedback.hidden = !status.textContent || session.unavailable;
  }

  account.addEventListener('input', () => {
    accountDirty = true;
    account.removeAttribute('aria-invalid');
    accountError.hidden = true;
    render();
  }, { signal: events.signal });
  element<HTMLFormElement>('account-form').addEventListener('submit', event => {
    event.preventDefault();
    if (saveAccount.disabled) return;
    const raw = account.value.trim();
    const preference = normalizeAccountPreference(raw);
    if (raw && !preference) {
      account.setAttribute('aria-invalid', 'true');
      accountError.textContent = 'Enter an email address or a domain, such as school.edu.';
      accountError.hidden = false;
      account.focus();
      return;
    }
    accountDirty = false;
    account.removeAttribute('aria-invalid');
    accountError.hidden = true;
    session.save({ accountPreference: preference });
  }, { signal: events.signal });
  retry.addEventListener('click', () => session.retry(), { signal: events.signal });
  const dispose = () => { events.abort(); session.dispose(); };
  window.addEventListener('pagehide', dispose, { once: true, signal: events.signal });
  session.start();
  return dispose;
}
