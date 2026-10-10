import { classDestinationForSection, classSearchTerms, NATIVE_CLASSES_MENU_SELECTOR, nativeClassMenuItems, nativeClassRowVisible, nativeClassSearchReference, normalizeClassSearch } from '../blackbaud/class-navigation.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { addStyle, createButton, observeDom, watchElements } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import type { Feature } from '../shared/types.ts';

const hiddenAttribute = 'data-blackbaud-next-class-hidden';
const menuAttribute = 'data-blackbaud-next-class-menu';
const styles = `
[${menuAttribute}] .bn-class-search { display: flex; flex-wrap: wrap; align-items: center; clear: both; box-sizing: border-box; width: 100%; gap: 8px; padding: 12px; border-bottom: 1px solid var(--bn-border, #dde3e8); background: var(--bn-surface, #fff); color: var(--bn-text, #222a35); font: 14px/1.5 var(--bn-font, "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif); }
.bn-class-search label { margin: 0; color: var(--bn-text, #222a35); font-size: 13px; font-weight: 600; }
.bn-class-search input { box-sizing: border-box; min-height: 36px; flex: 1 1 160px; min-width: 0; padding: 6px 10px; border: 1px solid var(--bn-border-strong, #bbc7d1); border-radius: var(--bn-radius, 8px); background: var(--bn-surface, #fff); color: var(--bn-text, #222a35); font: inherit; }
.bn-class-search input:focus-visible { outline: 2px solid var(--bn-accent, #0066a1); outline-offset: 3px; }
.bn-class-search [hidden] { display: none !important; }
[${menuAttribute}] li[${hiddenAttribute}] { display: none !important; }
.bn-class-search .bn-tool-status { flex-basis: 100%; color: var(--bn-muted, #657080); }
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
    const removeStyle = addStyle('class-navigation', styles);
    let query = '';
    const searches = new Set<() => void>();
    const stopMenus = watchElements<HTMLElement>(NATIVE_CLASSES_MENU_SELECTOR, (menu) => {
      const previousMenuAttribute = menu.getAttribute(menuAttribute);
      menu.setAttribute(menuAttribute, '');
      const toolbar = document.createElement('div');
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
      const hiddenRows = new Map<HTMLElement, string | null>();
      let disposed = false;
      const restoreRow = (row: HTMLElement) => {
        const previous = hiddenRows.get(row);
        if (previous === undefined) return;
        if (previous === null) row.removeAttribute(hiddenAttribute);
        else row.setAttribute(hiddenAttribute, previous);
        hiddenRows.delete(row);
      };
      const restoreLink = (link: HTMLAnchorElement, state: LinkState) => {
        if (link.getAttribute('href') === state.appliedHref && state.appliedHref !== state.nativeHref) link.setAttribute('href', state.nativeHref);
      };
      const update = () => {
        if (disposed || signal.aborted || !menu.isConnected) return;
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
        for (const row of hiddenRows.keys()) if (!currentRows.has(row)) restoreRow(row);
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
          if (hiddenRows.has(row)) row.removeAttribute(hiddenAttribute);
          const available = nativeClassRowVisible(row, menu);
          const matching = terms.every((term) => normalizeClassSearch(name).includes(term));
          if (available) {
            total += 1;
            if (matching) matches += 1;
          }
          if (terms.length && available && !matching) {
            if (!hiddenRows.has(row)) hiddenRows.set(row, row.getAttribute(hiddenAttribute));
            row.setAttribute(hiddenAttribute, '');
          } else restoreRow(row);
        }
        const hideClear = !query;
        if (clear.hidden !== hideClear) clear.hidden = hideClear;
        const message = terms.length ? matches ? `${matches} of ${total} classes` : `No classes match your search (0 of ${total}).` : `${total} ${total === 1 ? 'class' : 'classes'}`;
        if (status.textContent !== message) status.textContent = message;
      };
      const textObserver = new MutationObserver(update);
      textObserver.observe(menu, { subtree: true, characterData: true });
      const updateSearches = () => { for (const updateSearch of searches) updateSearch(); };
      const searchInput = () => { query = input.value; updateSearches(); };
      const clearSearch = () => { query = ''; updateSearches(); input.focus(); };
      const stopNativeMenuClose = (event: Event) => { event.stopPropagation(); };
      const preventSubmit = (event: KeyboardEvent) => {
        if (event.key === 'Enter') event.preventDefault();
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      };
      input.addEventListener('input', searchInput);
      input.addEventListener('keydown', preventSubmit);
      clear.addEventListener('click', clearSearch);
      toolbar.addEventListener('click', stopNativeMenuClose);
      searches.add(update);
      const stop = observeDom(update, signal, menu);
      return () => {
        disposed = true;
        stop();
        textObserver.disconnect();
        searches.delete(update);
        input.removeEventListener('input', searchInput);
        input.removeEventListener('keydown', preventSubmit);
        clear.removeEventListener('click', clearSearch);
        toolbar.removeEventListener('click', stopNativeMenuClose);
        for (const row of hiddenRows.keys()) restoreRow(row);
        for (const [link, state] of links) restoreLink(link, state);
        links.clear();
        toolbar.remove();
        if (previousMenuAttribute === null) menu.removeAttribute(menuAttribute);
        else menu.setAttribute(menuAttribute, previousMenuAttribute);
      };
    }, signal);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stopMenus();
      removeStyle();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
