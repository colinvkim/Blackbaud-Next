import { mountSettingsModes } from '../shared/settings-modes.ts';
import { createSettingsSession } from '../shared/settings-session.ts';

export function mountPopup(document: Document, window: Window): () => void {
  const status = document.getElementById('save-status')!;
  const error = document.getElementById('load-error')!;
  const retry = document.getElementById('retry') as HTMLButtonElement;
  const events = new document.defaultView!.AbortController();
  const session = createSettingsSession(() => {
    renderModes(session.settings());
    error.hidden = !session.unavailable;
    retry.disabled = session.refreshing;
    status.textContent = session.error;
    status.hidden = !session.error || session.unavailable;
    status.dataset.kind = session.error ? 'error' : 'idle';
  });
  const renderModes = mountSettingsModes(document, patch => session.save(patch), events.signal);
  retry.addEventListener('click', () => session.retry(), { signal: events.signal });
  const dispose = () => { events.abort(); session.dispose(); };
  window.addEventListener('pagehide', dispose, { once: true, signal: events.signal });
  session.start();
  return dispose;
}
