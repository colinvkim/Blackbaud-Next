export const AUTH_CONTEXT_PREFIX = 'blackbaud-next-auth-flow:';
export const AUTH_CONTEXT_LIFETIME = 5 * 60 * 1000;

export interface AuthContext {
  id: string;
  hostname: string;
  createdAt: number;
  expiresAt: number;
  paused: boolean;
  blackbaudAttempts: number;
  googleAttempts: number;
  recoveryAttempts: number;
  blackbaudClaim?: string;
  googleClaim?: string;
}

const SCHOOL_ACCOUNT_DOMAINS: Record<string, string> = {
  'polytechnic.myschoolapp.com': 'students.polytechnic.org',
  'chandler.myschoolapp.com': 'chandlerschool.org',
  'chandlerschool.myschoolapp.com': 'chandlerschool.org',
  'flintridgeprep.myschoolapp.com': 'flintridgeprep.org',
};

export function isSchoolHostname(hostname: string): boolean {
  return /^[a-z0-9-]+\.myschoolapp\.com$/i.test(hostname);
}

export function accountPreferenceForSchool(hostname: string, preference = ''): string {
  return preference.trim().toLowerCase().replace(/^@/, '') || SCHOOL_ACCOUNT_DOMAINS[hostname.toLowerCase()] || '';
}

export function accountMatchesPreference(email: string, preference: string): boolean {
  const account = email.trim().toLowerCase();
  const target = preference.trim().toLowerCase().replace(/^@/, '');
  if (!/^[^\s@]+@[^\s@]+$/.test(account) || !target) return false;
  return target.includes('@') ? account === target : account.split('@')[1] === target;
}

// Google sometimes exposes the same account in more than one DOM node. Count
// unique addresses, so duplicate nodes cannot be mistaken for multiple accounts.
export function uniqueMatchingAccount(emails: string[], preference: string): string | null {
  const matches = new Set(emails.filter((email) => accountMatchesPreference(email, preference)).map((email) => email.trim().toLowerCase()));
  return matches.size === 1 ? [...matches][0] ?? null : null;
}

export function createAuthContext(hostname: string, id: string, now = Date.now()): AuthContext {
  if (!isSchoolHostname(hostname) || !id) throw new Error('Invalid sign-in context.');
  return { id, hostname: hostname.toLowerCase(), createdAt: now, expiresAt: now + AUTH_CONTEXT_LIFETIME, paused: false, blackbaudAttempts: 0, googleAttempts: 0, recoveryAttempts: 0 };
}

export function parseAuthContext(raw: unknown, now = Date.now()): AuthContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || !value.id || typeof value.hostname !== 'string' || !isSchoolHostname(value.hostname)) return null;
  if (typeof value.createdAt !== 'number' || typeof value.expiresAt !== 'number' || value.createdAt > now || value.expiresAt <= now || value.expiresAt - value.createdAt !== AUTH_CONTEXT_LIFETIME) return null;
  if (typeof value.paused !== 'boolean') return null;
  for (const key of ['blackbaudAttempts', 'googleAttempts', 'recoveryAttempts'] as const) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 1) return null;
  }
  for (const step of ['blackbaud', 'google'] as const) {
    const claim = value[`${step}Claim`];
    if (claim !== undefined && (typeof claim !== 'string' || !claim.trim() || claim.length > 128 || value[`${step}Attempts`] !== 1)) return null;
  }
  return value as unknown as AuthContext;
}

export function selectAuthContext(contexts: AuthContext[], options: { id?: string; hostname?: string } = {}, now = Date.now()): AuthContext | null {
  const current = contexts.filter((context) => parseAuthContext(context, now) && (!options.hostname || context.hostname === options.hostname.toLowerCase()));
  if (options.id) return current.find((context) => context.id === options.id) ?? null;
  return current.length === 1 ? current[0] ?? null : null;
}

export function selectProviderAuthContext(
  contexts: AuthContext[],
  options: { id?: string; hostname?: string; step: 'blackbaud' | 'google' },
  now = Date.now(),
): AuthContext | null {
  const current = contexts.filter((context) => parseAuthContext(context, now) && (!options.hostname || context.hostname === options.hostname.toLowerCase()));
  const remembered = options.id ? current.find((context) => context.id === options.id) : undefined;
  if (!remembered) return selectAuthContext(contexts, options, now);
  // Pauses and unfinished flows still belong to the remembered provider tab.
  // Only a flow with no automatic steps remaining can yield to a newer intent.
  if (remembered.paused || remembered.blackbaudAttempts !== 1 || remembered.googleAttempts !== 1) return remembered;
  const pending = current.filter((context) => context[`${options.step}Attempts`] === 0 && context.hostname === remembered.hostname && context.createdAt > remembered.createdAt);
  // Count paused pending flows too: ignoring them could borrow another tab's
  // active context despite an ambiguous or manually paused sign-in.
  return pending.length === 0 ? remembered : pending.length === 1 ? pending[0] ?? null : null;
}

export function schoolFromSigninUrl(url: URL): string | null {
  const redirects = [...url.searchParams].filter(([key]) => key === 'redirectUrl' || key === 'redirecturl').map(([, value]) => value);
  if (new Set(redirects).size !== 1) return null;
  const redirect = redirects[0];
  if (!redirect) return null;
  try {
    const destination = new URL(redirect);
    return destination.protocol === 'https:' && isSchoolHostname(destination.hostname) ? destination.hostname : null;
  } catch {
    return null;
  }
}

export function hasSigninRedirect(url: URL): boolean {
  return url.searchParams.has('redirectUrl') || url.searchParams.has('redirecturl');
}

export function canAttempt(context: AuthContext, step: 'blackbaud' | 'google' | 'recovery', now = Date.now()): boolean {
  return Boolean(parseAuthContext(context, now)) && !context.paused && context[`${step}Attempts`] === 0;
}
