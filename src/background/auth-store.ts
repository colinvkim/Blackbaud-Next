import { AUTH_CONTEXT_PREFIX, canAttempt, createAuthContext, parseAuthContext } from '../blackbaud/auth.ts';
import type { AuthContext } from '../blackbaud/auth.ts';
import type { AuthRequest } from '../shared/coordinator.ts';
import type { StorageArea } from '../shared/extension.ts';

export class AuthStore {
  private pending: Promise<void> = Promise.resolve();
  private readonly storage: StorageArea;

  constructor(storage: StorageArea) { this.storage = storage; }

  request(request: AuthRequest): Promise<AuthContext[] | AuthContext | null> {
    // One worker owns every flow mutation. A rejected operation must not leave
    // later reads, pauses or claims stuck behind a rejected queue.
    const result = this.pending.then(() => this.perform(request));
    this.pending = result.then(() => {}, () => {});
    return result;
  }

  private async perform(request: AuthRequest): Promise<AuthContext[] | AuthContext | null> {
    if (request.action === 'list') {
      const values = await this.storage.get(null);
      const contexts: AuthContext[] = [];
      const expired: string[] = [];
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith(AUTH_CONTEXT_PREFIX)) continue;
        const context = parseAuthContext(value);
        if (context && key === `${AUTH_CONTEXT_PREFIX}${context.id}`) contexts.push(context);
        else expired.push(key);
      }
      if (expired.length) await this.storage.remove(expired);
      return contexts;
    }
    const key = `${AUTH_CONTEXT_PREFIX}${request.id}`;
    if (request.action === 'create') {
      const context = createAuthContext(request.hostname, request.id);
      await this.storage.set({ [key]: context });
      return context;
    }
    if (request.action === 'remove') {
      await this.storage.remove(key);
      return null;
    }
    const values = await this.storage.get(key);
    const context = parseAuthContext(values[key]);
    if (!context) return null;
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
