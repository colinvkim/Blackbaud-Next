import { uniqueMatchingAccount } from './auth.ts';
import { isActionable } from '../shared/dom.ts';

const BLACKBAUD_GOOGLE_BUTTON = 'app-spa-auth-google-signin-button button, #google-continue-button';

export function findSchoolSigninAnchor(): Element | null {
  return document.querySelector('#nextBtn');
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
