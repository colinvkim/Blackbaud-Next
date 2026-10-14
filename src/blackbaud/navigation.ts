import { isLmsPage } from './routes.ts';
import { assignmentTitle } from './assignment-title.ts';
import { isActionable } from '../shared/dom.ts';

export interface NativePageTitle {
  label: string;
  heading: HTMLElement | null;
  breadcrumb?: boolean;
  directText?: boolean;
}

function firstVisibleHeading(page: Document, selectors: string): HTMLElement | null {
  return [...page.querySelectorAll<HTMLElement>(selectors)].find((element) =>
    isActionable(element) && visibleHeadingText(element),
  ) ?? null;
}

function visibleHeadingText(heading: HTMLElement, limit = 100): string {
  const walker = heading.ownerDocument.createTreeWalker(heading, 4 /* SHOW_TEXT */);
  const fragments: string[] = [];
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent && isActionable(parent)) fragments.push(walker.currentNode.textContent ?? '');
  }
  return fragments.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function directHeadingText(heading: HTMLElement): string {
  return [...heading.childNodes].filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function nativePageTitle(url: URL, page: Document = document): NativePageTitle | null {
  if (!isLmsPage(url)) return null;
  if (/^\/lms-assignment\/assignment\/assignment-student-view\/[1-9]\d*(?:\/|$)/.test(url.pathname)) {
    return { label: 'Assignments', heading: firstVisibleHeading(page, 'h1.sky-theme-font-heading-1.display-inline > span'), breadcrumb: true };
  }
  if (url.pathname.includes('/lms-assignment/assignment-center') || /^#studentmyday\/assignment-center(?:\/|\?|$)/i.test(url.hash)) {
    return { label: 'Assignment Center', heading: null };
  }
  if (/^#studentmyday\/progress(?:\/|\?|$)/i.test(url.hash)) return { label: 'Progress', heading: null };
  if (/^#studentmyday\/schedule(?:\/|\?|$)/i.test(url.hash)) return { label: 'Schedule', heading: null };
  if (isResourceBoard(url)) return { label: 'Resources', heading: null };
  if (/^#academicclass\/[1-9]\d*(?:\/|$)/i.test(url.hash)) {
    const sections = url.hash.split(/[/?]/).slice(2).filter((section) => section !== 'undefined');
    const section = sections.find((value) => ['assignments', 'bulletinboard', 'roster', 'gradebook', 'topics'].includes(value.toLowerCase()));
    const label = ({ assignments: 'Assignments', bulletinboard: 'Bulletin Board', roster: 'Roster', gradebook: 'Gradebook', topics: 'Topics' } as Record<string, string>)[section?.toLowerCase() ?? ''] ?? 'Class';
    return { label, heading: firstVisibleHeading(page, '#academicclassnavmenu .section-heading > .bb-page-heading'), directText: true };
  }
  return null;
}

export function formatNativePageTitle(context: NativePageTitle): string {
  const text = context.heading ? context.directText ? directHeadingText(context.heading) : visibleHeadingText(context.heading, context.breadcrumb ? 200_000 : 100) : '';
  const assignmentText = text.replace(/^>\s*/, '');
  const heading = context.breadcrumb
    ? context.heading?.children.length ? assignmentText.slice(0, 100) : assignmentTitle(assignmentText, context.heading?.ownerDocument, 100)
    : text;
  return `${heading && heading.toLowerCase() !== context.label.toLowerCase() ? `${heading} · ` : ''}${context.label} — Blackbaud`;
}

export function isResourceBoard(url: URL): boolean {
  return isLmsPage(url) && /^#resourceboard(?:\/|\?|$)/i.test(url.hash);
}

export function resourceSearchTerms(query: string): string[] {
  return normalizeResourceText(query).split(/\s+/).filter(Boolean);
}

export function normalizeResourceText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export const RESOURCE_BOARD_SELECTOR = '#board-container';

export function resourceBoardLayout(board: HTMLElement): HTMLElement | null {
  return board.querySelector<HTMLElement>('.board-container.isotope');
}

export function resourceBoardCards(layout: HTMLElement): HTMLElement[] {
  return [...layout.querySelectorAll<HTMLElement>(':scope > .container-container.boxTopic.isotope-item')];
}

export function nativeResourceOuterWidth(card: HTMLElement): number | null {
  const style = card.ownerDocument.defaultView?.getComputedStyle(card);
  if (!style) return null;
  const bounds = card.getBoundingClientRect();
  const width = bounds.width || Number.parseFloat(style.width);
  const margin = (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0);
  return Number.isFinite(width) && width > 0 ? width + margin : null;
}

export function isNativeResourceVisible(card: HTMLElement): boolean {
  if (!card.isConnected || card.closest('[hidden], [aria-hidden="true"], .isotope-hidden')) return false;
  const view = card.ownerDocument.defaultView;
  for (let element: HTMLElement | null = card; element; element = element.parentElement) {
    const style = view?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
  }
  return true;
}
