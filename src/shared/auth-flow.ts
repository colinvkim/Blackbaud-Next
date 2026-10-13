import type { AuthContext } from '../blackbaud/auth.ts';
import { parseAuthContext } from '../blackbaud/auth.ts';
import { requestAuth, type AuthStep } from './coordinator.ts';

const pendingClaims = new WeakMap<Document, Promise<void>>();

export function waitForAuthClaim(page: Document): Promise<void> {
  return pendingClaims.get(page) ?? Promise.resolve();
}

export function readAuthContexts(): Promise<AuthContext[]> {
  return requestAuth({ action: 'list' });
}

export function createAuthFlow(hostname: string, id: string): Promise<AuthContext> {
  return requestAuth({ action: 'create', hostname, id });
}

export function removeAuthFlow(id: string): Promise<null> {
  return requestAuth({ action: 'remove', id });
}

export function pauseAuthFlow(id: string): Promise<AuthContext | null> {
  return requestAuth({ action: 'pause', id });
}

export function recoverAuthFlow(id: string): Promise<AuthContext | null> {
  return requestAuth({ action: 'recover', id });
}

export async function claimAuthAttempt<T extends HTMLElement>(
  page: Document,
  flow: AuthContext,
  step: AuthStep,
  signal: AbortSignal,
  find: () => T | null,
): Promise<{ clicked: boolean; flow: AuthContext | null }> {
  const previous = waitForAuthClaim(page);
  const attempt = (async () => {
    await previous;
    if (signal.aborted || !find()) return { clicked: false, flow };
    const token = crypto.randomUUID();
    let clicked = false;
    let failed = false;
    let current: AuthContext | null = flow;
    try {
      current = await requestAuth<AuthContext | null>({ action: 'claim', id: flow.id, step, token });
      if (current && !signal.aborted) {
        current = await requestAuth({ action: 'confirm', id: flow.id, step, token });
        const element = !signal.aborted && parseAuthContext(current) && !current?.paused ? find() : null;
        if (element) {
          // No asynchronous boundary between the final DOM readiness check and click.
          clicked = true;
          element.click();
        }
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!clicked) {
        // A claim may have persisted before its reply was lost. Roll back by
        // token even when transport rejected, without masking that failure.
        try { current = await requestAuth({ action: 'release', id: flow.id, step, token }); }
        catch (error) { if (!failed) throw error; }
      }
    }
    return { clicked, flow: current };
  })();
  const pending = attempt.then(() => {}, () => {});
  pendingClaims.set(page, pending);
  try { return await attempt; }
  finally { if (pendingClaims.get(page) === pending) pendingClaims.delete(page); }
}
