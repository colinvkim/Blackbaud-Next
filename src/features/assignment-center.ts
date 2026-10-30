import { isAssignmentCenter, isLmsPage, legacyAssignmentCenterUrl } from '../blackbaud/routes.ts';
import { ASSIGNMENT_LOADING_MASK_SELECTOR, hasVisibleAssignmentError, isAssignmentLoadingVisible } from '../blackbaud/assignment-loading.ts';
import { ASSIGNMENT_DETAILS_SELECTOR, assignmentBreadcrumbLinks, assignmentCenterUrl, isAssignmentDetail, isNativeAssignmentBackLink } from '../blackbaud/assignment-navigation.ts';
import { markOwned, createButton, observeDom, watchAddedElements, watchElements } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

export const ASSIGNMENT_STALL_DELAY = 15_000;
export const ASSIGNMENT_RECOVERY_COOLDOWN = 60_000;
const recoveryStorageKey = 'blackbaud-next-assignment-recovery';

export const assignmentBreadcrumbFeature: Feature = {
  id: 'assignment-breadcrumb',
  settingsKeys: ['oldAssignmentCenter'],
  enabled: () => true,
  matches: isAssignmentDetail,
  mount: ({ url, settings, signal }) => {
    const destination = settings.oldAssignmentCenter ? legacyAssignmentCenterUrl(url) : assignmentCenterUrl(url);
    return watchAddedElements<HTMLElement>(ASSIGNMENT_DETAILS_SELECTOR, (root) => {
      const nativeHrefs = new Map<HTMLAnchorElement, string>();
      let disposed = false;
      const restoreLink = (link: HTMLAnchorElement) => {
        const nativeHref = nativeHrefs.get(link);
        if (nativeHref !== undefined && link.getAttribute('href') === destination) link.setAttribute('href', nativeHref);
        nativeHrefs.delete(link);
      };
      const update = () => {
        if (disposed || signal.aborted || window.location.href !== url.href) return;
        const currentLinks = new Set(assignmentBreadcrumbLinks(root));
        for (const link of nativeHrefs.keys()) {
          if (!currentLinks.has(link) || !root.contains(link)) restoreLink(link);
        }
        for (const link of currentLinks) {
          // The native action is a javascript: href, so a real link fixes Back
          // without intercepting clicks or changing keyboard/new-tab behavior.
          if (isNativeAssignmentBackLink(link)) {
            nativeHrefs.set(link, link.getAttribute('href')!);
            link.setAttribute('href', destination);
          } else if (link.getAttribute('href') !== destination) {
            // A native rerender may give this control a different purpose.
            nativeHrefs.delete(link);
          }
        }
      };
      const textObserver = new MutationObserver(update);
      textObserver.observe(root, { subtree: true, characterData: true });
      const stop = observeDom(update, signal, root);
      return () => {
        disposed = true;
        stop();
        textObserver.disconnect();
        for (const link of nativeHrefs.keys()) restoreLink(link);
      };
    }, signal, document, []);
  },
};

export function recoveryRemaining(storage: Pick<Storage, 'getItem'>, route: string, now: number): number {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(recoveryStorageKey) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return 0;
    const record = parsed as Record<string, unknown>;
    if (record.route !== route || typeof record.time !== 'number' || !Number.isFinite(record.time)) return 0;
    const elapsed = now - record.time;
    // Discard clock changes instead of leaving the control disabled forever.
    return elapsed >= 0 && elapsed < ASSIGNMENT_RECOVERY_COOLDOWN ? ASSIGNMENT_RECOVERY_COOLDOWN - elapsed : 0;
  } catch {
    return 0;
  }
}

export const oldAssignmentCenterFeature: Feature = {
  id: 'legacy-assignment-center',
  settingsKeys: [],
  enabled: (settings) => settings.oldAssignmentCenter,
  matches: isLmsPage,
  mount: ({ url, signal }) => {
    const destination = legacyAssignmentCenterUrl(url);
    if (isAssignmentCenter(url)) {
      // This is an explicit compatibility preference. replace avoids a Back
      // entry that would immediately redirect to the same destination again.
      window.location.replace(destination);
      return;
    }
    return watchElements<HTMLElement>('#assignment-center-btn', (button) => {
      const originalHref = button.getAttribute('href');
      button.setAttribute('href', destination);
      const redirect = (event: MouseEvent) => {
        if (signal.aborted || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.location.assign(destination);
      };
      button.addEventListener('click', redirect, true);
      return () => {
        button.removeEventListener('click', redirect, true);
        if (button.getAttribute('href') === destination) {
          if (originalHref === null) button.removeAttribute('href');
          else button.setAttribute('href', originalHref);
        }
      };
    }, signal);
  },
};

export const assignmentRecoveryFeature: Feature = {
  id: 'assignment-loading-recovery',
  settingsKeys: [],
  enabled: (settings) => settings.fixInvalidPages && !settings.oldAssignmentCenter,
  matches: isAssignmentCenter,
  mount: ({ url, signal }) => {
    let offered = false;
    return watchElements<HTMLElement>(ASSIGNMENT_LOADING_MASK_SELECTOR, (mask) => {
      let panel: HTMLDivElement | null = null;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;
      let reload: HTMLButtonElement | null = null;
      let dismiss: HTMLButtonElement | null = null;
      const isStalled = () => !disposed && !signal.aborted && window.location.href === url.href &&
        mask.matches(ASSIGNMENT_LOADING_MASK_SELECTOR) && isAssignmentLoadingVisible(mask) && !hasVisibleAssignmentError(mask.ownerDocument);
      const readRemaining = () => {
        try { return recoveryRemaining(window.sessionStorage, url.pathname, Date.now()); } catch { return 0; }
      };
      const recover = () => {
        if (!isStalled() || readRemaining() > 0) return;
        try {
          window.sessionStorage.setItem(recoveryStorageKey, JSON.stringify({ route: url.pathname, time: Date.now() }));
        } catch {
          // Storage may be blocked. Recovery is still user initiated.
        }
        if (reload) reload.disabled = true;
        window.location.reload();
      };
      const hide = () => { panel?.remove(); panel = null; };
      const offerRecovery = () => {
        stallTimer = undefined;
        if (offered || !isStalled()) return;
        offered = true;
        panel = markOwned(document.createElement('div'));
        panel.className = 'bn-recovery';
        panel.setAttribute('role', 'status');
        // The native full-page loading mask must not cover the recovery action.
        Object.assign(panel.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647' });
        const message = document.createElement('p');
        message.textContent = 'Assignments are taking longer than usual to load.';
        reload = createButton('Reload assignments');
        dismiss = createButton('Keep waiting');
        reload.addEventListener('click', recover);
        dismiss.addEventListener('click', hide);
        panel.append(message, reload, dismiss);
        (document.body ?? document.documentElement).append(panel);
        const remaining = readRemaining();
        if (remaining > 0) {
          reload.disabled = true;
          reload.textContent = 'Recently reloaded';
          cooldownTimer = setTimeout(() => {
            if (reload && isStalled()) {
              reload.disabled = false;
              reload.textContent = 'Reload assignments';
            }
          }, remaining);
        }
      };
      const update = () => {
        if (!isStalled()) {
          clearTimeout(stallTimer);
          stallTimer = undefined;
          clearTimeout(cooldownTimer);
          hide();
        } else if (!offered && stallTimer === undefined) {
          stallTimer = setTimeout(offerRecovery, ASSIGNMENT_STALL_DELAY);
        }
      };
      const visibilityObserver = new MutationObserver(update);
      visibilityObserver.observe(mask, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      const stop = observeDom(update, signal);
      return () => {
        disposed = true;
        stop();
        visibilityObserver.disconnect();
        clearTimeout(stallTimer);
        clearTimeout(cooldownTimer);
        reload?.removeEventListener('click', recover);
        dismiss?.removeEventListener('click', hide);
        hide();
      };
    }, signal);
  },
};
