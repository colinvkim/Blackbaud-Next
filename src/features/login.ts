import { THEME_TOKENS } from '../shared/theme.ts';
import { accountPreferenceForSchool, canAttempt, hasSigninRedirect, schoolFromSigninUrl, selectAuthContext, selectProviderAuthContext, uniqueMatchingAccount } from '../blackbaud/auth.ts';
import type { AuthContext } from '../blackbaud/auth.ts';
import { accountChoices, findBlackbaudGoogleButton, findGoogleAccount, findSchoolSigninAnchor } from '../blackbaud/auth-dom.ts';
import { blackbaudSigninUrl, isBlackbaudSignin, isGoogleOAuth, isLmsPage, isSchoolPage } from '../blackbaud/routes.ts';
import { markOwned, addStyle, createButton, observeDom, waitForElement, waitForReadyElement } from '../shared/dom.ts';
import { claimAuthAttempt, createAuthFlow, pauseAuthFlow, readAuthContexts, recoverAuthFlow, removeAuthFlow, waitForAuthClaim } from '../shared/auth-flow.ts';
import type { Cleanup, Feature, FeatureContext } from '../shared/types.ts';

const TAB_FLOW_KEY = 'blackbaud-next-auth-flow-id';
const providerFlows = new WeakMap<Document, string>();
const LOGIN_STYLE = `
.bn-login-option { margin-top: 12px; color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-login-option .bn-button { width: 100%; min-height: 40px; padding: 10px 16px; color: #fff; background: var(--bn-accent); border: 1px solid var(--bn-accent); border-radius: var(--bn-radius); cursor: pointer; font: inherit; font-weight: 600; }
.bn-login-option .bn-button:hover:not(:disabled) { background: var(--bn-accent-hover); border-color: var(--bn-accent-hover); }
.bn-login-option .bn-button:disabled { opacity: .6; cursor: default; }
.bn-login-option .bn-button:focus-visible, #blackbaud-next-signin-status button:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
.bn-login-option small { display: block; margin-top: 8px; color: var(--bn-muted); }
#blackbaud-next-signin-status { position: fixed; bottom: 20px; right: 20px; z-index: 100000; width: min(360px, calc(100vw - 40px)); box-sizing: border-box; background: var(--bn-surface); border: 1px solid var(--bn-border); border-radius: var(--bn-radius-lg); padding: 16px; box-shadow: var(--bn-shadow); font: 14px/1.5 var(--bn-font); color: var(--bn-text); }
#blackbaud-next-signin-status p { margin: 0 0 12px; }
#blackbaud-next-signin-status .bn-login-actions { display: flex; flex-wrap: wrap; gap: 8px; }
#blackbaud-next-signin-status button { min-height: 36px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); background: var(--bn-surface); padding: 6px 10px; color: var(--bn-text); font: inherit; font-weight: 600; cursor: pointer; }
#blackbaud-next-signin-status button:hover { background: var(--bn-accent-soft); border-color: var(--bn-accent); color: var(--bn-accent-hover); }
@media (prefers-reduced-motion: reduce) { #blackbaud-next-signin-status { scroll-behavior: auto; } }
`;

function readTabFlowId(): string | undefined {
  try { return sessionStorage.getItem(TAB_FLOW_KEY) ?? undefined; } catch { return undefined; }
}

function rememberTabFlow(id: string): void {
  try { sessionStorage.setItem(TAB_FLOW_KEY, id); } catch { /* Storage can be disabled by the browser. */ }
}

async function waitForAccountChoices(signal: AbortSignal, preference: string): Promise<HTMLElement[]> {
  if (preference.includes('@')) {
    // An exact address cannot become ambiguous when other accounts arrive, so
    // it can continue as soon as that account is ready.
    const intendedAccount = preference.trim().toLowerCase();
    return await waitForReadyElement(() => findGoogleAccount(preference, intendedAccount), signal) ? accountChoices() : [];
  }
  if (!await waitForElement('[data-email]', signal, 10_000) || signal.aborted) return [];
  return new Promise((resolve) => {
    let stop: Cleanup = () => {};
    let settled = false;
    let signature = '';
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      stop();
      signal.removeEventListener('abort', finish);
      resolve(signal.aborted ? [] : accountChoices());
    };
    const deadline = setTimeout(finish, 2_000);
    signal.addEventListener('abort', finish, { once: true });
    stop = observeDom(() => {
      const current = accountChoices().map((node) => node.dataset.email ?? '').join('\n');
      if (quietTimer && current === signature) return;
      signature = current;
      clearTimeout(quietTimer);
      // Allow the chooser to finish mounting all accounts before deciding that
      // there is exactly one matching account.
      quietTimer = setTimeout(finish, 300);
    }, signal);
    if (settled) stop();
  });
}

async function newContext(hostname: string): Promise<AuthContext> {
  const context = await createAuthFlow(hostname, crypto.randomUUID());
  rememberTabFlow(context.id);
  return context;
}

function mountLogin(context: FeatureContext): Cleanup {
  const { url, settings } = context;
  const page = document;
  const controller = new AbortController();
  const signal = controller.signal;
  const dispose: Cleanup[] = [addStyle('login', `${isSchoolPage(url) ? '' : THEME_TOKENS}\n${LOGIN_STYLE}`)];
  const abort = () => controller.abort();
  context.signal.addEventListener('abort', abort, { once: true });
  if (context.signal.aborted) abort();
  let flow: AuthContext | null = null;
  let status: HTMLElement | null = null;
  let statusText: HTMLParagraphElement | null = null;
  let statusActions: HTMLElement | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let paused = false;
  let statusDismissed = false;

  const hideStatus = () => {
    clearTimeout(statusTimer);
    status?.remove();
    status = null;
    statusText = null;
    statusActions = null;
  };
  dispose.push(hideStatus);

  const pause = async () => {
    paused = true;
    controller.abort();
    hideStatus();
    if (flow) {
      try { flow = await pauseAuthFlow(flow.id); } catch { /* This page's automation is already stopped. */ }
    }
  };

  const showStatus = (message: string, active = false) => {
    if (!settings.loadingOverlay || paused || statusDismissed || context.signal.aborted) return;
    if (!status) {
      status = markOwned(document.createElement('section'));
      status.id = 'blackbaud-next-signin-status';
      status.setAttribute('aria-label', 'Blackbaud Next sign-in');
      statusText = document.createElement('p');
      statusText.setAttribute('role', 'status');
      statusText.setAttribute('aria-live', 'polite');
      statusActions = document.createElement('div');
      statusActions.className = 'bn-login-actions';
      const cancel = createButton('Continue manually');
      cancel.addEventListener('click', () => { void pause(); });
      const dismiss = createButton('Dismiss');
      dismiss.addEventListener('click', () => { statusDismissed = true; hideStatus(); });
      statusActions.append(cancel, dismiss);
      status.append(statusText, statusActions);
      (document.body ?? document.documentElement).append(status);
    }
    if (statusText) statusText.textContent = message;
    clearTimeout(statusTimer);
    // A status never covers native controls and never remains indefinitely.
    statusTimer = setTimeout(() => { if (active) void pause(); else hideStatus(); }, 15_000);
  };

  const claimAttempt = async <T extends HTMLElement>(step: 'blackbaud' | 'google', find: () => T | null): Promise<boolean> => {
    if (signal.aborted || paused || !flow) return false;
    const result = await claimAuthAttempt(page, flow, step, signal, find);
    flow = result.flow;
    if (flow?.paused) paused = true;
    return result.clicked;
  };

  const readyAttempt = async <T extends HTMLElement>(step: 'blackbaud' | 'google', find: () => T | null): Promise<boolean> => {
    const deadline = Date.now() + 10_000;
    while (!signal.aborted && !paused && flow && canAttempt(flow, step)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || !await waitForReadyElement(find, signal, remaining)) return false;
      if (await claimAttempt(step, find)) return true;
    }
    return false;
  };

  const installDirectSignin = () => {
    if (!settings.optimizeLoginPage) return;
    const added = new Map<Element, HTMLElement>();
    const stop = observeDom(() => {
      for (const [anchor, element] of added) {
        if (!anchor.isConnected || !element.isConnected || anchor.parentElement !== element.parentElement) { element.remove(); added.delete(anchor); }
      }
      const anchor = findSchoolSigninAnchor();
      if (!anchor || added.has(anchor)) return;
      const option = markOwned(document.createElement('div'));
      option.className = 'bn-login-option';
      const button = createButton('Sign in with Google');
      const explanation = document.createElement('small');
      explanation.textContent = 'Continue with your school Google account.';
      button.addEventListener('click', async () => {
        if (context.signal.aborted) return;
        button.disabled = true;
        try {
          // The school page already prepares a flow for native sign-in. Reuse
          // its ID so the direct button cannot create an ambiguous second flow.
          if (flow && flow.hostname === url.hostname) {
            flow = await createAuthFlow(url.hostname, flow.id);
            rememberTabFlow(flow.id);
          } else {
            flow = await newContext(url.hostname);
          }
          if (!context.signal.aborted) window.location.assign(blackbaudSigninUrl(url.hostname));
        } catch {
          button.disabled = false;
          explanation.textContent = 'Google sign-in could not start. Use the sign-in controls above.';
        }
      });
      option.append(button, explanation);
      anchor.insertAdjacentElement('afterend', option);
      added.set(anchor, option);
    }, signal);
    dispose.push(() => { stop(); for (const element of added.values()) element.remove(); });
  };

  const run = async () => {
    await waitForAuthClaim(page);
    if (signal.aborted) return;
    const contexts = await readAuthContexts();
    if (signal.aborted) return;
    const storedId = readTabFlowId();
    // Per-origin session storage survives returning to a provider later. An ID
    // for a completed or expired flow cannot block a fresh unambiguous sign-in.
    const rememberedId = contexts.some((candidate) => candidate.id === storedId) ? storedId : undefined;
    if (isSchoolPage(url)) {
      // A school login starts this tab's flow. A context from a different tab
      // must not be reused just because it happens to be the same school.
      flow = rememberedId ? selectAuthContext(contexts, { id: rememberedId, hostname: url.hostname }) : null;
      if (isLmsPage(url)) {
        // Clear only the flow belonging to this tab's original school page.
        if (flow && rememberedId) await removeAuthFlow(flow.id);
        return;
      }
      if (settings.automaticLogin && !flow) flow = await newContext(url.hostname);
      if (!signal.aborted) installDirectSignin();
      return;
    }

    if (!settings.automaticLogin) return;
    const school = isBlackbaudSignin(url) ? schoolFromSigninUrl(url) : null;
    if (isBlackbaudSignin(url) && hasSigninRedirect(url) && !school) return;
    const boundId = providerFlows.get(page);
    flow = boundId
      ? selectAuthContext(contexts, { id: boundId, ...(school ? { hostname: school } : {}) })
      : selectProviderAuthContext(contexts, { id: rememberedId, ...(school ? { hostname: school } : {}), step: isBlackbaudSignin(url) ? 'blackbaud' : 'google' });
    if (!flow && !boundId && school && !contexts.some((candidate) => candidate.hostname === school)) flow = await newContext(school);
    if (!flow || signal.aborted) return;
    // A provider document keeps one flow across settings changes and BFCache
    // mounts. Spent attempts cannot make this same chooser borrow a newer flow.
    if (!boundId) providerFlows.set(page, flow.id);
    if (flow.paused) return;
    rememberTabFlow(flow.id);

    if (isBlackbaudSignin(url)) {
      if (/\/signin\/error(?:\/|$)/i.test(url.pathname)) {
        showStatus('Sign-in needs your attention. Blackbaud’s sign-in controls remain available.');
        if (flow.recoveryAttempts === 0 && statusActions) {
          const retry = createButton('Retry sign-in');
          retry.addEventListener('click', async () => {
            if (signal.aborted || retry.disabled || !flow) return;
            retry.disabled = true;
            try {
              flow = await recoverAuthFlow(flow.id);
              if (!signal.aborted && flow) window.location.assign(blackbaudSigninUrl(flow.hostname));
            } catch {
              if (!signal.aborted) {
                retry.disabled = false;
                showStatus('Sign-in could not restart. Use Blackbaud’s sign-in controls.');
              }
            }
          });
          statusActions.prepend(retry);
        }
        return;
      }
      if (!canAttempt(flow, 'blackbaud')) return;
      showStatus('Continuing to Google sign-in…', true);
      const clicked = await readyAttempt('blackbaud', findBlackbaudGoogleButton);
      if (signal.aborted) return;
      if (!clicked) showStatus('Continue with Blackbaud’s sign-in controls.');
      return;
    }

    if (!isGoogleOAuth(url) || !canAttempt(flow, 'google')) return;
    const preference = accountPreferenceForSchool(flow.hostname, settings.accountPreference);
    if (!preference) { showStatus('Choose your Google account. Set a school account in extension settings to select it automatically.'); return; }
    showStatus('Looking for your school Google account…', true);
    const nodes = await waitForAccountChoices(signal, preference);
    if (signal.aborted) return;
    if (!nodes.length) { showStatus('Choose your Google account to continue.'); return; }
    const selected = uniqueMatchingAccount(nodes.map((node) => node.dataset.email ?? ''), preference);
    if (!selected) { showStatus('Choose your Google account to continue. Automatic selection needs one matching school account.'); return; }
    const clicked = await readyAttempt('google', () => findGoogleAccount(preference, selected));
    if (clicked) {
      showStatus('Signing in with your school account…', true);
    } else if (!signal.aborted) {
      showStatus('Choose your Google account to continue.');
    }
  };

  void run().catch(() => {
    if (!signal.aborted) showStatus('Continue with the sign-in controls on this page.');
  });
  return () => {
    controller.abort();
    context.signal.removeEventListener('abort', abort);
    for (const cleanup of dispose.reverse()) cleanup();
  };
}

export const loginFeature: Feature = {
  id: 'login',
  settingsKeys: ['automaticLogin', 'optimizeLoginPage', 'loadingOverlay', 'accountPreference'],
  enabled: (settings) => settings.automaticLogin || settings.optimizeLoginPage,
  matches: (url) => isSchoolPage(url) || isBlackbaudSignin(url) || isGoogleOAuth(url),
  mount: mountLogin,
};
