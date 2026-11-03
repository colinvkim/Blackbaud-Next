import { uniqueMatchingAccount } from './auth.ts';
import { isActionable } from '../shared/dom.ts';

const BLACKBAUD_GOOGLE_BUTTON = 'app-spa-auth-google-signin-button button, #google-continue-button';

export function findSchoolSigninAnchor(): Element | null {
  return document.querySelector('#nextBtn');
}

/** Only replace the observed first step; password, errors and new fields stay native. */
export function findSchoolLoginPage(): HTMLElement | null {
  for (const id of ['app', 'site-login', 'site-login-box', 'site-login-form', 'Username', 'nextBtn', 'divPassword', 'areaNext']) {
    if (document.querySelectorAll(`#${id}`).length !== 1) return null;
  }
  const root = document.querySelector<HTMLElement>('#app')!;
  const login = root.querySelector('#site-login > #site-login-box');
  const form = login?.querySelector<HTMLFormElement>('form#site-login-form');
  const username = form?.querySelector<HTMLInputElement>('#site-login-input input#Username');
  const next = form?.querySelector<HTMLInputElement>('#areaNext > input#nextBtn');
  const password = form?.querySelector<HTMLElement>('#divPassword');
  const view = document.defaultView;
  if (!login || !username || !['text', 'email'].includes(username.type) || !next || next.type !== 'submit' || next.disabled || !password || !view ||
    view.getComputedStyle(password).display !== 'none' || view.getComputedStyle(next.parentElement!).display === 'none') return null;
  const controls = [...root.querySelectorAll('input:not([type="hidden"]), button, select, textarea, a[href], iframe')]
    .filter((element) => !element.closest('[data-bn-owned]'));
  if (controls.some((element) => element.tagName !== 'INPUT' || !['Username', 'Password', 'remember', 'nextBtn', 'loginBtn', 'cancelBtn'].includes(element.id))) return null;
  if ([...login.querySelectorAll('#site-login-alert, #site-login-browser, [role="alert"]')].some((element) => element.textContent?.trim())) return null;
  return root;
}

export function findSchoolLoginBrand(root: HTMLElement): { source: string; background: string; alt: string } | null {
  const headers = root.querySelectorAll<HTMLElement>('#site-login-header');
  const logos = root.querySelectorAll<HTMLImageElement>('#site-login-logo > img#img-login-logo');
  if (headers.length !== 1 || logos.length !== 1 || !headers[0]!.contains(logos[0]!) || !logos[0]!.getAttribute('src')?.trim()) return null;
  try {
    const source = new URL(logos[0]!.getAttribute('src')!, root.ownerDocument.baseURI);
    if (source.protocol !== 'https:' || source.username || source.password) return null;
    const background = root.ownerDocument.defaultView?.getComputedStyle(headers[0]!).backgroundColor;
    return {
      source: source.href,
      background: background && !['transparent', 'rgba(0, 0, 0, 0)'].includes(background) ? background : '#152b43',
      alt: logos[0]!.alt.trim() || 'School logo',
    };
  } catch { return null; }
}

export function findAuthenticatedSchoolRoot(): HTMLElement | null {
  const roots = document.querySelectorAll<HTMLElement>('#site-main');
  const headers = document.querySelectorAll<HTMLElement>('#site-header');
  if (roots.length !== 1 || headers.length !== 1 || document.querySelectorAll('#account-nav').length !== 1 || document.querySelector('#site-login-form')) return null;
  const root = roots[0];
  const account = headers[0]?.querySelector<HTMLAnchorElement>('a#account-nav[href="#"]');
  return root && account && isActionable(root) && isActionable(account) ? root : null;
}

export function findBlackbaudGoogleButton(): HTMLButtonElement | null {
  const known = [...document.querySelectorAll<HTMLButtonElement>(BLACKBAUD_GOOGLE_BUTTON)];
  const labeled = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) => /^(?:continue|sign in) with google$/i.test(button.textContent?.trim().replace(/\s+/g, ' ') ?? ''));
  return [...known, ...labeled].find(isActionable) ?? null;
}

export function accountChoices(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-email]')];
}

export function findGoogleAccount(preference: string, intendedAccount: string): HTMLElement | null {
  const nodes = accountChoices();
  // Account choices can change while extension storage is being read or written.
  if (uniqueMatchingAccount(nodes.map((node) => node.dataset.email ?? ''), preference) !== intendedAccount) return null;
  return nodes.find((node) => node.dataset.email?.trim().toLowerCase() === intendedAccount && isActionable(node)) ?? null;
}
