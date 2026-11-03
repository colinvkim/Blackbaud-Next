import { findSchoolLoginBrand, findSchoolLoginPage, findSchoolSigninAnchor } from '../blackbaud/auth-dom.ts';
import { blackbaudSigninUrl } from '../blackbaud/routes.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createButton, markOwned, observeDom, observeElementContext } from '../shared/dom.ts';
import { createScope } from '../shared/scope.ts';
import type { Cleanup } from '../shared/types.ts';

const styles = `
[data-bn-login-native="true"] { display: none !important; }
body:has(> #blackbaud-next-login) > .progress.skylo { visibility: hidden; }
#blackbaud-next-login { position: fixed; inset: 0; z-index: 10000; box-sizing: border-box; display: grid; overflow: auto; overscroll-behavior: contain; background: var(--bn-page); color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
#blackbaud-next-login * { box-sizing: border-box; }
#blackbaud-next-login .bn-signin-layout { width: min(100%, 440px); margin: auto; padding: 32px 16px; }
#blackbaud-next-login .bn-signin-card { border: 1px solid var(--bn-border); border-radius: var(--bn-radius); background: var(--bn-surface); box-shadow: var(--bn-shadow); }
#blackbaud-next-login .bn-signin-school-brand { display: grid; place-items: center; min-height: 68px; padding: 16px 24px; border-radius: var(--bn-radius) var(--bn-radius) 0 0; }
#blackbaud-next-login .bn-signin-school-brand[hidden] { display: none; }
#blackbaud-next-login .bn-signin-school-brand img { display: block; width: auto; height: auto; max-width: 100%; max-height: 36px; object-fit: contain; }
#blackbaud-next-login .bn-signin-content { padding: 24px; }
#blackbaud-next-login .bn-signin-button { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--bn-accent); border-radius: 6px; background: var(--bn-accent); color: #fff; font: 500 14px/1.4 var(--bn-font); cursor: pointer; box-shadow: none; }
#blackbaud-next-login .bn-signin-button:hover:not(:disabled) { background: var(--bn-accent-hover); border-color: var(--bn-accent-hover); color: #fff; }
#blackbaud-next-login .bn-signin-button:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
#blackbaud-next-login .bn-signin-button:disabled { opacity: .7; cursor: wait; }
@media (forced-colors: active) {
  #blackbaud-next-login { background: Canvas; }
  #blackbaud-next-login .bn-signin-card { border-color: CanvasText; box-shadow: none; }
  #blackbaud-next-login .bn-signin-button:focus-visible { outline-color: Highlight; }
}
`;

interface SigninView {
  element: HTMLElement;
  anchor: Element;
  native: HTMLElement | null;
  updateBrand: () => void;
  dispose: Cleanup;
}

export function mountSchoolSignin(url: URL, signal: AbortSignal, prepare: () => Promise<void>): Cleanup {
  const scope = createScope(signal);
  const markers = createAttributeOwnership();
  const failed = new WeakSet<HTMLElement>();
  let current: SigninView | null = null;
  let observed: HTMLElement | null = null;
  let stopNative: Cleanup = () => {};
  let failedMessage = '';
  scope.style('login-page', styles);
  const remove = () => {
    const focused = current?.element.contains(document.activeElement);
    current?.dispose();
    current?.element.remove();
    current = null;
    markers.clear();
    if (focused) document.querySelector<HTMLInputElement>('#Username')?.focus({ preventScroll: true });
  };
  const create = (anchor: Element, native: HTMLElement | null): SigninView => {
    const viewScope = createScope(scope.signal);
    const element = markOwned(document.createElement(native ? 'main' : 'div'));
    const button = createButton('Sign in with Google');
    const explanation = document.createElement('small');
    explanation.setAttribute('role', 'status');
    explanation.textContent = failedMessage;
    let updateBrand = () => {};
    if (native) {
      element.id = 'blackbaud-next-login';
      const name = document.title.trim();
      element.setAttribute('aria-label', name && name.length <= 120 ? `${name} sign-in` : 'School sign-in');
      const layout = document.createElement('div');
      layout.className = 'bn-signin-layout';
      const card = document.createElement('section');
      card.className = 'bn-signin-card';
      const schoolBrand = document.createElement('div');
      schoolBrand.className = 'bn-signin-school-brand';
      schoolBrand.hidden = true;
      const schoolLogo = document.createElement('img');
      schoolBrand.append(schoolLogo);
      let failedSource = '';
      viewScope.listen(schoolLogo, 'error', () => {
        failedSource = schoolLogo.src;
        schoolBrand.hidden = true;
      });
      updateBrand = () => {
        const nativeBrand = findSchoolLoginBrand(native);
        if (!nativeBrand) { schoolBrand.hidden = true; schoolLogo.removeAttribute('src'); return; }
        schoolBrand.style.backgroundColor = nativeBrand.background;
        schoolLogo.alt = nativeBrand.alt;
        if (schoolLogo.getAttribute('src') !== nativeBrand.source) {
          failedSource = '';
          schoolLogo.src = nativeBrand.source;
        }
        schoolBrand.hidden = nativeBrand.source === failedSource;
      };
      const content = document.createElement('div');
      content.className = 'bn-signin-content';
      button.className = 'bn-button bn-signin-button';
      content.append(button);
      card.append(schoolBrand, content);
      layout.append(card);
      element.append(layout);
      document.body.append(element);
      markers.mark(native, 'data-bn-login-native', 'true');
      markers.mark(native, 'inert', '');
      markers.mark(native, 'aria-hidden', 'true');
      if (native.contains(document.activeElement)) button.focus({ preventScroll: true });
    } else {
      element.className = 'bn-login-option';
      element.append(button);
      if (failedMessage) element.append(explanation);
      anchor.insertAdjacentElement('afterend', element);
    }
    const view = { element, anchor, native, updateBrand, dispose: viewScope.dispose };
    viewScope.listen(button, 'click', async () => {
      if (scope.signal.aborted || current !== view || button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await prepare();
        const valid = native ? findSchoolLoginPage() === native : findSchoolSigninAnchor() === anchor;
        if (!viewScope.signal.aborted && current === view && valid && element.isConnected && window.location.href === url.href) {
          window.location.assign(blackbaudSigninUrl(url.hostname));
        }
      } catch {
        if (scope.signal.aborted || current !== view) return;
        failedMessage = 'Sign-in could not start. Try again or use the school sign-in form.';
        if (native) { failed.add(native); remove(); update(); }
        else {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          explanation.textContent = failedMessage;
          if (!explanation.isConnected) element.append(explanation);
        }
      }
    });
    return view;
  };
  const update = () => {
    if (scope.signal.aborted) return;
    const anchor = findSchoolSigninAnchor();
    const login = anchor?.closest<HTMLElement>('#site-login') ?? null;
    if (observed !== login) {
      stopNative();
      observed = login;
      // Native bindings can update an error text node without replacing it.
      stopNative = login ? observeElementContext(login, update, { subtree: true }) : () => {};
    }
    const found = findSchoolLoginPage();
    const native = found && !failed.has(found) ? found : null;
    if (current && (current.anchor !== anchor || current.native !== native || !current.element.isConnected ||
      (native ? current.element.parentElement !== document.body : current.element.parentElement !== anchor?.parentElement))) remove();
    if (!current && anchor) current = create(anchor, native);
    current?.updateBrand();
  };
  scope.add(() => stopNative());
  scope.add(remove);
  scope.add(observeDom(update, scope.signal));
  return scope.dispose;
}
