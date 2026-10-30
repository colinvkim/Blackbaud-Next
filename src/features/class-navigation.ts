import { classDestinationForSection, classSearchTerms, NATIVE_CLASS_CONTROL_SELECTOR, NATIVE_CLASS_NAVIGATION_SELECTOR, NATIVE_CLASSES_MENU_SELECTOR, nativeClassMenuItems, nativeClassRowVisible, nativeClassSearchReference, normalizeClassSearch } from '../blackbaud/class-navigation.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createButton, markOwned, observeDom, observeElementContext, watchAddedElements, watchElements } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import { createScope } from '../shared/scope.ts';
import type { Cleanup, Feature } from '../shared/types.ts';

const hiddenAttribute = 'data-blackbaud-next-class-hidden';
const menuAttribute = 'data-blackbaud-next-class-menu';
const styles = `
[${menuAttribute}] .bn-class-search { display: flex; flex-wrap: wrap; align-items: center; clear: both; box-sizing: border-box; width: 100%; gap: 8px; padding: 12px; border-bottom: 1px solid var(--bn-border); background: var(--bn-surface); color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-class-search label { margin: 0; color: var(--bn-text); font-size: 13px; font-weight: 600; }
.bn-class-search input { box-sizing: border-box; min-height: 36px; flex: 1 1 160px; min-width: 0; padding: 6px 10px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); background: var(--bn-surface); color: var(--bn-text); font: inherit; }
.bn-class-search input:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
.bn-class-search [hidden] { display: none !important; }
[${menuAttribute}] li[${hiddenAttribute}] { display: none !important; }
.bn-class-search .bn-tool-status { flex-basis: 100%; color: var(--bn-muted); }
@media (max-width: 480px), (pointer: coarse) { .bn-class-search input { min-height: 44px; } }
`;
let searchNumber = 0;

interface LinkState {
  nativeHref: string;
  appliedHref: string;
}

export const classNavigationFeature: Feature = {
  id: 'class-navigation',
  enabled: (settings) => settings.classSwitching,
  settingsKeys: [],
  matches: isLmsPage,
  mount: ({ url, signal }) => {
    if (signal.aborted) return;
    const scope = createScope(signal);
    scope.style('class-navigation', styles);
    let query = '';
    const searches = new Set<() => void>();
    const updateSearches = () => { for (const updateSearch of searches) updateSearch(); };
    const mountMenu = (menu: HTMLElement): Cleanup => {
      const menuScope = createScope(scope.signal);
      const ownership = createAttributeOwnership();
      menuScope.add(ownership.clear);
      ownership.mark(menu, menuAttribute, '');
      const toolbar = markOwned(document.createElement('div'));
      menuScope.add(() => toolbar.remove());
      toolbar.className = 'bn-class-search';
      toolbar.setAttribute('role', 'search');
      toolbar.setAttribute('aria-label', 'Classes');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.id = `blackbaud-next-class-search-${++searchNumber}`;
      input.type = 'search';
      input.autocomplete = 'off';
      input.placeholder = 'Class name';
      input.value = query;
      label.htmlFor = input.id;
      label.textContent = 'Search classes';
      label.className = 'bn-icon-label';
      label.prepend(createIcon('search'));
      const clear = createButton('Clear', 'x');
      const status = document.createElement('span');
      status.className = 'bn-tool-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      toolbar.append(label, input, clear, status);
      const insertToolbar = () => {
        const reference = nativeClassSearchReference(menu);
        if (reference) reference.after(toolbar);
        else menu.prepend(toolbar);
      };
      insertToolbar();
      const links = new Map<HTMLAnchorElement, LinkState>();
      const restoreLink = (link: HTMLAnchorElement, state: LinkState) => {
        if (link.getAttribute('href') === state.appliedHref && state.appliedHref !== state.nativeHref) link.setAttribute('href', state.nativeHref);
      };
      const update = () => {
        if (menuScope.signal.aborted || !menu.isConnected) return;
        if (toolbar.parentElement !== menu) insertToolbar();
        if (input.value !== query) input.value = query;
        const items = nativeClassMenuItems(menu, url);
        const currentLinks = new Set(items.map((item) => item.link));
        const currentRows = new Set(items.map((item) => item.row));
        for (const [link, state] of links) {
          if (!currentLinks.has(link)) {
            restoreLink(link, state);
            links.delete(link);
          }
        }
        ownership.retain((element, attribute) => attribute === menuAttribute || currentRows.has(element));
        const terms = classSearchTerms(query);
        let total = 0;
        let matches = 0;
        for (const { row, link, name } of items) {
          const currentHref = link.getAttribute('href')!;
          let state = links.get(link);
          if (!state) {
            state = { nativeHref: currentHref, appliedHref: currentHref };
            links.set(link, state);
          } else if (currentHref !== state.appliedHref) state.nativeHref = currentHref;
          const destination = classDestinationForSection(state.nativeHref, url) ?? state.nativeHref;
          state.appliedHref = destination;
          if (link.getAttribute('href') !== destination) link.setAttribute('href', destination);
          ownership.restore(row, hiddenAttribute);
          const available = nativeClassRowVisible(row, menu);
          const matching = terms.every((term) => normalizeClassSearch(name).includes(term));
          if (available) {
            total += 1;
            if (matching) matches += 1;
          }
          if (terms.length && available && !matching) {
            ownership.mark(row, hiddenAttribute, '');
          }
        }
        const hideClear = !query;
        if (clear.hidden !== hideClear) clear.hidden = hideClear;
        const message = terms.length ? matches ? `${matches} of ${total} classes` : `No classes match your search (0 of ${total}).` : `${total} ${total === 1 ? 'class' : 'classes'}`;
        if (status.textContent !== message) status.textContent = message;
      };
      menuScope.add(observeElementContext(menu, update, { subtree: true }));
      const searchInput = () => { query = input.value; updateSearches(); };
      const clearSearch = () => { query = ''; updateSearches(); input.focus(); };
      const stopNativeMenuClose = (event: Event) => { event.stopPropagation(); };
      const preventSubmit = (event: KeyboardEvent) => {
        if (event.key === 'Enter') event.preventDefault();
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      };
      menuScope.listen(input, 'input', searchInput);
      menuScope.listen(input, 'keydown', preventSubmit);
      menuScope.listen(clear, 'click', clearSearch);
      menuScope.listen(toolbar, 'click', stopNativeMenuClose);
      searches.add(update);
      update();
      menuScope.add(() => {
        searches.delete(update);
        for (const [link, state] of links) restoreLink(link, state);
        links.clear();
      });
      return menuScope.dispose;
    };
    // Native desktop and mobile shells are separate. Share ownership if an
    // unexpected nested shell exposes the same menu to both scoped watchers.
    const menus = new Map<HTMLElement, { references: number; cleanup: Cleanup }>();
    const retainMenu = (menu: HTMLElement): Cleanup => {
      let state = menus.get(menu);
      if (!state) {
        state = { references: 0, cleanup: mountMenu(menu) };
        menus.set(menu, state);
      }
      state.references++;
      return () => {
        if (--state.references) return;
        state.cleanup();
        menus.delete(menu);
      };
    };
    scope.add(watchAddedElements<HTMLElement>(NATIVE_CLASS_NAVIGATION_SELECTOR, (navigation) => {
      const navigationScope = createScope(scope.signal);
      navigationScope.add(watchElements(NATIVE_CLASSES_MENU_SELECTOR, retainMenu, navigationScope.signal, navigation));
      // Validation also depends on the controlling anchor and its ancestors,
      // outside the menu itself. These small shells capture their mutations.
      navigationScope.add(observeDom(updateSearches, navigationScope.signal, navigation));
      return () => {
        navigationScope.dispose();
        updateSearches();
      };
    }, scope.signal, document, ['id']));
    // Modern rows require one unambiguous desktop control. A duplicate added
    // outside navigation must invalidate existing rows without a page scan.
    scope.add(watchAddedElements(NATIVE_CLASS_CONTROL_SELECTOR, () => {
      updateSearches();
      return updateSearches;
    }, scope.signal, document, ['id']));
    return scope.dispose;
  },
};
