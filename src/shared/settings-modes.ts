import { fullDefaults, isFullCustomized, type Settings } from './settings.ts';
import type { SettingsUpdate } from './settings-session.ts';

export function mountSettingsModes(document: Document, save: (patch: SettingsUpdate) => void, signal: AbortSignal): (settings: Settings | null) => void {
  const modes = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')];
  const customized = document.getElementById('customized')!;
  const reset = document.getElementById('reset-full') as HTMLButtonElement;
  const caption = document.getElementById('mode-caption');
  for (const input of modes) input.addEventListener('change', () => {
    if (input.checked) save(input.value === 'off' ? { enabled: false } : { enabled: true, mode: input.value === 'essentials' ? 'essentials' : 'full' });
  }, { signal });
  reset.addEventListener('click', () => {
    const focused = document.activeElement === reset;
    save(fullDefaults());
    if (focused) modes.find(input => input.checked)?.focus();
  }, { signal });
  return (settings) => {
    const mode = !settings?.enabled ? 'off' : settings.mode;
    for (const input of modes) { input.disabled = !settings; input.checked = !!settings && input.value === mode; }
    const custom = !!settings && isFullCustomized(settings);
    customized.hidden = !custom;
    reset.hidden = !custom;
    reset.disabled = !settings;
    if (caption) caption.textContent = !settings ? 'Loading your settings…' : mode === 'off' ? 'No changes to Blackbaud.' : mode === 'essentials' ? 'Automatic sign-in and assignment previews.' : custom ? 'Your customized Full setup.' : 'All recommended enhancements.';
  };
}
