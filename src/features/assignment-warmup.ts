import { ASSIGNMENT_WARMUP_SOURCE_SELECTOR, assignmentWarmupConnection, assignmentWarmupDestination, assignmentWarmupDestinationKey, assignmentWarmupIntentLink, assignmentWarmupRules, canPrepareAssignmentCenter, isAssignmentWarmupPage, isAssignmentWarmupSource, supportsAssignmentWarmup } from '../blackbaud/assignment-warmup.ts';
import { isActionable, markOwned, observeElementContext, watchAddedElements } from '../shared/dom.ts';
import { createScope } from '../shared/scope.ts';
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
  mount: ({ url, signal: parentSignal }) => {
    if (parentSignal.aborted || !isAssignmentWarmupPage(url) || !supportsAssignmentWarmup()) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    const listeners = createScope(signal);
    const schedules = new Set<HTMLElement>();
    const links = new Set<HTMLAnchorElement>();
    const connection = assignmentWarmupConnection();
    let source: Source | null = null;
    let intentLink: HTMLAnchorElement | null = null;
    let stopIntent: Cleanup = () => {};
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let rule: HTMLScriptElement | null = null;
    let attempted = false;
    let terminal = false;
    let stopDiscovery: Cleanup = () => {};

    const clearIntent = () => {
      stopIntent();
      stopIntent = () => {};
      intentLink = null;
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
      listeners.dispose();
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
      if (signal.aborted || terminal || attempted) return;
      const candidate = currentSource();
      if (!eligible(candidate) || !source || candidate.schedule !== source.schedule || candidate.link !== source.link || candidate.key !== source.key ||
        (candidate.schedule && candidate.href !== source.href) || !document.head) return;
      attempted = true;
      rule = markOwned(document.createElement('script'));
      rule.id = 'blackbaud-next-assignment-warmup';
      rule.type = 'speculationrules';
      rule.textContent = assignmentWarmupRules(candidate.href);
      document.head.append(rule);
      expiryTimer = setTimeout(finishAttempt, ASSIGNMENT_WARMUP_LIFETIME);
    };
    function update() {
      if (terminal || signal.aborted) return;
      const candidate = currentSource();
      const changed = candidate?.schedule !== source?.schedule || candidate?.key !== source?.key ||
        (candidate?.schedule && (candidate.link !== source?.link || candidate.href !== source?.href));
      if (changed) cancelPreparation();
      source = candidate;
      if (attempted) {
        if (changed || !eligible(candidate)) finishAttempt();
        return;
      }
      if (!eligible(candidate)) {
        cancelPreparation();
        clearIntent();
        return;
      }
      if (settleTimer === undefined) settleTimer = setTimeout(startPreparation, candidate.schedule ? ASSIGNMENT_WARMUP_SETTLE_DELAY : 0);
    }

    function prepareIntent(event: Event) {
      if (terminal || signal.aborted || (attempted && source?.schedule)) return;
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
      if (intentLink !== link) {
        clearIntent();
        intentLink = link;
        stopIntent = observeElementContext(link, update);
      }
      update();
    }

    listeners.listen(document, 'visibilitychange', update);
    connection?.addEventListener?.('change', update);
    listeners.add(() => connection?.removeEventListener?.('change', update));
    listeners.listen(document, 'pointerover', prepareIntent);
    listeners.listen(document, 'focusin', prepareIntent);
    listeners.listen(document, 'pointerdown', prepareIntent);
    if (isAssignmentWarmupSource(url)) stopDiscovery = watchAddedElements<HTMLElement>(ASSIGNMENT_WARMUP_SOURCE_SELECTOR, (element) => {
      if (terminal || signal.aborted) return;
      if (element.id === 'accordionSchedules') schedules.add(element);
      else if (element.tagName === 'A') links.add(element as HTMLAnchorElement);
      const stopWatching = observeElementContext(element, update);
      update();
      return () => {
        stopWatching();
        schedules.delete(element);
        links.delete(element as HTMLAnchorElement);
        update();
      };
    }, signal, document, ['id']);
    scope.add(() => {
      cancelPreparation();
      stopDiscovery();
      clearIntent();
    });
    return scope.dispose;
  },
};
