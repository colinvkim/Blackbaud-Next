import { AUTH_CONTEXT_PREFIX, canAttempt, createAuthContext, parseAuthContext } from '../blackbaud/auth.ts';
import type { AuthContext } from '../blackbaud/auth.ts';
import type { AuthRequest } from '../shared/coordinator.ts';
import type { StorageArea } from '../shared/extension.ts';

export class AuthStore {
  private pending: Promise<void> = Promise.resolve();
  private readonly storage: StorageArea;

  constructor(storage: StorageArea) { this.storage = storage; }

  request(request: AuthRequest, tabId: number): Promise<AuthContext[] | AuthContext | null> {
    // One worker owns every flow mutation. A rejected operation must not leave
    // later reads, pauses or claims stuck behind a rejected queue.
    const result = this.pending.then(() => this.perform(request, tabId));
    this.pending = result.then(() => {}, () => {});
    return result;
  }

  private async perform(request: AuthRequest, tabId: number): Promise<AuthContext[] | AuthContext | null> {
    const key = `${AUTH_CONTEXT_PREFIX}${tabId}`;
    const values = await this.storage.get(key);
    const context = parseAuthContext(values[key]);
    if (request.action === 'list') {
      if (!context && key in values) await this.storage.remove(key);
      return context ? [context] : [];
    }
    if (request.action === 'create') {
      if (context?.id === request.id) {
        if (context.hostname !== request.hostname.toLowerCase()) throw new Error('The auth flow belongs to another school.');
        return context;
      }
      const created = createAuthContext(request.hostname, request.id);
      await this.storage.set({ [key]: created });
      return created;
    }
    if (!context || context.id !== request.id) return null;
    if (request.action === 'remove') {
      if (context.hostname === request.hostname) await this.storage.remove(key);
      return null;
    }
    if (request.action === 'pause') {
      const paused = { ...context, paused: true };
      await this.storage.set({ [key]: paused });
      return paused;
    }
    if (request.action === 'recover') {
      if (!canAttempt(context, 'recovery')) return null;
      const recovered = { ...context, recoveryAttempts: 1, blackbaudAttempts: 0, googleAttempts: 0 };
      delete recovered.blackbaudClaim;
      delete recovered.googleClaim;
      await this.storage.set({ [key]: recovered });
      return recovered;
    }
    if (!('step' in request)) return context;
    const claimKey = `${request.step}Claim` as const;
    const attemptKey = `${request.step}Attempts` as const;
    if (request.action === 'claim') {
      if (!canAttempt(context, request.step)) return null;
      const claimed = { ...context, [claimKey]: request.token, [attemptKey]: 1 };
      await this.storage.set({ [key]: claimed });
      return claimed;
    }
    const ownsClaim = context[claimKey] === request.token && context[attemptKey] === 1;
    if (request.action === 'confirm') return ownsClaim && !context.paused ? context : null;
    if (!ownsClaim) return context;
    const released = { ...context, [attemptKey]: 0 };
    delete released[claimKey];
    await this.storage.set({ [key]: released });
    return released;
  }
}
