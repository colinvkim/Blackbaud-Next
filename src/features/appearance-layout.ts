import { appearanceObservationSelector, nativeAppearancePage, nativeAppearancePageKind, nativeModernAppearanceRoute, nativeProgressAppearance } from '../blackbaud/appearance.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { nativeAppearanceNavigation } from '../blackbaud/appearance-icons.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { observeDom, watchAddedElements } from '../shared/dom.ts';
import { createScope } from '../shared/scope.ts';
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
  mount: ({ url, signal: parentSignal }) => {
    if (parentSignal.aborted) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    let queued = false;
    let contentDirty = true;
    let shellDirty = true;
    const discovered = new Set<HTMLElement>();
    const rootScopes = new Map<HTMLElement, { content: boolean; shell: boolean }>();
    const observations = new Map<HTMLElement, Cleanup>();
    const labels = new Map<HTMLElement, MutationObserver>();
    const courseText = new Map<HTMLElement, MutationObserver>();
    const shellSemantics = new Map<HTMLElement, MutationObserver>();
    const markers = createAttributeOwnership();
    const navigationIcons = createNavigationIcons();
    const headerAppearance = createHeaderAppearance();
    const shellRoot = (element: HTMLElement) => element.tagName === 'APP-ROOT' ||
      ['site-header', 'site-nav-container', 'site-nav-lower', 'site-nav-bottom', 'site-top-spacer'].includes(element.id);
    const contentRoot = (element: HTMLElement) => element.id === 'site-main' ||
      ['SKY-TOOLBAR', 'SKY-REPEATER', 'SKY-REPEATER-ITEM'].includes(element.tagName);
    const queueUpdate = (content: boolean, shell: boolean) => {
      if (signal.aborted) return;
      contentDirty ||= content;
      shellDirty ||= shell;
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        update();
      });
    };
    const updateRoot = (root: HTMLElement) => {
      // A verified root may contain another observed scope. Keep that mixed
      // native hierarchy conservative without coupling ordinary sibling roots.
      let content = false;
      let shell = false;
      for (const element of discovered) {
        if (!root.contains(element)) continue;
        const previous = rootScopes.get(element);
        const current = { content: contentRoot(element), shell: shellRoot(element) };
        rootScopes.set(element, current);
        // Reused roots can change roles while still matching discovery. Clear
        // markers from their earlier role as well as validating the new one.
        content ||= current.content || previous?.content === true;
        shell ||= current.shell || previous?.shell === true;
      }
      queueUpdate(content, shell);
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
        const observer = new MutationObserver(() => queueUpdate(true, false));
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
        const observer = new MutationObserver(() => queueUpdate(false, true));
        observer.observe(element, { subtree: true, characterData: true, attributes: true,
          attributeFilter: ['alt', 'role', 'aria-label', 'aria-labelledby', 'aria-current', 'aria-controls', 'aria-haspopup', 'onclick', 'tabindex', 'iconname', 'contenteditable', 'type'] });
        shellSemantics.set(element, observer);
      }
      for (const [element, cleanup] of observations) {
        if (!roots.has(element)) { cleanup(); observations.delete(element); }
      }
      for (const root of roots) {
        if (observations.has(root)) continue;
        const stop = observeDom(() => updateRoot(root), signal, root);
        observations.set(root, stop);
      }
      if (!contentDirty) return;
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
            (target.parentElement?.parentElement === container && target.parentElement.classList.contains('row')))) queueUpdate(true, false);
        });
        observer.observe(container, { subtree: true, characterData: true });
        courseText.set(container, observer);
      }
    };
    const updateContent = (current: boolean) => {
      const context = current ? nativeAppearancePage(url) : null;
      const { rows, summary, courses } = nativeProgressAppearance(context, url);
      const currentRows = new Set(rows);
      markers.retain((element, attribute) => {
        switch (attribute) {
          case APPEARANCE_PAGE_ATTRIBUTE: return context?.element === element;
          case APPEARANCE_COURSE_ROW_ATTRIBUTE: return currentRows.has(element);
          case APPEARANCE_SHELL_ATTRIBUTE: return true;
          case APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE: return summary === element;
          case APPEARANCE_PROGRESS_COURSES_ATTRIBUTE: return courses === element;
          default: return false;
        }
      });
      if (context) markers.mark(context.element, APPEARANCE_PAGE_ATTRIBUTE, context.kind);
      for (const row of rows) markers.mark(row, APPEARANCE_COURSE_ROW_ATTRIBUTE, 'true');
      if (summary) markers.mark(summary, APPEARANCE_PROGRESS_SUMMARY_ATTRIBUTE, 'true');
      if (courses) markers.mark(courses, APPEARANCE_PROGRESS_COURSES_ATTRIBUTE, 'cards');
    };
    const updateShell = (current: boolean) => {
      const navigation = current ? nativeAppearanceNavigation(document, url) : { shell: null, icons: [] };
      const shell = navigation.shell ? document.documentElement : null;
      markers.retain((element, attribute) => attribute !== APPEARANCE_SHELL_ATTRIBUTE || element === shell);
      if (shell) markers.mark(shell, APPEARANCE_SHELL_ATTRIBUTE, navigation.shell!);
      navigationIcons.update(navigation.icons);
      const headerTargets = nativeHeaderAppearanceTargets(document, url, navigation);
      // The fixed stack changes as one unit: its verified spacer must reserve
      // room for every resized row. Otherwise retain the earlier native layout.
      headerAppearance.update(headerTargets.some(({ part }) => part === 'spacer') ? headerTargets : []);
    };
    const update = () => {
      if (signal.aborted || (!contentDirty && !shellDirty)) return;
      const current = window.location.href === url.href;
      if (!current) { contentDirty = true; shellDirty = true; }
      refreshObservations();
      const content = contentDirty;
      const shell = shellDirty;
      contentDirty = false;
      shellDirty = false;
      if (content) updateContent(current);
      if (shell) updateShell(current);
    };
    const navigationChanged = () => {
      contentDirty = true;
      shellDirty = true;
      update();
    };
    const stopRoots = watchAddedElements<HTMLElement>(appearanceObservationSelector(url), (root) => {
      const content = contentRoot(root);
      // Legacy shell identity depends on the unique #site-main as well as its
      // header/nav. Cache these scopes before a native ID change removes it.
      const shell = shellRoot(root) || root.id === 'site-main';
      discovered.add(root);
      rootScopes.set(root, { content, shell: shellRoot(root) });
      queueUpdate(content, shell);
      return () => {
        const previous = rootScopes.get(root);
        discovered.delete(root);
        rootScopes.delete(root);
        queueUpdate(content || previous?.content === true, shell || previous?.shell === true);
      };
    }, signal, document, ['id', 'class']);
    update();
    scope.listen(window, 'hashchange', navigationChanged);
    scope.listen(window, 'popstate', navigationChanged);
    scope.add(() => {
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
      rootScopes.clear();
      navigationIcons.clear();
      headerAppearance.clear();
      markers.clear();
    });
    return scope.dispose;
  },
};
