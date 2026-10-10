import { ASSIGNMENT_WARMUP_SOURCE_SELECTOR, assignmentWarmupDestination, assignmentWarmupRules, canPrepareAssignmentCenter, isAssignmentWarmupSource, supportsAssignmentWarmup } from '../blackbaud/assignment-warmup.ts';
import { isActionable, watchAddedElements } from '../shared/dom.ts';
import type { Cleanup, Feature } from '../shared/types.ts';

export const ASSIGNMENT_WARMUP_SETTLE_DELAY = 600;
export const ASSIGNMENT_WARMUP_LIFETIME = 30_000;

interface Source {
  schedule: HTMLElement;
  link: HTMLAnchorElement;
  href: string;
}

export const assignmentWarmupFeature: Feature = {
  id: 'assignment-center-preparation',
  enabled: (settings) => settings.prepareAssignmentCenter && !settings.oldAssignmentCenter,
  settingsKeys: [],
  matches: isAssignmentWarmupSource,
  mount: ({ url, signal }) => {
    if (signal.aborted || !isAssignmentWarmupSource(url) || !supportsAssignmentWarmup()) return;
    const schedules = new Set<HTMLElement>();
    const links = new Set<HTMLAnchorElement>();
    let source: Source | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let rule: HTMLScriptElement | null = null;
    let attempted = false;
    let terminal = false;
    let disposed = false;
    let stopDiscovery: Cleanup = () => {};

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
      document.removeEventListener('visibilitychange', update);
    };
    const currentSource = (): Source | null => {
      if (schedules.size !== 1 || links.size !== 1) return null;
      const schedule = [...schedules][0]!;
      const link = [...links][0]!;
      const href = assignmentWarmupDestination(link, url);
      return href && schedule.isConnected && link.isConnected ? { schedule, link, href } : null;
    };
    const eligible = (candidate: Source | null): candidate is Source => candidate !== null &&
      !signal.aborted && window.location.href === url.href && canPrepareAssignmentCenter() &&
      isActionable(candidate.schedule) && isActionable(candidate.link);
    const startPreparation = () => {
      settleTimer = undefined;
      if (disposed || terminal || attempted) return;
      const candidate = currentSource();
      if (!eligible(candidate) || !source || candidate.schedule !== source.schedule || candidate.link !== source.link || candidate.href !== source.href || !document.head) return;
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
      const changed = candidate?.schedule !== source?.schedule || candidate?.link !== source?.link || candidate?.href !== source?.href;
      if (changed) cancelPreparation();
      source = candidate;
      if (attempted) {
        if (changed || !eligible(candidate)) finishAttempt();
        return;
      }
      if (!eligible(candidate)) {
        cancelPreparation();
        return;
      }
      if (settleTimer === undefined) settleTimer = setTimeout(startPreparation, ASSIGNMENT_WARMUP_SETTLE_DELAY);
    }

    document.addEventListener('visibilitychange', update);
    stopDiscovery = watchAddedElements<HTMLElement>(ASSIGNMENT_WARMUP_SOURCE_SELECTOR, (element) => {
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
      document.removeEventListener('visibilitychange', update);
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
