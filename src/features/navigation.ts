import { formatNativePageTitle, isNativeResourceVisible, isResourceBoard, nativePageTitle, nativeResourceOuterWidth, normalizeResourceText, RESOURCE_BOARD_SELECTOR, resourceBoardCards, resourceBoardLayout, resourceSearchTerms } from '../blackbaud/navigation.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createButton, markOwned, observeDom, observeElementContext, watchAddedElements } from '../shared/dom.ts';
import { createScope } from '../shared/scope.ts';
import { createIcon } from '../shared/icons.ts';
import type { Feature } from '../shared/types.ts';

const resourceHiddenAttribute = 'data-blackbaud-next-resource-hidden';
const resourceFilteredAttribute = 'data-blackbaud-next-resource-filtered';
const resourceColumnProperty = '--blackbaud-next-resource-column-width';
const RESOURCE_SEARCH_STYLES = `
.bn-resource-search { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 12px 0 20px; padding-bottom: 16px; border-bottom: 1px solid var(--bn-border); color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-resource-search label { margin: 0; font-size: 13px; font-weight: 600; }
.bn-resource-search input { box-sizing: border-box; min-height: 40px; flex: 1 1 200px; min-width: 0; max-width: 360px; padding: 8px 12px; border: 1px solid var(--bn-border-strong); border-radius: var(--bn-radius); color: var(--bn-text); background: var(--bn-surface); font: inherit; }
.bn-resource-search .bn-button { min-height: 40px; }
.bn-resource-search input:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 3px; }
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
  mount: ({ url, signal: parentSignal }) => {
    if (parentSignal.aborted) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    let nativeTitle = document.title;
    let appliedTitle: string | undefined;
    let heading: HTMLElement | null = null;
    const headingObserver = new MutationObserver(() => update());
    const titleObserver = new MutationObserver(() => update());
    const update = () => {
      if (signal.aborted) return;
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
    scope.add(observeDom(update, signal));
    scope.add(() => {
      headingObserver.disconnect();
      titleObserver.disconnect();
      if (document.title === appliedTitle) document.title = nativeTitle;
    });
    return scope.dispose;
  },
};

export const resourceSearchFeature: Feature = {
  id: 'resource-search',
  settingsKeys: [],
  routeScope: 'document',
  enabled: (settings) => settings.resourceSearch,
  matches: isResourceBoard,
  mount: ({ signal: parentSignal }) => {
    if (parentSignal.aborted) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    scope.style('resource-search', RESOURCE_SEARCH_STYLES);
    const stopBoards = watchAddedElements<HTMLElement>(RESOURCE_BOARD_SELECTOR, (board) => {
      const boardScope = createScope(signal);
      const ownership = createAttributeOwnership();
      boardScope.add(ownership.clear);
      const toolbar = markOwned(document.createElement('div'));
      boardScope.add(() => toolbar.remove());
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
      let layout: HTMLElement | null = null;
      const restoreLayout = (element: HTMLElement) => {
        ownership.restore(element, resourceFilteredAttribute);
        ownership.restoreStyle(element, resourceColumnProperty);
      };
      const update = () => {
        if (boardScope.signal.aborted || !board.isConnected) return;
        if (toolbar.nextSibling !== board) board.before(toolbar);
        const nextLayout = resourceBoardLayout(board);
        if (nextLayout !== layout) {
          if (layout) restoreLayout(layout);
          layout = nextLayout;
        }
        const terms = resourceSearchTerms(input.value);
        const cards = layout ? resourceBoardCards(layout) : [];
        const activeCards = new Set(cards);
        ownership.retain((element, attribute) => attribute !== resourceHiddenAttribute || activeCards.has(element));
        let total = 0;
        let matches = 0;
        let columnWidth: number | null = null;
        // Clear our filters together before measuring native visibility. Native
        // hidden/style/class changes remain authoritative; all reads precede writes.
        for (const card of cards) ownership.restore(card, resourceHiddenAttribute);
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
            ownership.mark(card, resourceHiddenAttribute, '');
          }
        }
        if (layout) {
          if (terms.length) {
            ownership.style(layout, resourceColumnProperty, `${columnWidth ?? 277}px`);
            ownership.mark(layout, resourceFilteredAttribute, '');
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
      boardScope.listen(input, 'input', update);
      boardScope.listen(input, 'keydown', preventSubmit);
      boardScope.listen(clear, 'click', clearSearch);
      boardScope.listen(window, 'resize', update);
      boardScope.add(observeElementContext(board, update, { subtree: true }));
      update();
      return boardScope.dispose;
    }, signal);
    scope.add(stopBoards);
    return scope.dispose;
  },
};
