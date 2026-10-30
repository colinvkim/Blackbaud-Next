import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { accountMatchesPreference, accountPreferenceForSchool, AUTH_CONTEXT_LIFETIME, canAttempt, createAuthContext, parseAuthContext, schoolFromSigninUrl, selectAuthContext, uniqueMatchingAccount } from '../src/blackbaud/auth.ts';
import { AUTH_CONTEXT_PREFIX } from '../src/blackbaud/auth.ts';
import { isBlackbaudSignin, isGoogleOAuth } from '../src/blackbaud/routes.ts';
import { loginFeature } from '../src/features/login.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { Settings } from '../src/shared/settings.ts';
import { createCoordinator } from '../src/background/coordinator.ts';
import type { ExtensionApi } from '../src/shared/extension.ts';

test('school account matching requires the complete email or domain', () => {
  assert.equal(accountMatchesPreference('student@students.polytechnic.org', 'students.polytechnic.org'), true);
  assert.equal(accountMatchesPreference('student@students.polytechnic.org.evil.example', 'students.polytechnic.org'), false);
  assert.equal(accountMatchesPreference('student@polytechnic.org', 'students.polytechnic.org'), false);
  assert.equal(accountMatchesPreference('STUDENT@students.polytechnic.org', 'student@students.polytechnic.org'), true);
  assert.equal(accountMatchesPreference('other@students.polytechnic.org', 'student@students.polytechnic.org'), false);
  assert.equal(accountMatchesPreference('not-an-email', 'students.polytechnic.org'), false);
});

test('automatic selection needs one unique matching account', () => {
  assert.equal(uniqueMatchingAccount(['a@school.org', 'personal@example.com'], 'school.org'), 'a@school.org');
  assert.equal(uniqueMatchingAccount(['a@school.org', 'A@school.org'], 'school.org'), 'a@school.org');
  assert.equal(uniqueMatchingAccount(['a@school.org', 'b@school.org'], 'school.org'), null);
  assert.equal(uniqueMatchingAccount(['personal@example.com'], 'school.org'), null);
  assert.equal(uniqueMatchingAccount(['a@school.org', 'b@school.org'], 'b@school.org'), 'b@school.org');
});

test('default account domains are bound to an exact known school hostname', () => {
  assert.equal(accountPreferenceForSchool('polytechnic.myschoolapp.com'), 'students.polytechnic.org');
  assert.equal(accountPreferenceForSchool('other.myschoolapp.com'), '');
  assert.equal(accountPreferenceForSchool('polytechnic.myschoolapp.com', 'other@school.org'), 'other@school.org');
});

test('sign-in context expires and rejects malformed counters and hostnames', () => {
  const context = createAuthContext('polytechnic.myschoolapp.com', 'flow', 1_000);
  assert.equal(parseAuthContext(context, 1_001)?.id, 'flow');
  assert.equal(parseAuthContext(context, 1_000 + AUTH_CONTEXT_LIFETIME), null);
  assert.equal(parseAuthContext({ ...context, expiresAt: 1_000 + AUTH_CONTEXT_LIFETIME * 2 }, 1_001), null);
  assert.equal(parseAuthContext({ ...context, hostname: 'evil.example' }, 1_001), null);
  assert.equal(parseAuthContext({ ...context, googleAttempts: 2 }, 1_001), null);
  assert.equal(parseAuthContext({ ...context, googleAttempts: 1, googleClaim: 4 }, 1_001), null);
  assert.equal(parseAuthContext({ ...context, googleAttempts: 1, googleClaim: '' }, 1_001), null);
  assert.equal(parseAuthContext({ ...context, googleClaim: 'unclaimed' }, 1_001), null);
  assert.equal(parseAuthContext({ ...context, googleAttempts: 1, googleClaim: 'owner' }, 1_001)?.googleClaim, 'owner');
});

test('cross-origin continuation cannot pick between simultaneous flows', () => {
  const first = createAuthContext('polytechnic.myschoolapp.com', 'first', 1_000);
  const second = createAuthContext('other.myschoolapp.com', 'second', 1_000);
  assert.equal(selectAuthContext([first, second], {}, 1_001), null);
  assert.equal(selectAuthContext([first, second], { id: 'first' }, 1_001), first);
  assert.equal(selectAuthContext([first, second], { hostname: 'other.myschoolapp.com' }, 1_001), second);
  assert.equal(selectAuthContext([first, second], { id: 'first', hostname: 'other.myschoolapp.com' }, 1_001), null);
  assert.equal(selectAuthContext([first], { id: 'missing' }, 1_001), null);
});

test('automatic steps and recovery are each bounded and respect cancellation', () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'flow', 1_000);
  assert.equal(canAttempt(flow, 'blackbaud', 1_001), true);
  assert.equal(canAttempt({ ...flow, blackbaudAttempts: 1 }, 'blackbaud', 1_001), false);
  assert.equal(canAttempt({ ...flow, googleAttempts: 1 }, 'google', 1_001), false);
  assert.equal(canAttempt({ ...flow, recoveryAttempts: 1 }, 'recovery', 1_001), false);
  assert.equal(canAttempt({ ...flow, paused: true }, 'google', 1_001), false);
  assert.equal(canAttempt(flow, 'google', flow.expiresAt), false);
});

test('only secure school redirect URLs establish a school context', () => {
  const base = 'https://app.blackbaud.com/signin/';
  assert.equal(schoolFromSigninUrl(new URL(`${base}?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com/app/student?svcid=edu')}`)), 'polytechnic.myschoolapp.com');
  assert.equal(schoolFromSigninUrl(new URL(`${base}?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com.evil.example/')}`)), null);
  assert.equal(schoolFromSigninUrl(new URL(`${base}?redirectUrl=${encodeURIComponent('http://polytechnic.myschoolapp.com/')}`)), null);
  assert.equal(schoolFromSigninUrl(new URL(base)), null);
});

test('Blackbaud sign-in routes accept both slash variants and exclude similarly named pages', () => {
  for (const path of ['/signin', '/signin/', '/signin?sessionClear=true', '/signin/error']) {
    assert.equal(isBlackbaudSignin(new URL(`https://app.blackbaud.com${path}`)), true);
  }
  for (const url of ['http://app.blackbaud.com/signin', 'https://app.blackbaud.com:8443/signin', 'https://app.blackbaud.com/signin-help', 'https://other.example/signin']) {
    assert.equal(isBlackbaudSignin(new URL(url)), false);
  }
});

test('Google automation requires the actual secure Blackbaud callback', () => {
  const callback = 'https://id.blackbaud.com/bbid.onmicrosoft.com/oauth2/authresp';
  const google = `https://accounts.google.com/v3/signin/accountchooser?redirect_uri=${encodeURIComponent(callback)}`;
  assert.equal(isGoogleOAuth(new URL(google)), true);
  assert.equal(isGoogleOAuth(new URL(`https://accounts.google.com/signin?continue=${encodeURIComponent(google)}`)), true);
  assert.equal(isGoogleOAuth(new URL('https://accounts.google.com/signin?app_domain=https://id.blackbaud.com')), false);
  assert.equal(isGoogleOAuth(new URL('https://accounts.google.com/signin?other=blackbaud')), false);
  assert.equal(isGoogleOAuth(new URL(`https://accounts.google.com/signin?redirect_uri=${encodeURIComponent('https://id.blackbaud.com.evil.example/callback')}`)), false);
  assert.equal(isGoogleOAuth(new URL(`https://accounts.google.com/signin?redirect_uri=${encodeURIComponent('http://id.blackbaud.com/callback')}`)), false);
  assert.equal(isGoogleOAuth(new URL(`https://accounts.google.com/signin?redirect_uri=${encodeURIComponent('https://id.blackbaud.com:8443/callback')}`)), false);
  assert.equal(isGoogleOAuth(new URL(`https://accounts.google.com/signin?continue=${encodeURIComponent(`https://evil.example/?redirect_uri=${encodeURIComponent(callback)}`)}`)), false);
});

const tabId = 42;
const tabKey = `${AUTH_CONTEXT_PREFIX}${tabId}`;
const otherTabKey = `${AUTH_CONTEXT_PREFIX}${tabId + 1}`;
const authenticatedPortal = '<header id="site-header"><a id="account-nav" href="#">Account</a></header><main id="site-main">Progress</main>';

function loginFixture(url: string, html: string, settings: Partial<Settings> = {}, initialStorage: Record<string, unknown> = {}, rememberedId?: string, readiness?: 'interactive-pending' | 'interactive-ready', senderTabId = tabId, initialLocal: Record<string, unknown> = {}) {
  const page = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  let allowDomContentLoaded = readiness !== 'interactive-pending';
  const timing = { domContentLoadedEventEnd: readiness === 'interactive-ready' ? 1 : 0 };
  if (readiness) {
    Object.defineProperty(page.window.document, 'readyState', { configurable: true, value: 'interactive' });
    Object.defineProperty(page.window.performance, 'getEntriesByType', { value: () => [timing] });
    page.window.document.addEventListener('DOMContentLoaded', (event) => { if (!allowDomContentLoaded) event.stopImmediatePropagation(); }, true);
  }
  if (rememberedId) page.window.sessionStorage.setItem('blackbaud-next-auth-flow-id', rememberedId);
  const storage = { ...initialStorage };
  let failWrites = false;
  let nextWrite: (() => void) | undefined;
  let nextWriteGate: { entered: () => void; wait: Promise<void> } | undefined;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const session = {
    async get(keys?: string | string[] | null) {
      if (!keys) return structuredClone(storage);
      return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in storage).map((key) => [key, storage[key]])));
    },
    async set(update: Record<string, unknown>) {
      if (failWrites) throw new Error('Storage unavailable.');
      Object.assign(storage, structuredClone(update));
      const gate = nextWriteGate;
      nextWriteGate = undefined;
      const callback = nextWrite;
      nextWrite = undefined;
      callback?.();
      gate?.entered();
      if (gate) await gate.wait;
    },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
  };
  const local = { async get() { return { ...initialLocal }; } };
  const api = { storage: { local, session }, runtime: { id: 'auth-fixture', getURL: (path: string) => `chrome-extension://auth-fixture/${path}` } } as ExtensionApi;
  const handle = createCoordinator(api);
  api.runtime.sendMessage = async (message) => {
    const sender = { id: api.runtime.id, url, tab: { id: senderTabId }, frameId: 0 };
    try { return { ok: true, value: await handle(message, sender) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Failed' }; }
  };
  for (const [key, value] of Object.entries({ window: page.window, document: page.window.document, MutationObserver: page.window.MutationObserver, sessionStorage: page.window.sessionStorage, chrome: api })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let controller = new AbortController();
  let cleanup = loginFeature.mount({ url: new URL(url), settings: { ...DEFAULT_SETTINGS, ...settings }, signal: controller.signal });
  return {
    document: page.window.document,
    storage,
    rejectWrites() { failWrites = true; },
    onNextWrite(callback: () => void) { nextWrite = callback; },
    delayNextWrite() {
      let entered: () => void = () => {};
      let release: () => void = () => {};
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      nextWriteGate = { entered, wait };
      return { started, release };
    },
    finishDomContentLoaded() {
      allowDomContentLoaded = true;
      page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
      timing.domContentLoadedEventEnd = 1;
    },
    unmount() { controller.abort(); cleanup?.(); },
    remount() {
      controller = new AbortController();
      cleanup = loginFeature.mount({ url: new URL(url), settings: { ...DEFAULT_SETTINGS, ...settings }, signal: controller.signal });
    },
    dispose() {
      controller.abort();
      cleanup?.();
      page.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
const after = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const googleUrl = `https://accounts.google.com/v3/signin/accountchooser?redirect_uri=${encodeURIComponent('https://id.blackbaud.com/bbid.onmicrosoft.com/oauth2/authresp')}`;

test('native lowercase redirect identifies a school and rejects conflicting or unsafe values', () => {
  const school = 'https://polytechnic.myschoolapp.com/app/student';
  const url = new URL(`https://app.blackbaud.com/signin/?redirecturl=${encodeURIComponent(school)}`);
  assert.equal(schoolFromSigninUrl(url), 'polytechnic.myschoolapp.com');
  url.searchParams.set('redirectUrl', school);
  assert.equal(schoolFromSigninUrl(url), 'polytechnic.myschoolapp.com');
  url.searchParams.set('redirectUrl', 'https://chandler.myschoolapp.com/app/student');
  assert.equal(schoolFromSigninUrl(url), null);
  url.searchParams.delete('redirectUrl');
  url.searchParams.set('redirecturl', 'https://polytechnic.myschoolapp.com.evil.example/app/student');
  assert.equal(schoolFromSigninUrl(url), null);
});

test('native lowercase direct sign-in creates its own flow and continues once', async () => {
  const fixture = loginFixture('https://app.blackbaud.com/signin/?redirecturl=https%3A%2F%2Fpolytechnic.myschoolapp.com%2Fapp%2Fstudent', '<button id="google-continue-button">Continue with Google</button>');
  try {
    let clicks = 0;
    fixture.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
    await settle();
    assert.equal(clicks, 1);
    const flows = Object.values(fixture.storage).map((value) => parseAuthContext(value)).filter(Boolean);
    assert.equal(flows.length, 1);
    assert.equal(flows[0]!.hostname, 'polytechnic.myschoolapp.com');
  } finally { fixture.dispose(); }
});

test('native lowercase sign-in uses its tab flow without borrowing another school tab', async () => {
  const school = createAuthContext('polytechnic.myschoolapp.com', 'redirected-school');
  const other = { ...createAuthContext('chandler.myschoolapp.com', 'other-school'), paused: true };
  const fixture = loginFixture('https://app.blackbaud.com/signin/?redirecturl=https%3A%2F%2Fpolytechnic.myschoolapp.com%2Fapp%2Fstudent', '<button id="google-continue-button">Continue with Google</button>', {}, {
    [tabKey]: school, [otherTabKey]: other,
  });
  try {
    let clicks = 0;
    fixture.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
    await settle();
    assert.equal(clicks, 1);
    assert.equal((fixture.storage[tabKey] as typeof school).blackbaudAttempts, 1);
    assert.deepEqual(fixture.storage[otherTabKey], other);
  } finally { fixture.dispose(); }
});

test('conflicting native redirect parameters cannot borrow a remembered school flow', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'conflicting-redirect');
  const fixture = loginFixture('https://app.blackbaud.com/signin/?redirecturl=https%3A%2F%2Fpolytechnic.myschoolapp.com%2Fapp%2Fstudent&redirectUrl=https%3A%2F%2Fchandler.myschoolapp.com%2Fapp%2Fstudent', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow }, flow.id);
  try {
    await settle();
    assert.deepEqual(fixture.storage[tabKey], flow);
  } finally { fixture.dispose(); }
});

test('direct school sign-in retains native controls and reuses the prepared flow', async () => {
  const fixture = loginFixture('https://polytechnic.myschoolapp.com/app?svcid=edu#login', '<input id="email"><input id="remember" type="checkbox"><input id="nextBtn" type="button" value="Next"><iframe></iframe><script id="native-script"></script>');
  try {
    await settle();
    const direct = fixture.document.querySelector<HTMLButtonElement>('.bn-login-option button');
    assert.ok(direct);
    assert.ok(fixture.document.querySelector('#email'));
    assert.ok(fixture.document.querySelector('#remember'));
    assert.ok(fixture.document.querySelector('iframe'));
    assert.ok(fixture.document.querySelector('#native-script'));
    direct.click();
    await settle();
    assert.equal(Object.keys(fixture.storage).filter((key) => key.startsWith(AUTH_CONTEXT_PREFIX)).length, 1);
  } finally { fixture.dispose(); }
});

test('continue manually cancels pending clicks and persists the pause across providers', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'cancel-flow');
  const initial = { [tabKey]: flow };
  const fixture = loginFixture(`https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com/app/student?svcid=edu')}`, '<main>Native sign-in</main>', {}, initial);
  let updated: Record<string, unknown> = {};
  try {
    await settle();
    const cancel = [...fixture.document.querySelectorAll<HTMLButtonElement>('#blackbaud-next-signin-status button')].find((button) => button.textContent === 'Continue manually');
    assert.ok(cancel);
    cancel.click();
    const button = fixture.document.createElement('button');
    button.id = 'google-continue-button';
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });
    fixture.document.body.append(button);
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).paused, true);
    assert.equal(fixture.document.querySelector('#blackbaud-next-signin-status'), null);
    updated = { ...fixture.storage };
  } finally { fixture.dispose(); }
  const provider = loginFixture(googleUrl, '<button data-email="student@students.polytechnic.org">School account</button>', {}, updated);
  try {
    let clicks = 0;
    provider.document.querySelector('button')?.addEventListener('click', () => { clicks += 1; });
    await settle();
    assert.equal(clicks, 0);
    assert.equal(provider.document.querySelector('#blackbaud-next-signin-status'), null);
  } finally { provider.dispose(); }
});

test('provider cleanup prevents a delayed Google click after route teardown', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'teardown-flow');
  const fixture = loginFixture(googleUrl, '<main>Loading accounts</main>', {}, { [tabKey]: flow });
  try {
    await settle();
    fixture.unmount();
    const account = fixture.document.createElement('button');
    account.dataset.email = 'student@students.polytechnic.org';
    let clicks = 0;
    account.addEventListener('click', () => { clicks += 1; });
    fixture.document.body.append(account);
    await after(350);
    assert.equal(clicks, 0);
    assert.equal(fixture.document.querySelector('#blackbaud-next-signin-status'), null);
    assert.equal(fixture.document.querySelector('main')?.textContent, 'Loading accounts');
    assert.equal(fixture.document.querySelector('#blackbaud-next-login'), null);
  } finally { fixture.dispose(); }
});

test('a chooser that adds a second school account remains manual', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'multiple-flow');
  const fixture = loginFixture(googleUrl, '<button data-email="first@students.polytechnic.org">First school account</button>', {}, { [tabKey]: flow });
  try {
    let clicks = 0;
    fixture.document.querySelector('button')?.addEventListener('click', () => { clicks += 1; });
    await settle();
    const second = fixture.document.createElement('button');
    second.dataset.email = 'second@students.polytechnic.org';
    second.addEventListener('click', () => { clicks += 1; });
    fixture.document.body.append(second);
    await after(350);
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 0);
    assert.match(fixture.document.querySelector('#blackbaud-next-signin-status')?.textContent ?? '', /one matching school account/);
  } finally { fixture.dispose(); }
});

test('an exact account preference selects one school account once', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'preferred-flow');
  const fixture = loginFixture(googleUrl, '<button data-email="first@students.polytechnic.org">First school account</button><button data-email="second@students.polytechnic.org">Second school account</button>', { accountPreference: 'second@students.polytechnic.org' }, { [tabKey]: flow });
  try {
    const clicks: string[] = [];
    for (const button of fixture.document.querySelectorAll<HTMLButtonElement>('[data-email]')) button.addEventListener('click', () => { clicks.push(button.dataset.email ?? ''); });
    await settle();
    assert.deepEqual(clicks, ['second@students.polytechnic.org']);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 1);
  } finally { fixture.dispose(); }
});

test('each school login tab prepares its own context instead of borrowing another tab', async () => {
  const other = { ...createAuthContext('polytechnic.myschoolapp.com', 'other-tab'), paused: true };
  const fixture = loginFixture('https://polytechnic.myschoolapp.com/app?svcid=edu#login', '<input id="nextBtn" type="button" value="Next">', {}, { [otherTabKey]: other });
  try {
    await settle();
    const own = parseAuthContext(fixture.storage[tabKey]);
    assert.ok(own);
    assert.notEqual(own.id, other.id);
    assert.equal(own.paused, false);
    assert.deepEqual(fixture.storage[otherTabKey], other);
  } finally { fixture.dispose(); }
});

test('a completed login clears only this tab and a fresh school login creates a new flow', async () => {
  const previous = createAuthContext('polytechnic.myschoolapp.com', 'completed-flow');
  const other = { ...createAuthContext(previous.hostname, 'other-pending-flow'), paused: true };
  const completed = loginFixture('https://polytechnic.myschoolapp.com/app/student?svcid=edu#studentmyday/progress', authenticatedPortal, {}, { [tabKey]: previous, [otherTabKey]: other });
  let remaining: Record<string, unknown> = {};
  try {
    await settle();
    assert.equal(completed.storage[tabKey], undefined);
    assert.deepEqual(completed.storage[otherTabKey], other);
    remaining = { ...completed.storage };
  } finally { completed.dispose(); }
  const next = loginFixture('https://polytechnic.myschoolapp.com/app?svcId=edu&envId=school&bb_id=1#login', '<input id="nextBtn" type="button" value="Next">', {}, remaining);
  try {
    await settle();
    next.document.querySelector<HTMLButtonElement>('.bn-login-option button')?.click();
    await settle();
    const current = parseAuthContext(next.storage[tabKey]);
    assert.ok(current);
    assert.notEqual(current.id, previous.id);
    assert.deepEqual(next.storage[otherTabKey], other);
  } finally { next.dispose(); }
});

test('redirect-only Google sign-in completes a provider-created flow across worker restart and permits an immediate next sign-in', async () => {
  const url = `https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com/app/student?svcid=edu')}`;
  const button = '<button id="google-continue-button">Continue with Google</button>';
  const provider = loginFixture(url, button, {}, {}, undefined, undefined, 42);
  let persisted: Record<string, unknown> = {};
  let flowId = '';
  try {
    let clicks = 0;
    provider.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
    await settle();
    assert.equal(clicks, 1);
    const flows = Object.values(provider.storage).map((value) => parseAuthContext(value)).filter((value) => value !== null);
    assert.equal(flows.length, 1);
    assert.equal(flows[0]!.blackbaudAttempts, 1);
    assert.equal(flows[0]!.googleAttempts, 0);
    flowId = flows[0]!.id;
    persisted = { ...provider.storage };
  } finally { provider.dispose(); }

  // Google returns an HTTP redirect, so there is no Google document or click.
  // The school origin still remembers a different, already completed legacy flow.
  const school = loginFixture('https://polytechnic.myschoolapp.com/app/student?svcid=edu#studentmyday/progress', authenticatedPortal, {}, persisted, 'previous-school-flow', undefined, 42);
  try {
    await settle();
    assert.equal(school.storage[tabKey], undefined);
    persisted = { ...school.storage };
  } finally { school.dispose(); }

  const next = loginFixture(url, button, {}, persisted, flowId, undefined, 42);
  try {
    let clicks = 0;
    next.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
    await settle();
    assert.equal(clicks, 1);
  } finally { next.dispose(); }
});

test('Blackbaud continues through the observed Google label only after its button becomes enabled', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'enabled-flow');
  const url = `https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com/app/student?svcid=edu')}`;
  const fixture = loginFixture(url, '<button disabled>Continue with Google</button>', {}, { [tabKey]: flow });
  let updated: Record<string, unknown> = {};
  try {
    const button = fixture.document.querySelector<HTMLButtonElement>('button');
    assert.ok(button);
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });
    await settle();
    assert.equal(clicks, 0);
    button.disabled = false;
    await settle();
    assert.equal(clicks, 1);
    assert.equal((fixture.storage[tabKey] as typeof flow).blackbaudAttempts, 1);
    updated = { ...fixture.storage };
  } finally { fixture.dispose(); }
  const revisited = loginFixture(url, '<button>Continue with Google</button>', {}, updated);
  try {
    let clicks = 0;
    revisited.document.querySelector('button')?.addEventListener('click', () => { clicks += 1; });
    await settle();
    assert.equal(clicks, 0);
  } finally { revisited.dispose(); }
});

test('manual cancellation removes status immediately even if session storage fails', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'failed-storage-flow');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<main>Native sign-in</main>', {}, { [tabKey]: flow });
  try {
    await settle();
    const cancel = [...fixture.document.querySelectorAll<HTMLButtonElement>('#blackbaud-next-signin-status button')].find((button) => button.textContent === 'Continue manually');
    assert.ok(cancel);
    fixture.rejectWrites();
    cancel.click();
    assert.equal(fixture.document.querySelector('#blackbaud-next-signin-status'), null);
    await settle();
    assert.equal(fixture.document.querySelector('main')?.textContent, 'Native sign-in');
  } finally { fixture.dispose(); }
});

test('Blackbaud rerendering the injected option restores one direct sign-in button', async () => {
  const fixture = loginFixture('https://polytechnic.myschoolapp.com/app#login', '<input id="nextBtn" type="button" value="Next">');
  try {
    await settle();
    fixture.document.querySelector('.bn-login-option')?.remove();
    await settle();
    assert.equal(fixture.document.querySelectorAll('.bn-login-option').length, 1);
    fixture.unmount();
    assert.equal(fixture.document.querySelectorAll('.bn-login-option').length, 0);
    assert.ok(fixture.document.querySelector('#nextBtn'));
  } finally { fixture.dispose(); }
});

test('an exact account continues as soon as accessibility state makes it actionable', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'ready-account-flow');
  const fixture = loginFixture(googleUrl, '<div aria-hidden="true"><button data-email="student@students.polytechnic.org" aria-disabled="true">School account</button></div>', { accountPreference: 'student@students.polytechnic.org' }, { [tabKey]: flow });
  try {
    const account = fixture.document.querySelector<HTMLButtonElement>('[data-email]');
    assert.ok(account);
    let clicks = 0;
    account.addEventListener('click', () => { clicks += 1; });
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 0);
    account.removeAttribute('aria-disabled');
    await settle();
    assert.equal(clicks, 0);
    account.parentElement?.removeAttribute('aria-hidden');
    await settle();
    assert.equal(clicks, 1);
  } finally { fixture.dispose(); }
});

test('Blackbaud re-resolves a button replaced while the attempt is saved', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'replaced-button-flow');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow });
  try {
    const original = fixture.document.querySelector<HTMLButtonElement>('button');
    assert.ok(original);
    const replacement = fixture.document.createElement('button');
    replacement.id = 'google-continue-button';
    const clicks: string[] = [];
    original.addEventListener('click', () => { clicks.push('original'); });
    replacement.addEventListener('click', () => { clicks.push('replacement'); });
    fixture.onNextWrite(() => { original.replaceWith(replacement); });
    await settle();
    assert.deepEqual(clicks, ['replacement']);
    assert.equal((fixture.storage[tabKey] as typeof flow).blackbaudAttempts, 1);
  } finally { fixture.dispose(); }
});

test('a button disabled during the claim keeps its attempt available until ready', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'disabled-during-claim');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow });
  try {
    const button = fixture.document.querySelector<HTMLButtonElement>('button');
    assert.ok(button);
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });
    fixture.onNextWrite(() => { button.disabled = true; });
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).blackbaudAttempts, 0);
    button.disabled = false;
    await settle();
    assert.equal(clicks, 1);
    assert.equal((fixture.storage[tabKey] as typeof flow).blackbaudAttempts, 1);
  } finally { fixture.dispose(); }
});

test('Google re-resolves the intended account after a claim-time rerender', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'replaced-account-flow');
  const fixture = loginFixture(googleUrl, '<button data-email="student@students.polytechnic.org">School account</button>', { accountPreference: 'student@students.polytechnic.org' }, { [tabKey]: flow });
  try {
    const original = fixture.document.querySelector<HTMLButtonElement>('[data-email]');
    assert.ok(original);
    const replacement = fixture.document.createElement('button');
    replacement.dataset.email = 'student@students.polytechnic.org';
    const clicks: string[] = [];
    original.addEventListener('click', () => { clicks.push('original'); });
    replacement.addEventListener('click', () => { clicks.push('replacement'); });
    fixture.onNextWrite(() => { original.replaceWith(replacement); });
    await settle();
    assert.deepEqual(clicks, ['replacement']);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 1);
  } finally { fixture.dispose(); }
});

test('a detached Google account does not consume an attempt or click after cancellation', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'detached-account-flow');
  const fixture = loginFixture(googleUrl, '<button data-email="student@students.polytechnic.org">School account</button>', { accountPreference: 'student@students.polytechnic.org' }, { [tabKey]: flow });
  try {
    const account = fixture.document.querySelector<HTMLButtonElement>('[data-email]');
    assert.ok(account);
    let clicks = 0;
    account.addEventListener('click', () => { clicks += 1; });
    fixture.onNextWrite(() => { account.remove(); });
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 0);
    const cancel = [...fixture.document.querySelectorAll<HTMLButtonElement>('#blackbaud-next-signin-status button')].find((button) => button.textContent === 'Continue manually');
    assert.ok(cancel);
    cancel.click();
    fixture.document.body.append(account);
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).paused, true);
  } finally { fixture.dispose(); }
});

test('a school account added during a domain claim prevents an ambiguous click', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'claim-ambiguity-flow');
  const fixture = loginFixture(googleUrl, '<button data-email="first@students.polytechnic.org">First school account</button>', {}, { [tabKey]: flow });
  try {
    const first = fixture.document.querySelector<HTMLButtonElement>('[data-email]');
    assert.ok(first);
    let clicks = 0;
    first.addEventListener('click', () => { clicks += 1; });
    const second = fixture.document.createElement('button');
    second.dataset.email = 'second@students.polytechnic.org';
    second.addEventListener('click', () => { clicks += 1; });
    fixture.onNextWrite(() => { fixture.document.body.append(second); });
    await after(350);
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 0);
    fixture.unmount();
  } finally { fixture.dispose(); }
});

test('manual cancellation during the claim write prevents an automatic click', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'claim-cancel-flow');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow });
  try {
    let clicks = 0;
    fixture.document.querySelector('#google-continue-button')?.addEventListener('click', () => { clicks += 1; });
    fixture.onNextWrite(() => {
      const cancel = [...fixture.document.querySelectorAll<HTMLButtonElement>('#blackbaud-next-signin-status button')].find((button) => button.textContent === 'Continue manually');
      assert.ok(cancel);
      cancel.click();
    });
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).paused, true);
    assert.equal(fixture.document.querySelector('#blackbaud-next-signin-status'), null);
  } finally { fixture.dispose(); }
});

test('interactive markup waits for DOMContentLoaded and its later native handlers', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'pending-parser-flow');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow }, undefined, 'interactive-pending');
  try {
    const button = fixture.document.querySelector<HTMLButtonElement>('#google-continue-button');
    assert.ok(button);
    const clicks: string[] = [];
    let nativeReady = false;
    button.addEventListener('click', () => { if (!nativeReady) clicks.push('premature'); });
    await settle();
    assert.equal(clicks.length, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).blackbaudAttempts, 0);
    // Register after the content script's readiness listener to model a deferred
    // script finishing initialization in the same DOMContentLoaded dispatch.
    fixture.document.addEventListener('DOMContentLoaded', () => {
      nativeReady = true;
      button.addEventListener('click', () => { clicks.push('native'); });
    });
    fixture.finishDomContentLoaded();
    await after(0);
    await settle();
    assert.deepEqual(clicks, ['native']);
  } finally { fixture.dispose(); }
});

test('domain matching includes accounts added when native handlers become ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'late-parser-account');
  const fixture = loginFixture(googleUrl, '<button data-email="first@students.polytechnic.org">First school account</button>', {}, { [tabKey]: flow }, undefined, 'interactive-pending');
  try {
    let clicks = 0;
    await settle();
    t.mock.timers.tick(1_000);
    await settle();
    const second = fixture.document.createElement('button');
    second.dataset.email = 'second@students.polytechnic.org';
    fixture.document.body.append(second);
    for (const button of fixture.document.querySelectorAll('[data-email]')) button.addEventListener('click', () => { clicks++; });
    fixture.finishDomContentLoaded();
    t.mock.timers.tick(0);
    await settle();
    t.mock.timers.tick(350);
    await settle();
    assert.equal(clicks, 0);
    assert.equal((fixture.storage[tabKey] as typeof flow).googleAttempts, 0);
    assert.match(fixture.document.querySelector('#blackbaud-next-signin-status')?.textContent ?? '', /one matching school account/);
  } finally { fixture.dispose(); }
});

test('interactive documents whose DOMContentLoaded already fired continue immediately', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'parsed-interactive-flow');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow }, undefined, 'interactive-ready');
  try {
    let clicks = 0;
    fixture.document.querySelector('#google-continue-button')?.addEventListener('click', () => { clicks += 1; });
    await settle();
    assert.equal(clicks, 1);
  } finally { fixture.dispose(); }
});

test('a remount waits for an aborted claim write to release its unused reservation', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'pending-write-remount');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow });
  const write = fixture.delayNextWrite();
  try {
    let clicks = 0;
    fixture.document.querySelector('#google-continue-button')?.addEventListener('click', () => { clicks += 1; });
    await write.started;
    const originalClaim = (fixture.storage[tabKey] as typeof flow).blackbaudClaim;
    assert.ok(originalClaim);
    fixture.unmount();
    fixture.remount();
    await settle();
    assert.equal(clicks, 0);
    write.release();
    await settle();
    assert.equal(clicks, 1);
    const completed = fixture.storage[tabKey] as typeof flow;
    assert.equal(completed.blackbaudAttempts, 1);
    assert.notEqual(completed.blackbaudClaim, originalClaim);
  } finally { write.release(); fixture.dispose(); }
});

test('an aborted reservation never releases a newer owner or its pause state', async () => {
  const flow = createAuthContext('polytechnic.myschoolapp.com', 'newer-claim-flow');
  const fixture = loginFixture('https://app.blackbaud.com/signin/', '<button id="google-continue-button">Continue with Google</button>', {}, { [tabKey]: flow });
  const write = fixture.delayNextWrite();
  try {
    let clicks = 0;
    fixture.document.querySelector('#google-continue-button')?.addEventListener('click', () => { clicks += 1; });
    await write.started;
    const newer = { ...(fixture.storage[tabKey] as typeof flow), paused: true, blackbaudClaim: 'new-owner', googleAttempts: 1, googleClaim: 'google-owner' };
    fixture.storage[tabKey] = newer;
    fixture.unmount();
    write.release();
    await settle();
    assert.equal(clicks, 0);
    assert.deepEqual(fixture.storage[tabKey], newer);
  } finally { write.release(); fixture.dispose(); }
});

test('a spent remembered flow still offers one bounded Blackbaud error recovery', async () => {
  const flow = { ...createAuthContext('polytechnic.myschoolapp.com', 'spent-error-flow'), blackbaudAttempts: 1, googleAttempts: 1, blackbaudClaim: 'old-blackbaud-claim', googleClaim: 'old-google-claim' };
  const fixture = loginFixture('https://app.blackbaud.com/signin/error', '<main>Native sign-in error</main>', {}, { [tabKey]: flow }, flow.id);
  try {
    await settle();
    const retry = [...fixture.document.querySelectorAll<HTMLButtonElement>('#blackbaud-next-signin-status button')].find((button) => button.textContent === 'Retry sign-in');
    assert.ok(retry);
    retry.click();
    await settle();
    const updated = fixture.storage[tabKey] as typeof flow;
    assert.equal(updated.recoveryAttempts, 1);
    assert.equal(updated.blackbaudAttempts, 0);
    assert.equal(updated.googleAttempts, 0);
    assert.equal(updated.blackbaudClaim, undefined);
    assert.equal(updated.googleClaim, undefined);
    fixture.unmount();
    fixture.remount();
    await settle();
    assert.equal([...fixture.document.querySelectorAll('button')].some((button) => button.textContent === 'Retry sign-in'), false);
  } finally { fixture.dispose(); }
});

test('Google does not borrow a different tab’s pending or paused sign-in', async () => {
  for (const paused of [false, true]) {
    const other = { ...createAuthContext('polytechnic.myschoolapp.com', `foreign-google-${paused}`), blackbaudAttempts: 1, paused };
    const fixture = loginFixture(googleUrl, '<button data-email="student@students.polytechnic.org">School account</button>', { accountPreference: 'student@students.polytechnic.org' }, { [otherTabKey]: other });
    try {
      let clicks = 0;
      fixture.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
      await settle();
      assert.equal(clicks, 0);
      assert.deepEqual(fixture.storage, { [otherTabKey]: other });
    } finally { fixture.dispose(); }
  }
});

test('legacy local sign-in records and origin hints are ignored without adopting their state', async () => {
  const legacy = { ...createAuthContext('polytechnic.myschoolapp.com', 'legacy-paused'), paused: true, blackbaudAttempts: 1 };
  const local = { [`${AUTH_CONTEXT_PREFIX}${legacy.id}`]: legacy };
  const fixture = loginFixture(`https://app.blackbaud.com/signin?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com/app/student')}`, '<button id="google-continue-button">Continue with Google</button>', {}, {}, legacy.id, undefined, tabId, local);
  try {
    let clicks = 0;
    fixture.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
    await settle();
    assert.equal(clicks, 1);
    const current = parseAuthContext(fixture.storage[tabKey]);
    assert.ok(current);
    assert.notEqual(current.id, legacy.id);
    assert.deepEqual(local, { [`${AUTH_CONTEXT_PREFIX}${legacy.id}`]: legacy });
  } finally { fixture.dispose(); }
});

test('direct sign-in preserves a prepared generation and explicitly replaces spent or paused intent', async () => {
  for (const state of ['prepared', 'spent', 'paused'] as const) {
    const flow = { ...createAuthContext('polytechnic.myschoolapp.com', `direct-${state}`), blackbaudAttempts: state === 'spent' ? 1 : 0, paused: state === 'paused' };
    const fixture = loginFixture('https://polytechnic.myschoolapp.com/app#login', '<input id="nextBtn" type="button" value="Next">', {}, { [tabKey]: flow });
    try {
      await settle();
      assert.deepEqual(fixture.storage[tabKey], flow);
      const direct = fixture.document.querySelector<HTMLButtonElement>('.bn-login-option button');
      assert.ok(direct);
      direct.click();
      await settle();
      const current = parseAuthContext(fixture.storage[tabKey]);
      assert.ok(current);
      if (state === 'prepared') assert.deepEqual(current, flow);
      else assert.notEqual(current.id, flow.id);
      assert.equal(current.blackbaudAttempts, 0);
      assert.equal(current.googleAttempts, 0);
      assert.equal(current.paused, false);
      assert.equal(Object.keys(fixture.storage).length, 1);
    } finally { fixture.dispose(); }
  }
});

test('completion waits for delayed native authenticated portal structure', async () => {
  const flow = { ...createAuthContext('polytechnic.myschoolapp.com', 'delayed-portal'), blackbaudAttempts: 1 };
  const fixture = loginFixture('https://polytechnic.myschoolapp.com/app/student#studentmyday/progress', '<main id="site-main">Loading Progress</main>', {}, { [tabKey]: flow });
  try {
    await settle();
    assert.deepEqual(fixture.storage[tabKey], flow);
    fixture.document.body.insertAdjacentHTML('afterbegin', '<header id="site-header"><a id="account-nav" href="#">Account</a></header>');
    await settle();
    assert.equal(fixture.storage[tabKey], undefined);
    assert.equal(fixture.document.querySelector('#site-main')?.textContent, 'Loading Progress');
  } finally { fixture.dispose(); }
});

test('public, login, and unsupported native structures cannot complete a sign-in', async () => {
  const student = 'https://polytechnic.myschoolapp.com/app/student#studentmyday/progress';
  const cases = [
    ['public school root', 'https://polytechnic.myschoolapp.com/', authenticatedPortal],
    ['login hash', 'https://polytechnic.myschoolapp.com/app/student#login', authenticatedPortal],
    ['login form', student, `${authenticatedPortal}<form id="site-login-form"><input id="Username"><input id="Password" type="password"></form>`],
    ['missing account control', student, '<header id="site-header"></header><main id="site-main">Progress</main>'],
    ['missing main', student, '<header id="site-header"><a id="account-nav" href="#">Account</a></header>'],
    ['changed account link', student, authenticatedPortal.replace('href="#"', 'href="/login"')],
    ['duplicate main', student, `${authenticatedPortal}<main id="site-main">Other</main>`],
    ['duplicate account', student, authenticatedPortal.replace('</header>', '<a id="account-nav" href="#">Other</a></header>')],
    ['duplicate header', student, `${authenticatedPortal}<header id="site-header"></header>`],
    ['hidden authenticated controls', student, authenticatedPortal.replace('<header ', '<header hidden ')],
  ] as const;
  for (const [name, url, html] of cases) {
    const flow = { ...createAuthContext('polytechnic.myschoolapp.com', `unverified-${name}`), blackbaudAttempts: 1 };
    const fixture = loginFixture(url, html, {}, { [tabKey]: flow });
    try {
      await settle();
      assert.deepEqual(fixture.storage[tabKey], flow, name);
    } finally { fixture.dispose(); }
  }
});

test('aborted completion does not clear a flow when native portal controls arrive later', async () => {
  const flow = { ...createAuthContext('polytechnic.myschoolapp.com', 'aborted-completion'), blackbaudAttempts: 1 };
  const fixture = loginFixture('https://polytechnic.myschoolapp.com/app/student', '<main id="site-main">Loading Progress</main>', {}, { [tabKey]: flow });
  try {
    await settle();
    fixture.unmount();
    fixture.document.body.innerHTML = authenticatedPortal;
    await settle();
    assert.deepEqual(fixture.storage[tabKey], flow);
  } finally { fixture.dispose(); }
});

test('delayed authenticated structure cannot complete a newer generation in the same tab', async () => {
  const original = { ...createAuthContext('polytechnic.myschoolapp.com', 'completing-generation'), blackbaudAttempts: 1 };
  const fixture = loginFixture('https://polytechnic.myschoolapp.com/app/student', '<main id="site-main">Loading Progress</main>', {}, { [tabKey]: original });
  try {
    await settle();
    const newer = createAuthContext(original.hostname, 'newer-pending-generation');
    fixture.storage[tabKey] = newer;
    fixture.document.body.innerHTML = authenticatedPortal;
    await settle();
    assert.deepEqual(fixture.storage[tabKey], newer);
  } finally { fixture.dispose(); }
});

test('provider documents cannot borrow a new generation after their context is removed, expired, or replaced', async () => {
  for (const provider of ['blackbaud', 'google'] as const) {
    for (const state of ['removed', 'expired', 'replaced'] as const) {
      const first = { ...createAuthContext('polytechnic.myschoolapp.com', `bound-${provider}-${state}`), blackbaudAttempts: provider === 'google' ? 1 : 0 };
      const url = provider === 'google' ? googleUrl : `https://app.blackbaud.com/signin?redirectUrl=${encodeURIComponent('https://polytechnic.myschoolapp.com/app/student')}`;
      const html = provider === 'google' ? '<button data-email="student@students.polytechnic.org">School account</button>' : '<button id="google-continue-button">Continue with Google</button>';
      const fixture = loginFixture(url, html, { accountPreference: 'student@students.polytechnic.org' }, { [tabKey]: first });
      try {
        let clicks = 0;
        fixture.document.querySelector('button')!.addEventListener('click', () => { clicks++; });
        await settle();
        assert.equal(clicks, 1, `${provider} ${state}`);
        const fresh = { ...createAuthContext(first.hostname, `fresh-${provider}-${state}`), blackbaudAttempts: provider === 'google' ? 1 : 0 };
        fixture.unmount();
        if (state === 'removed') delete fixture.storage[tabKey];
        else if (state === 'expired') fixture.storage[tabKey] = createAuthContext(first.hostname, first.id, Date.now() - AUTH_CONTEXT_LIFETIME);
        else fixture.storage[tabKey] = fresh;
        fixture.remount();
        await settle();
        assert.equal(clicks, 1, `${provider} ${state}`);
        if (state === 'replaced') assert.deepEqual(fixture.storage[tabKey], fresh);
        else assert.equal(fixture.storage[tabKey], undefined);
      } finally { fixture.dispose(); }
    }
  }
});
