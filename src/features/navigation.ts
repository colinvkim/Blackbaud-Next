import { formatNativePageTitle, isNativeResourceVisible, isResourceBoard, nativePageTitle, nativeResourceOuterWidth, normalizeResourceText, RESOURCE_BOARD_SELECTOR, resourceBoardCards, resourceBoardLayout, resourceSearchTerms } from '../blackbaud/navigation.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { addStyle, createButton, observeDom, watchElements } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import type { Feature } from '../shared/types.ts';

const resourceHiddenAttribute = 'data-blackbaud-next-resource-hidden';
const resourceFilteredAttribute = 'data-blackbaud-next-resource-filtered';
const resourceColumnProperty = '--blackbaud-next-resource-column-width';
const RESOURCE_SEARCH_STYLES = `
.bn-resource-search { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 12px 0 20px; padding-bottom: 16px; border-bottom: 1px solid var(--bn-border, #dde3e8); color: var(--bn-text, #222a35); font: 14px/1.5 var(--bn-font, "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif); }
.bn-resource-search label { margin: 0; font-size: 13px; font-weight: 600; }
.bn-resource-search input { box-sizing: border-box; min-height: 40px; flex: 1 1 200px; min-width: 0; max-width: 360px; padding: 8px 12px; border: 1px solid var(--bn-border-strong, #bbc7d1); border-radius: var(--bn-radius, 8px); color: var(--bn-text, #222a35); background: var(--bn-surface, #fff); font: inherit; }
.bn-resource-search .bn-button { min-height: 40px; }
.bn-resource-search input:focus-visible { outline: 2px solid var(--bn-accent, #0066a1); outline-offset: 3px; }
.bn-resource-search button[hidden] { display: none !important; }
#board-container .board-container[${resourceFilteredAttribute}] { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(${resourceColumnProperty}, 277px)), 1fr)); align-items: start; gap: 16px; height: auto !important; overflow: visible !important; }
#board-container .board-container[${resourceFilteredAttribute}] > .container-container.boxTopic.isotope-item { position: static !important; transform: none !important; }
#board-container .board-container[${resourceFilteredAttribute}] > .container-container.boxTopic.isotope-item[${resourceHiddenAttribute}] { visibility: hidden !important; position: absolute !important; pointer-events: none !important; }
@media (max-width: 480px) { .bn-resource-search { gap: 8px; } .bn-resource-search label { width: 100%; } .bn-resource-search input { max-width: none; } .bn-resource-search .bn-tool-status { flex-basis: 100%; } }
@media (max-width: 480px), (pointer: coarse) { .bn-resource-search :is(input, .bn-button) { min-height: 44px; } }
`;
let searchNumber = 0;

export const helpfulTabTitlesFeature: Feature = {
  id: 'helpful-tab-titles',
  settingsKeys: [],
  enabled: (settings) => settings.helpfulTabTitles,
  matches: isLmsPage,
  mount: ({ url, signal }) => {
    if (signal.aborted) return;
    let nativeTitle = document.title;
    let appliedTitle: string | undefined;
    let heading: HTMLElement | null = null;
    let disposed = false;
    const headingObserver = new MutationObserver(() => update());
    const titleObserver = new MutationObserver(() => update());
    const update = () => {
      if (disposed || signal.aborted) return;
      if (document.title !== appliedTitle) nativeTitle = document.title;
      const context = nativePageTitle(url);
      if (context?.heading !== heading) {
        headingObserver.disconnect();
        heading = context?.heading ?? null;
        if (heading) headingObserver.observe(heading, { childList: true, subtree: true, characterData: true });
      }
      const next = context ? formatNativePageTitle(context) : nativeTitle;
      appliedTitle = context ? next : undefined;
      if (document.title !== next) document.title = next;
    };
    titleObserver.observe(document.head ?? document.documentElement, { childList: true, subtree: true, characterData: true });
    const stop = observeDom(update, signal);
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stop();
      headingObserver.disconnect();
      titleObserver.disconnect();
      signal.removeEventListener('abort', cleanup);
      if (document.title === appliedTitle) document.title = nativeTitle;
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};

export const resourceSearchFeature: Feature = {
  id: 'resource-search',
  settingsKeys: [],
  routeScope: 'document',
  enabled: (settings) => settings.resourceSearch,
  matches: isResourceBoard,
  mount: ({ signal }) => {
    if (signal.aborted) return;
    const removeStyle = addStyle('resource-search', RESOURCE_SEARCH_STYLES);
    const stopBoards = watchElements<HTMLElement>(RESOURCE_BOARD_SELECTOR, (board) => {
      const toolbar = document.createElement('div');
      toolbar.className = 'bn-resource-search';
      toolbar.setAttribute('role', 'search');
      toolbar.setAttribute('aria-label', 'Resource Board');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.id = `blackbaud-next-resource-search-${++searchNumber}`;
      input.type = 'search';
      input.autocomplete = 'off';
      input.placeholder = 'Names or descriptions';
      label.htmlFor = input.id;
      label.textContent = 'Search resources';
      label.className = 'bn-icon-label';
      label.prepend(createIcon('search'));
      const clear = createButton('Clear', 'x');
      clear.hidden = true;
      const status = document.createElement('span');
      status.className = 'bn-tool-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      toolbar.append(label, input, clear, status);
      board.before(toolbar);
      let disposed = false;
      let layout: HTMLElement | null = null;
      const markedCards = new Map<HTMLElement, string | null>();
      const originalLayouts = new Map<HTMLElement, { marker: string | null; column: string; priority: string }>();
      const restoreCard = (card: HTMLElement) => {
        const previous = markedCards.get(card);
        if (previous === undefined) return;
        if (previous === null) card.removeAttribute(resourceHiddenAttribute);
        else card.setAttribute(resourceHiddenAttribute, previous);
        markedCards.delete(card);
      };
      const restoreLayout = (element: HTMLElement) => {
        const previous = originalLayouts.get(element);
        if (previous === undefined) return;
        if (previous.marker === null) element.removeAttribute(resourceFilteredAttribute);
        else element.setAttribute(resourceFilteredAttribute, previous.marker);
        if (previous.column) element.style.setProperty(resourceColumnProperty, previous.column, previous.priority);
        else element.style.removeProperty(resourceColumnProperty);
        originalLayouts.delete(element);
      };
      const textObserver = new MutationObserver(() => update());
      const visibilityObserver = new MutationObserver((records) => {
        // Loading views and tabs can hide ancestors without changing the board.
        // Moving the existing board also changes which native styles apply.
        if (records.some((record) => record.type === 'attributes'
          ? record.target !== board && record.target.contains(board)
          : [...record.addedNodes].some((node) => node.contains(board)))) update();
      });
      const update = () => {
        if (disposed || signal.aborted || !board.isConnected) return;
        if (toolbar.nextSibling !== board) board.before(toolbar);
        const nextLayout = resourceBoardLayout(board);
        if (nextLayout !== layout) {
          textObserver.disconnect();
          if (layout) restoreLayout(layout);
          layout = nextLayout;
          if (layout) textObserver.observe(layout, { subtree: true, characterData: true });
        }
        const terms = resourceSearchTerms(input.value);
        const cards = layout ? resourceBoardCards(layout) : [];
        const activeCards = new Set(cards);
        for (const card of markedCards.keys()) if (!activeCards.has(card)) restoreCard(card);
        let total = 0;
        let matches = 0;
        let columnWidth: number | null = null;
        // Clear our filters together before measuring native visibility. Native
        // hidden/style/class changes remain authoritative; all reads precede writes.
        for (const card of cards) if (markedCards.has(card)) card.removeAttribute(resourceHiddenAttribute);
        const results = cards.map((card) => {
          const available = isNativeResourceVisible(card);
          if (available && columnWidth === null) columnWidth = nativeResourceOuterWidth(card);
          const text = normalizeResourceText(card.textContent ?? '');
          const match = available && terms.every((term) => text.includes(term));
          if (available) total += 1;
          if (match) matches += 1;
          return { card, match };
        });
        for (const { card, match } of results) {
          if (terms.length && !match) {
            if (!markedCards.has(card)) markedCards.set(card, card.getAttribute(resourceHiddenAttribute));
            card.setAttribute(resourceHiddenAttribute, '');
          } else restoreCard(card);
        }
        if (layout) {
          if (terms.length) {
            if (!originalLayouts.has(layout)) originalLayouts.set(layout, {
              marker: layout.getAttribute(resourceFilteredAttribute),
              column: layout.style.getPropertyValue(resourceColumnProperty),
              priority: layout.style.getPropertyPriority(resourceColumnProperty),
            });
            const nextColumn = `${columnWidth ?? 277}px`;
            if (layout.style.getPropertyValue(resourceColumnProperty) !== nextColumn) layout.style.setProperty(resourceColumnProperty, nextColumn);
            layout.setAttribute(resourceFilteredAttribute, '');
          } else restoreLayout(layout);
        }
        const hideClear = !input.value;
        if (clear.hidden !== hideClear) clear.hidden = hideClear;
        const message = terms.length
          ? matches ? `${matches} of ${total} resources` : `No resources match your search (0 of ${total}).`
          : `${total} ${total === 1 ? 'resource' : 'resources'}`;
        if (status.textContent !== message) status.textContent = message;
      };
      const clearSearch = () => { input.value = ''; update(); input.focus(); };
      const preventSubmit = (event: KeyboardEvent) => { if (event.key === 'Enter') event.preventDefault(); };
      input.addEventListener('input', update);
      input.addEventListener('keydown', preventSubmit);
      clear.addEventListener('click', clearSearch);
      window.addEventListener('resize', update);
      visibilityObserver.observe(board.ownerDocument, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'] });
      const stop = observeDom(update, signal, board);
      return () => {
        disposed = true;
        stop();
        textObserver.disconnect();
        visibilityObserver.disconnect();
        input.removeEventListener('input', update);
        input.removeEventListener('keydown', preventSubmit);
        clear.removeEventListener('click', clearSearch);
        window.removeEventListener('resize', update);
        for (const card of markedCards.keys()) restoreCard(card);
        for (const element of originalLayouts.keys()) restoreLayout(element);
        toolbar.remove();
      };
    }, signal);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stopBoards();
      removeStyle();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
