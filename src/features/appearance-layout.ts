import { appearanceObservationSelector, nativeAppearancePage, nativeAppearancePageKind, nativeModernAppearanceRoute, nativeProgressAppearance } from '../blackbaud/appearance.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { nativeAppearanceNavigation } from '../blackbaud/appearance-icons.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { observeDom, watchAddedElements } from '../shared/dom.ts';
import type { Cleanup, Feature } from '../shared/types.ts';
import { createNavigationIcons } from './navigation-icons.ts';
import { nativeHeaderAppearanceTargets } from '../blackbaud/header-appearance.ts';
import { createHeaderAppearance } from './header-appearance.ts';

export const APPEARANCE_PAGE_ATTRIBUTE = 'data-bn-page';
export const APPEARANCE_COURSE_ROW_ATTRIBUTE = 'data-bn-course-row';
export const APPEARANCE_SHELL_ATTRIBUTE = 'data-bn-portal-shell';
export const APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE = 'data-bn-progress-summary';
export const APPEARANCE_PROGRESS_COURSES_ATTRIBUTE = 'data-bn-progress-courses';

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
    const courseText = new Map<HTMLElement, MutationObserver>();
    const shellSemantics = new Map<HTMLElement, MutationObserver>();
    const markers = createAttributeOwnership();
    const navigationIcons = createNavigationIcons();
    const headerAppearance = createHeaderAppearance();
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
        ['site-header', 'site-nav-container', 'site-nav-lower', 'site-nav-bottom', 'site-top-spacer'].includes(element.id));
      const navigationRoots = new Set(navigation.filter((element) =>
        !navigation.some((other) => other !== element && other.contains(element))));
      for (const [element, observer] of shellSemantics) {
        if (!navigationRoots.has(element)) { observer.disconnect(); shellSemantics.delete(element); }
      }
      for (const element of navigationRoots) {
        if (shellSemantics.has(element)) continue;
        // An original graphic can acquire an accessible name or interaction.
        // Revalidate navigation and its spacer, including native text updates.
        const observer = new MutationObserver(queueUpdate);
        observer.observe(element, { subtree: true, characterData: true, attributes: true,
          attributeFilter: ['alt', 'role', 'aria-label', 'aria-labelledby', 'aria-current', 'aria-controls', 'aria-haspopup', 'onclick', 'tabindex', 'iconname', 'contenteditable', 'type'] });
        shellSemantics.set(element, observer);
      }
      for (const [element, cleanup] of observations) {
        if (!roots.has(element)) { cleanup(); observations.delete(element); }
      }
      for (const root of roots) {
        if (observations.has(root)) continue;
        const stop = observeDom(queueUpdate, signal, root);
        observations.set(root, stop);
      }
      const courseContainers = new Set(nativeAppearancePageKind(url) === 'progress'
        ? [...discovered].filter((element) => element.isConnected && element.id === 'site-main')
          .flatMap((main) => [...main.querySelectorAll<HTMLElement>('#coursesContainer')]) : []);
      for (const [container, observer] of courseText) {
        if (!courseContainers.has(container)) { observer.disconnect(); courseText.delete(container); }
      }
      for (const container of courseContainers) {
        if (courseText.has(container)) continue;
        // A native loading message can replace whitespace without adding a node.
        // Only direct list/row text affects grid identity; grade text does not.
        const observer = new MutationObserver((records) => {
          if (records.some(({ target }) => target.parentNode === container ||
            (target.parentElement?.parentElement === container && target.parentElement.classList.contains('row')))) queueUpdate();
        });
        observer.observe(container, { subtree: true, characterData: true });
        courseText.set(container, observer);
      }
    };
    const update = () => {
      if (disposed || signal.aborted) return;
      refreshObservations();
      const current = window.location.href === url.href;
      const context = current ? nativeAppearancePage(url) : null;
      const navigation = current ? nativeAppearanceNavigation(document, url) : { shell: null, icons: [] };
      const shell = navigation.shell ? document.documentElement : null;
      const { rows, summary, courses } = nativeProgressAppearance(context, url);
      const currentRows = new Set(rows);
      markers.retain((element, attribute) => {
        switch (attribute) {
          case APPEARANCE_PAGE_ATTRIBUTE: return context?.element === element;
          case APPEARANCE_COURSE_ROW_ATTRIBUTE: return currentRows.has(element);
          case APPEARANCE_SHELL_ATTRIBUTE: return shell === element;
          case APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE: return summary === element;
          case APPEARANCE_PROGRESS_COURSES_ATTRIBUTE: return courses === element;
          default: return false;
        }
      });
      if (context) markers.mark(context.element, APPEARANCE_PAGE_ATTRIBUTE, context.kind);
      for (const row of rows) markers.mark(row, APPEARANCE_COURSE_ROW_ATTRIBUTE, 'true');
      if (summary) markers.mark(summary, APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE, 'true');
      if (courses) markers.mark(courses, APPEARANCE_PROGRESS_COURSES_ATTRIBUTE, 'cards');
      if (shell) markers.mark(shell, APPEARANCE_SHELL_ATTRIBUTE, navigation.shell!);
      navigationIcons.update(navigation.icons);
      const headerTargets = nativeHeaderAppearanceTargets(document, url, navigation);
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
      for (const observer of courseText.values()) observer.disconnect();
      courseText.clear();
      for (const observer of shellSemantics.values()) observer.disconnect();
      shellSemantics.clear();
      discovered.clear();
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      signal.removeEventListener('abort', cleanup);
      navigationIcons.clear();
      headerAppearance.clear();
      markers.clear();
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
