import { extensionApi } from './extension.ts';
import type { Settings } from './settings.ts';

export type AuthStep = 'blackbaud' | 'google';
export type AuthRequest =
  | { action: 'list' }
  | { action: 'create'; id: string; hostname: string }
  | { action: 'remove' | 'pause' | 'recover'; id: string }
  | { action: 'claim' | 'confirm' | 'release'; id: string; step: AuthStep; token: string };

export type CoordinatorMessage =
  | { channel: 'blackbaud-next-coordinator-v1'; kind: 'settings'; update: Partial<Omit<Settings, 'schemaVersion'>> }
  | { channel: 'blackbaud-next-coordinator-v1'; kind: 'auth'; request: AuthRequest };

export async function requestCoordinator<T>(message: CoordinatorMessage): Promise<T> {
  const response = await extensionApi().runtime.sendMessage(message);
  if (!response || typeof response !== 'object' || !('ok' in response)) throw new Error('The extension coordinator is unavailable.');
  if (response.ok !== true) {
    throw new Error('error' in response && typeof response.error === 'string' ? response.error : 'The extension could not save this change.');
  }
  return ('value' in response ? response.value : undefined) as T;
}

export function requestAuth<T>(request: AuthRequest): Promise<T> {
  return requestCoordinator({ channel: 'blackbaud-next-coordinator-v1', kind: 'auth', request });
}
