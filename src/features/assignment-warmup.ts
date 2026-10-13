import { ASSIGNMENT_WARMUP_SOURCE_SELECTOR, assignmentWarmupConnection, assignmentWarmupDestination, assignmentWarmupDestinationKey, assignmentWarmupIntentLink, assignmentWarmupRules, canPrepareAssignmentCenter, isAssignmentWarmupPage, isAssignmentWarmupSource, supportsAssignmentWarmup } from '../blackbaud/assignment-warmup.ts';
import { isActionable, watchAddedElements } from '../shared/dom.ts';
import type { Cleanup, Feature } from '../shared/types.ts';

export const ASSIGNMENT_WARMUP_SETTLE_DELAY = 600;
export const ASSIGNMENT_WARMUP_LIFETIME = 30_000;

interface Source {
  schedule?: HTMLElement;
  link: HTMLAnchorElement;
  href: string;
  key: string;
}

export const assignmentWarmupFeature: Feature = {
  id: 'assignment-center-preparation',
  enabled: (settings) => settings.prepareAssignmentCenter && !settings.oldAssignmentCenter,
  settingsKeys: [],
  matches: isAssignmentWarmupPage,
  mount: ({ url, signal }) => {
    if (signal.aborted || !isAssignmentWarmupPage(url) || !supportsAssignmentWarmup()) return;
    const schedules = new Set<HTMLElement>();
    const links = new Set<HTMLAnchorElement>();
    const connection = assignmentWarmupConnection();
    let source: Source | null = null;
    let intentLink: HTMLAnchorElement | null = null;
    let intentObserver: MutationObserver | undefined;
    let intentAncestors: HTMLElement[] = [];
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let rule: HTMLScriptElement | null = null;
    let attempted = false;
    let terminal = false;
    let disposed = false;
    let stopDiscovery: Cleanup = () => {};

    const clearIntent = () => {
      intentObserver?.disconnect();
      intentObserver = undefined;
      intentAncestors = [];
      intentLink = null;
    };
    const removeListeners = () => {
      document.removeEventListener('visibilitychange', update);
      connection?.removeEventListener?.('change', update);
      document.removeEventListener('pointerover', prepareIntent);
      document.removeEventListener('focusin', prepareIntent);
      document.removeEventListener('pointerdown', prepareIntent);
    };

    const cancelPreparation = () => {
      clearTimeout(settleTimer);
      settleTimer = undefined;
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
      rule?.remove();
      rule = null;
    };
    const finishAttempt = () => {
      if (terminal) return;
      terminal = true;
      cancelPreparation();
      stopDiscovery();
      clearIntent();
      removeListeners();
    };
    const currentSource = (): Source | null => {
      if (intentLink) {
        const href = assignmentWarmupDestination(intentLink, url);
        return href ? { link: intentLink, href, key: assignmentWarmupDestinationKey(href) } : null;
      }
      if (schedules.size !== 1 || links.size !== 1) return null;
      const schedule = [...schedules][0]!;
      const link = [...links][0]!;
      const href = assignmentWarmupDestination(link, url);
      return href && schedule.isConnected && link.isConnected ? { schedule, link, href, key: assignmentWarmupDestinationKey(href) } : null;
    };
    const eligible = (candidate: Source | null): candidate is Source => candidate !== null &&
      !signal.aborted && window.location.href === url.href && canPrepareAssignmentCenter() &&
      (!candidate.schedule || isActionable(candidate.schedule)) && isActionable(candidate.link);
    const startPreparation = () => {
      settleTimer = undefined;
      if (disposed || terminal || attempted) return;
      const candidate = currentSource();
      if (!eligible(candidate) || !source || candidate.schedule !== source.schedule || candidate.link !== source.link || candidate.key !== source.key ||
        (candidate.schedule && candidate.href !== source.href) || !document.head) return;
      attempted = true;
      rule = document.createElement('script');
      rule.id = 'blackbaud-next-assignment-warmup';
      rule.type = 'speculationrules';
      rule.textContent = assignmentWarmupRules(candidate.href);
      document.head.append(rule);
      expiryTimer = setTimeout(finishAttempt, ASSIGNMENT_WARMUP_LIFETIME);
    };
    function update() {
      if (disposed || terminal || signal.aborted) return;
      const candidate = currentSource();
      const changed = candidate?.schedule !== source?.schedule || candidate?.key !== source?.key ||
        (candidate?.schedule && (candidate.link !== source?.link || candidate.href !== source?.href));
      if (changed) cancelPreparation();
      source = candidate;
      if (attempted) {
        if (changed || !eligible(candidate)) finishAttempt();
        else if (intentLink) observeIntent();
        return;
      }
      if (!eligible(candidate)) {
        cancelPreparation();
        clearIntent();
        return;
      }
      if (intentLink) observeIntent();
      if (settleTimer === undefined) settleTimer = setTimeout(startPreparation, candidate.schedule ? ASSIGNMENT_WARMUP_SETTLE_DELAY : 0);
    }

    function observeIntent() {
      if (!intentLink) return;
      const ancestors: HTMLElement[] = [];
      for (let element: HTMLElement | null = intentLink; element; element = element.parentElement) ancestors.push(element);
      if (ancestors.length === intentAncestors.length && ancestors.every((element, index) => element === intentAncestors[index])) return;
      intentObserver?.disconnect();
      intentAncestors = ancestors;
      intentObserver = new MutationObserver(update);
      for (const element of ancestors) {
        intentObserver.observe(element, {
          attributes: true, attributeFilter: ['href', 'class', 'hidden', 'style', 'aria-hidden', 'inert', 'disabled', 'aria-disabled'],
          // Direct ancestry changes revalidate moves/removals without watching
          // every descendant mutation in the native page.
          childList: true,
        });
      }
    }
    function prepareIntent(event: Event) {
      if (disposed || terminal || signal.aborted || (attempted && source?.schedule)) return;
      const link = assignmentWarmupIntentLink(event);
      const href = link && assignmentWarmupDestination(link, url);
      if (!link || !href || !isActionable(link) || window.location.href !== url.href || !canPrepareAssignmentCenter()) return;
      if (attempted && assignmentWarmupDestinationKey(href) !== source?.key) return;
      // Intent replaces pending Schedule settling, but never extends an active
      // rule's lifetime when moving between equivalent native anchors.
      if (!attempted) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      intentLink = link;
      observeIntent();
      update();
    }

    document.addEventListener('visibilitychange', update);
    connection?.addEventListener?.('change', update);
    document.addEventListener('pointerover', prepareIntent);
    document.addEventListener('focusin', prepareIntent);
    document.addEventListener('pointerdown', prepareIntent);
    if (isAssignmentWarmupSource(url)) stopDiscovery = watchAddedElements<HTMLElement>(ASSIGNMENT_WARMUP_SOURCE_SELECTOR, (element) => {
      if (terminal || disposed) return;
      if (element.id === 'accordionSchedules') schedules.add(element);
      else if (element.tagName === 'A') links.add(element as HTMLAnchorElement);
      const observer = new MutationObserver(update);
      observer.observe(element, { attributes: true, attributeFilter: ['href', 'class', 'hidden', 'style', 'aria-hidden', 'inert'] });
      // Native tiles/nav wrappers toggle visibility without replacing these
      // sources. Observe only their ancestor attributes, never descendants.
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        observer.observe(parent, { attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-hidden', 'inert'] });
      }
      update();
      return () => {
        observer.disconnect();
        schedules.delete(element);
        links.delete(element as HTMLAnchorElement);
        update();
      };
    }, signal, document, ['id']);
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelPreparation();
      stopDiscovery();
      clearIntent();
      removeListeners();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
