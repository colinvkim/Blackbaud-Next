import { isAssignmentCenter, isLmsPage, legacyAssignmentCenterUrl } from '../blackbaud/routes.ts';
import { createButton, observeDom, watchElements } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

const loadingMaskSelector = '.sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking';
const errorSelector = '.sky-error, .sky-error-page, .sky-error-title, .alert-danger';
export const ASSIGNMENT_STALL_DELAY = 15_000;
export const ASSIGNMENT_RECOVERY_COOLDOWN = 60_000;
const recoveryStorageKey = 'blackbaud-next-assignment-recovery';

function visible(element: Element): boolean {
  if (!element.isConnected || element.closest('[hidden]')) return false;
  let current: Element | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function hasVisibleError(): boolean {
  return [...document.querySelectorAll(errorSelector)].some(visible);
}

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
    return watchElements<HTMLElement>(loadingMaskSelector, (mask) => {
      let panel: HTMLDivElement | null = null;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;
      let reload: HTMLButtonElement | null = null;
      let dismiss: HTMLButtonElement | null = null;
      const isStalled = () => !disposed && !signal.aborted && window.location.href === url.href &&
        mask.matches(loadingMaskSelector) && visible(mask) && !hasVisibleError();
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
        panel = document.createElement('div');
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
