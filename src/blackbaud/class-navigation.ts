import { isLmsPage } from './routes.ts';

export const NATIVE_CLASSES_MENU_SELECTOR = 'li:has(> #group-header-Classes) > .subnav, li:has(> #mobile-group-header-Classes) > .app-mobile-level';
export const NATIVE_CLASS_LINK_SELECTOR = 'a:is(.group-page-link-1, .mobile-group-page-link-1)[data-taskid="1853"][href*="#academicclass/"]';

const supportedSections = new Set(['bulletinboard', 'assignments', 'roster']);

interface AcademicClassRoute {
  parts: string[];
  sectionIndex: number;
  section: string;
  query: string;
}

export interface NativeClassMenuItem {
  row: HTMLElement;
  link: HTMLAnchorElement;
  name: string;
}

function academicClassRoute(url: URL): AcademicClassRoute | null {
  const separator = url.hash.indexOf('?');
  const hash = separator === -1 ? url.hash : url.hash.slice(0, separator);
  const query = separator === -1 ? '' : url.hash.slice(separator);
  const parts = hash.slice(1).split('/');
  if (parts[0]?.toLowerCase() !== 'academicclass' || !/^[1-9]\d*$/.test(parts[1] ?? '')) return null;
  const sectionIndex = /^[a-z][a-z-]*$/i.test(parts[2] ?? '') && parts[2] !== 'undefined' ? 2 : 3;
  if (sectionIndex === 3 && !/^(?:\d+|undefined)$/.test(parts[2] ?? '')) return null;
  const section = parts[sectionIndex]?.toLowerCase() ?? '';
  if (!/^[a-z][a-z-]*$/.test(section)) return null;
  return { parts, sectionIndex, section, query };
}

export function currentClassSection(url: URL): string | null {
  const section = isLmsPage(url) ? academicClassRoute(url)?.section : null;
  return section && supportedSections.has(section) ? section : null;
}

/** Replace only the destination's section, retaining its course and term. */
export function classDestinationForSection(href: string, current: URL): string | null {
  if (!isLmsPage(current)) return null;
  try {
    const destination = new URL(href, current.href);
    if (destination.origin !== current.origin || destination.username || destination.password) return null;
    const route = academicClassRoute(destination);
    if (!route) return null;
    const section = currentClassSection(current);
    if (!section || !supportedSections.has(route.section) || section === route.section) return href;
    // Subroutes may refer to one specific course's assignment or roster view.
    // Keep their native destination instead of borrowing another course's IDs.
    if (route.parts.slice(route.sectionIndex + 1).some(Boolean)) return href;
    route.parts[route.sectionIndex] = section;
    destination.hash = `${route.parts.join('/')}${route.query}`;
    return destination.href;
  } catch {
    return null;
  }
}

function modernClassMenuLinks(menu: HTMLElement, current: URL): HTMLAnchorElement[] {
  if (!isLmsPage(current) || current.username || current.password || !menu.matches('div.subnav')) return [];
  const page = menu.ownerDocument;
  const controls = page.querySelectorAll<HTMLAnchorElement>('a#group-header-Classes');
  const navigation = page.querySelectorAll('#site-nav-container');
  const control = controls[0];
  const item = control?.parentElement;
  const list = item?.parentElement;
  // Angular omits the legacy link class. Its known root action and direct menu
  // rows establish the scope before accepting task/route-based class links.
  if (page.querySelectorAll('#group-header-Classes').length !== 1 || controls.length !== 1 || navigation.length !== 1 ||
    !control?.classList.contains('root-nav-item') || control.getAttribute('href') !== '#' || item?.tagName !== 'LI' ||
    menu.parentElement !== item || item.querySelectorAll(':scope > a').length !== 1 || item.querySelectorAll(':scope > .subnav').length !== 1 ||
    list?.tagName !== 'UL' || !list.classList.contains('topnav') || !navigation[0]!.contains(list)) return [];
  return [...menu.querySelectorAll<HTMLAnchorElement>(':scope > ul:not(.subnavfooter) > li > a[data-taskid="1853"][href*="#academicclass/"]')]
    .filter((link) => {
      try {
        const destination = new URL(link.getAttribute('href')!, current);
        return /^\/app\/student\/?$/i.test(destination.pathname) && destination.origin === current.origin &&
          !destination.username && !destination.password;
      } catch { return false; }
    });
}

export function nativeClassMenuItems(menu: HTMLElement, current: URL): NativeClassMenuItem[] {
  const items: NativeClassMenuItem[] = [];
  const links = new Set([...menu.querySelectorAll<HTMLAnchorElement>(NATIVE_CLASS_LINK_SELECTOR), ...modernClassMenuLinks(menu, current)]);
  for (const link of links) {
    const row = link.parentElement;
    const href = link.getAttribute('href');
    if (!row || row.tagName !== 'LI' || row.closest('.subnavfooter') || !href || classDestinationForSection(href, current) === null) continue;
    items.push({ row, link, name: link.textContent?.replace(/\s+/g, ' ').trim() ?? '' });
  }
  return items;
}

export function classSearchTerms(query: string): string[] {
  return normalizeClassSearch(query).split(/\s+/).filter(Boolean);
}

export function normalizeClassSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function nativeClassRowVisible(row: HTMLElement, menu: HTMLElement): boolean {
  if (!row.isConnected) return false;
  const view = row.ownerDocument.defaultView;
  for (let element: HTMLElement | null = row; element && element !== menu; element = element.parentElement) {
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false;
    const style = view?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

export function nativeClassSearchReference(menu: HTMLElement): HTMLElement | null {
  return menu.querySelector<HTMLElement>(':scope > .app-mobile-back');
}
