import { isSchoolHostname, schoolFromSigninUrl } from '../blackbaud/auth.ts';
import { isBlackbaudSignin, isGoogleOAuth, isSchoolPage, isStudentPortal } from '../blackbaud/routes.ts';
import type { AuthRequest } from '../shared/coordinator.ts';
import type { ExtensionApi, MessageListener, MessageSender } from '../shared/extension.ts';
import { settingsPatch } from '../shared/settings.ts';
import type { Settings } from '../shared/settings.ts';
import { AuthStore } from './auth-store.ts';

function authRequest(raw: unknown): AuthRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('action' in raw)) throw new Error('Invalid auth request.');
  if (raw.action === 'list') return { action: 'list' };
  if (!('id' in raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 128) throw new Error('Invalid auth flow.');
  if (raw.action === 'create' && 'hostname' in raw && typeof raw.hostname === 'string' && isSchoolHostname(raw.hostname)) {
    return { action: 'create', id: raw.id, hostname: raw.hostname };
  }
  if (raw.action === 'remove' && 'hostname' in raw && typeof raw.hostname === 'string' && isSchoolHostname(raw.hostname)) {
    return { action: 'remove', id: raw.id, hostname: raw.hostname.toLowerCase() };
  }
  if (raw.action === 'pause' || raw.action === 'recover') return { action: raw.action, id: raw.id };
  if ((raw.action === 'claim' || raw.action === 'confirm' || raw.action === 'release') && 'step' in raw &&
    (raw.step === 'blackbaud' || raw.step === 'google') && 'token' in raw && typeof raw.token === 'string' && raw.token.trim() && raw.token.length <= 128) {
    return { action: raw.action, id: raw.id, step: raw.step, token: raw.token };
  }
  throw new Error('Invalid auth operation.');
}

export function createCoordinator(api: ExtensionApi): (message: unknown, sender: MessageSender) => Promise<unknown> {
  const auth = new AuthStore(api.storage.session);
  let settingsWrites = Promise.resolve();
  return async (raw, sender) => {
    if (sender.id !== api.runtime.id || !sender.url) throw new Error('Unrecognized extension sender.');
    if (!raw || typeof raw !== 'object' || !('channel' in raw) || raw.channel !== 'blackbaud-next-coordinator-v1' || !('kind' in raw)) throw new Error('Invalid coordinator message.');
    const url = new URL(sender.url);
    if (raw.kind === 'settings') {
      if (url.href !== api.runtime.getURL('popup.html') || !('update' in raw) || !raw.update || typeof raw.update !== 'object' || Array.isArray(raw.update)) throw new Error('Invalid settings sender or update.');
      if ('accountPreference' in raw.update && typeof raw.update.accountPreference !== 'string') throw new Error('Invalid account preference.');
      const patch = settingsPatch(raw.update as Partial<Omit<Settings, 'schemaVersion'>>);
      const saved = settingsWrites.then(() => api.storage.sync.set(patch));
      settingsWrites = saved.catch(() => {});
      await saved;
      return undefined;
    }
    if (raw.kind !== 'auth' || !('request' in raw) || !(isSchoolPage(url) || isBlackbaudSignin(url) || isGoogleOAuth(url))) throw new Error('Invalid auth sender.');
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0 || sender.frameId !== 0) throw new Error('Invalid auth tab.');
    const request = authRequest(raw.request);
    if (request.action === 'create') {
      const school = isSchoolPage(url) ? url.hostname : isBlackbaudSignin(url) ? schoolFromSigninUrl(url) : null;
      if (school !== request.hostname.toLowerCase()) throw new Error('The auth school does not match this page.');
    }
    if ('step' in request && ((request.step === 'blackbaud' && !isBlackbaudSignin(url)) || (request.step === 'google' && !isGoogleOAuth(url)))) throw new Error('The auth provider does not match this page.');
    if (request.action === 'remove' && (!isStudentPortal(url) || url.hostname !== request.hostname)) throw new Error('Invalid auth completion page.');
    return auth.request(request, tabId);
  };
}

export function installCoordinator(api: ExtensionApi): () => void {
  const handle = createCoordinator(api);
  const listener: MessageListener = (message, sender, respond) => {
    if (!message || typeof message !== 'object' || !('channel' in message) || message.channel !== 'blackbaud-next-coordinator-v1') return;
    const reply = (value: unknown) => {
      try { respond(value); } catch { /* Accepted work still completes after its sender closes. */ }
    };
    void handle(message, sender).then(
      (value) => reply({ ok: true, value }),
      (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : 'The extension operation failed.' }),
    );
    // Use callback responses for Chrome 120; Promise-returning listeners require
    // a newer Chrome. The worker owns accepted work even if its sender closes.
    return true;
  };
  api.runtime.onMessage.addListener(listener);
  return () => api.runtime.onMessage.removeListener(listener);
}
