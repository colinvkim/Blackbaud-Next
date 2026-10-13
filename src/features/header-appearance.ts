import type { NativeHeaderAppearanceTarget } from '../blackbaud/header-appearance.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createNavigationIcons } from './navigation-icons.ts';

export const HEADER_APPEARANCE_PART_ATTRIBUTE = 'data-bn-header-part';
export const HEADER_APPEARANCE_CURRENT_ATTRIBUTE = 'data-bn-header-current';
export const HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE = 'data-bn-header-count-empty';

function createTabFocusScrolling(list: HTMLElement) {
  const page = list.ownerDocument;
  const view = page.defaultView;
  let controls = new Set<HTMLElement>();
  let frame: number | undefined;
  let pending: HTMLElement | undefined;
  const cancel = () => {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = undefined;
    pending = undefined;
  };
  const verified = (control: HTMLElement) => list.isConnected && control.isConnected &&
    controls.has(control) && control.tagName === 'A' && control.parentElement?.tagName === 'LI' &&
    control.parentElement.parentElement === list &&
    list.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE) === 'tabs-navigation' &&
    control.getAttribute(HEADER_APPEARANCE_PART_ATTRIBUTE) === 'tab-item';
  const focus = (event: Event) => {
    cancel();
    const control = [...controls].find((candidate) => candidate === event.target);
    if (!control || !verified(control) || !view?.requestAnimationFrame) return;
    pending = control;
    // Native focus scrolls first; correct any remaining clipping on this list only.
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      pending = undefined;
      if (page.activeElement !== control || !verified(control) || typeof list.scrollBy !== 'function') return;
      const style = view.getComputedStyle(list);
      const padding = (value: string) => Math.max(0, Number.parseFloat(value) || 0);
      const bounds = list.getBoundingClientRect();
      const left = bounds.left + list.clientLeft + padding(style.scrollPaddingLeft);
      const right = bounds.left + list.clientLeft + list.clientWidth - padding(style.scrollPaddingRight);
      const visibleWidth = right - left;
      const item = control.getBoundingClientRect();
      if (visibleWidth <= 0 || item.width <= 0) return;
      const delta = item.width > visibleWidth ? style.direction === 'rtl' ? item.right - right : item.left - left :
        item.left < left ? item.left - left : item.right > right ? item.right - right : 0;
      if (delta) list.scrollBy({ left: delta, behavior: 'instant' });
    });
  };
  list.addEventListener('focusin', focus);
  return {
    update(next: Set<HTMLElement>) {
      controls = next;
      if (pending && !verified(pending)) cancel();
    },
    clear() {
      cancel();
      controls.clear();
      list.removeEventListener('focusin', focus);
    },
  };
}

export function createHeaderAppearance() {
  const markers = createAttributeOwnership();
  const spaces = new Map<HTMLElement, Text>();
  const searchLabels = new Map<HTMLElement, HTMLSpanElement>();
  const tabFocus = new Map<HTMLElement, ReturnType<typeof createTabFocusScrolling>>();
  const utilityIcons = createNavigationIcons();
  const update = (targets: NativeHeaderAppearanceTarget[]) => {
    const active = new Set(targets.map(({ element }) => element));
    markers.retain((element) => active.has(element));
    const separators = new Set(targets.map(({ spaceAfter }) => spaceAfter).filter((element): element is HTMLElement => element !== undefined));
    for (const [element, space] of spaces) {
      if (!separators.has(element)) { space.remove(); spaces.delete(element); }
    }
    const searches = new Set(targets.filter(({ part }) => part === 'tool-search').map(({ element }) => element));
    for (const [element, label] of searchLabels) {
      if (!searches.has(element)) { label.remove(); searchLabels.delete(element); }
    }
    for (const target of targets) {
      markers.mark(target.element, HEADER_APPEARANCE_PART_ATTRIBUTE, target.part);
      if (target.current) markers.mark(target.element, HEADER_APPEARANCE_CURRENT_ATTRIBUTE, 'true');
      else markers.restore(target.element, HEADER_APPEARANCE_CURRENT_ATTRIBUTE);
      if (target.part === 'tool-count') {
        markers.mark(target.element, HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE, /^0+$/.test(target.element.textContent?.trim() ?? '') ? 'true' : 'false');
      } else markers.restore(target.element, HEADER_APPEARANCE_COUNT_EMPTY_ATTRIBUTE);
    }
    const tabLists = new Set(targets.filter(({ part }) => part === 'tabs-navigation').map(({ element }) => element));
    for (const [list, scrolling] of tabFocus) {
      if (!tabLists.has(list)) { scrolling.clear(); tabFocus.delete(list); }
    }
    for (const list of tabLists) {
      let scrolling = tabFocus.get(list);
      if (!scrolling) { scrolling = createTabFocusScrolling(list); tabFocus.set(list, scrolling); }
      scrolling.update(new Set(targets.filter(({ part, element }) => part === 'tab-item' && element.parentElement?.parentElement === list).map(({ element }) => element)));
    }
    for (const element of separators) {
      let space = spaces.get(element);
      if (!space) {
        if (element.nextSibling?.nodeType === 3 && /^\s/.test(element.nextSibling.textContent ?? '')) continue;
        space = element.ownerDocument.createTextNode(' ');
        spaces.set(element, space);
      }
      if (element.nextSibling !== space) element.after(space);
    }
    for (const element of searches) {
      let label = searchLabels.get(element);
      const nativeText = [...element.childNodes].filter((node) => node !== label).map((node) => node.textContent ?? '').join('').trim();
      if (nativeText) {
        label?.remove();
        searchLabels.delete(element);
      } else {
        if (!label) {
          label = element.ownerDocument.createElement('span');
          label.className = 'bn-header-search-label';
          label.textContent = 'Search';
          searchLabels.set(element, label);
        }
        if (label.parentElement !== element) element.append(label);
      }
    }
    utilityIcons.update(targets.flatMap(({ icon }) => icon ? [icon] : []));
  };
  const clear = () => {
    utilityIcons.clear();
    for (const scrolling of tabFocus.values()) scrolling.clear();
    tabFocus.clear();
    for (const space of spaces.values()) space.remove();
    spaces.clear();
    for (const label of searchLabels.values()) label.remove();
    searchLabels.clear();
    markers.clear();
  };
  return { update, clear };
}
