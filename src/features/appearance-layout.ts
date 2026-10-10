import { appearanceObservationSelector, nativeAppearancePage, nativeAppearancePageKind, nativeCourseRows, nativeLegacyAppearanceShell, nativeModernAppearanceRoute, nativeModernAppearanceShell, nativeProgressSummaryRow } from '../blackbaud/appearance.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { nativeNavigationIconTargets } from '../blackbaud/appearance-icons.ts';
import { observeDom, watchAddedElements } from '../shared/dom.ts';
import type { Cleanup, Feature } from '../shared/types.ts';
import { createNavigationIcons } from './navigation-icons.ts';
import { nativeHeaderAppearanceTargets } from '../blackbaud/header-appearance.ts';
import { createHeaderAppearance } from './header-appearance.ts';

export const APPEARANCE_PAGE_ATTRIBUTE = 'data-bn-page';
export const APPEARANCE_COURSE_ROW_ATTRIBUTE = 'data-bn-course-row';
export const APPEARANCE_SHELL_ATTRIBUTE = 'data-bn-portal-shell';
export const APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE = 'data-bn-progress-summary';

export const appearanceLayoutFeature: Feature = {
  id: 'appearance-layout',
  settingsKeys: [],
  enabled: (settings) => settings.pageAppearance,
  matches: (url) => nativeAppearancePageKind(url) !== null || nativeModernAppearanceRoute(url) !== null ||
    (isLmsPage(url) && !url.username && !url.password && /^\/app\/student\/?$/i.test(url.pathname)),
  mount: ({ url, signal }) => {
    if (signal.aborted) return;
    let disposed = false;
    let queued = false;
    const discovered = new Set<HTMLElement>();
    const observations = new Map<HTMLElement, Cleanup>();
    const labels = new Map<HTMLElement, MutationObserver>();
    const navigationSemantics = new Map<HTMLElement, MutationObserver>();
    const markers = new Map<HTMLElement, Map<string, string | null>>();
    const navigationIcons = createNavigationIcons();
    const headerAppearance = createHeaderAppearance();
    const restore = (element: HTMLElement, attribute: string) => {
      const attributes = markers.get(element);
      if (!attributes?.has(attribute)) return;
      const previous = attributes.get(attribute)!;
      if (previous === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, previous);
      attributes.delete(attribute);
      if (!attributes.size) markers.delete(element);
    };
    const mark = (element: HTMLElement, attribute: string, value: string) => {
      let attributes = markers.get(element);
      if (!attributes) {
        attributes = new Map();
        markers.set(element, attributes);
      }
      if (!attributes.has(attribute)) attributes.set(attribute, element.getAttribute(attribute));
      if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    };
    const queueUpdate = () => {
      if (disposed || signal.aborted || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        update();
      });
    };
    const refreshObservations = () => {
      // APP-ROOT establishes the modern app's identity/uniqueness; its page
      // contents are outside shell cosmetics and never need a subtree watcher.
      const candidates = new Set([...discovered].filter((element) => element.tagName !== 'APP-ROOT'));
      const roots = new Set<HTMLElement>();
      for (const element of candidates) {
        if (!element.isConnected) continue;
        let covered = false;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (candidates.has(parent)) { covered = true; break; }
        }
        if (!covered) roots.add(element);
      }
      for (const [element, observer] of labels) {
        if (!element.isConnected || !discovered.has(element)) { observer.disconnect(); labels.delete(element); }
      }
      for (const element of discovered) {
        if (!element.isConnected || element.tagName !== 'SKY-TOOLBAR' || labels.has(element)) continue;
        // The native search input's label identifies the assignment toolbar.
        // Watch that semantic attribute only within its small known scope.
        const observer = new MutationObserver(queueUpdate);
        observer.observe(element, { subtree: true, attributes: true, attributeFilter: ['aria-label'] });
        labels.set(element, observer);
      }
      const navigation = [...discovered].filter((element) => element.isConnected &&
        ['site-header', 'site-nav-container', 'site-nav-lower', 'site-nav-bottom'].includes(element.id));
      const navigationRoots = new Set(navigation.filter((element) =>
        !navigation.some((other) => other !== element && other.contains(element))));
      for (const [element, observer] of navigationSemantics) {
        if (!navigationRoots.has(element)) { observer.disconnect(); navigationSemantics.delete(element); }
      }
      for (const element of navigationRoots) {
        if (navigationSemantics.has(element)) continue;
        // An original graphic can acquire an accessible name or interaction.
        // Revalidate only navigation, including direct native text updates.
        const observer = new MutationObserver(queueUpdate);
        observer.observe(element, { subtree: true, characterData: true, attributes: true,
          attributeFilter: ['alt', 'role', 'aria-label', 'aria-controls', 'aria-haspopup', 'onclick', 'tabindex', 'iconname'] });
        navigationSemantics.set(element, observer);
      }
      for (const [element, cleanup] of observations) {
        if (!roots.has(element)) { cleanup(); observations.delete(element); }
      }
      for (const root of roots) {
        if (observations.has(root)) continue;
        const stop = observeDom(queueUpdate, signal, root);
        observations.set(root, stop);
      }
    };
    const update = () => {
      if (disposed || signal.aborted) return;
      refreshObservations();
      const current = window.location.href === url.href;
      const context = current ? nativeAppearancePage(url) : null;
      const legacyShell = current ? nativeLegacyAppearanceShell(url) : null;
      const modernShell = current ? nativeModernAppearanceShell(url) : null;
      const shell = legacyShell ?? modernShell;
      const rows = context?.kind === 'progress' ? nativeCourseRows(context.element, url) : [];
      const summary = context?.kind === 'progress' ? nativeProgressSummaryRow(context.element, url) : null;
      const currentRows = new Set(rows);
      for (const [element, attributes] of markers) {
        if (attributes.has(APPEARANCE_PAGE_ATTRIBUTE) && context?.element !== element) restore(element, APPEARANCE_PAGE_ATTRIBUTE);
        if (attributes.has(APPEARANCE_COURSE_ROW_ATTRIBUTE) && !currentRows.has(element)) restore(element, APPEARANCE_COURSE_ROW_ATTRIBUTE);
        if (attributes.has(APPEARANCE_SHELL_ATTRIBUTE) && shell !== element) restore(element, APPEARANCE_SHELL_ATTRIBUTE);
        if (attributes.has(APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE) && summary !== element) restore(element, APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE);
      }
      if (context) mark(context.element, APPEARANCE_PAGE_ATTRIBUTE, context.kind);
      for (const row of rows) mark(row, APPEARANCE_COURSE_ROW_ATTRIBUTE, 'true');
      if (summary) mark(summary, APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE, 'true');
      if (shell) mark(shell, APPEARANCE_SHELL_ATTRIBUTE, legacyShell ? 'legacy' : 'modern');
      navigationIcons.update(shell ? nativeNavigationIconTargets(document, url) : []);
      const headerTargets = shell ? nativeHeaderAppearanceTargets(document, url) : [];
      // The fixed stack changes as one unit: its verified spacer must reserve
      // room for every resized row. Otherwise retain the earlier native layout.
      headerAppearance.update(headerTargets.some(({ part }) => part === 'spacer') ? headerTargets : []);
    };
    const stopRoots = watchAddedElements<HTMLElement>(appearanceObservationSelector(url), (root) => {
      discovered.add(root);
      queueUpdate();
      return () => { discovered.delete(root); queueUpdate(); };
    }, signal, document, ['id', 'class']);
    update();
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    const cleanup: Cleanup = () => {
      if (disposed) return;
      disposed = true;
      stopRoots();
      for (const cleanup of observations.values()) cleanup();
      observations.clear();
      for (const observer of labels.values()) observer.disconnect();
      labels.clear();
      for (const observer of navigationSemantics.values()) observer.disconnect();
      navigationSemantics.clear();
      discovered.clear();
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      signal.removeEventListener('abort', cleanup);
      navigationIcons.clear();
      headerAppearance.clear();
      for (const [element, attributes] of markers) {
        for (const attribute of [...attributes.keys()]) restore(element, attribute);
      }
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
