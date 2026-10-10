import { currentClassSection } from './class-navigation.ts';
import { directoryTargetFromUrl } from './directory.ts';
import { isResourceBoard } from './navigation.ts';
import { assignmentTitleLinkUrl, ASSIGNMENT_LINK_SELECTOR, ASSIGNMENT_ROW_SELECTOR, ASSIGNMENT_TOOLBAR_SELECTOR } from './assignment-list.ts';
import { isLmsPage } from './routes.ts';

export type NativeAppearancePageKind = 'progress' | 'schedule' | 'class' | 'directory' | 'resources' | 'assignments';

export interface NativeAppearancePage {
  element: HTMLElement;
  kind: NativeAppearancePageKind;
}

export function nativeModernAppearanceRoute(url: URL): 'assignments' | 'calendar' | 'assignment' | null {
  if (!isLmsPage(url) || url.username || url.password || url.hash) return null;
  if (/^\/lms-assignment\/assignment-center(?:\/student)?\/?$/i.test(url.pathname)) return 'assignments';
  if (/^\/sis-scheduling\/user-calendar\/?$/i.test(url.pathname)) return 'calendar';
  if (/^\/lms-assignment\/assignment\/assignment-student-view\/[1-9]\d*\/?$/i.test(url.pathname)) return 'assignment';
  return null;
}

export function appearanceObservationSelector(url: URL): string {
  const modern = nativeModernAppearanceRoute(url);
  if (modern === 'assignments') return `#site-header, #site-nav-container, #site-nav-lower, #site-top-spacer, sky-toolbar, sky-repeater, ${ASSIGNMENT_ROW_SELECTOR}`;
  if (modern) return '#site-header, #site-nav-container, #site-top-spacer, app-root';
  return '#site-main, #site-header, #site-nav-container, #site-nav-lower, #site-nav-bottom, #site-top-spacer';
}

export function nativeAppearancePageKind(url: URL): NativeAppearancePageKind | null {
  if (!isLmsPage(url) || url.username || url.password) return null;
  if (nativeModernAppearanceRoute(url) === 'assignments') return 'assignments';
  if (!/^\/app\/[^/]+\/?$/i.test(url.pathname)) return null;
  if (directoryTargetFromUrl(url)) return 'directory';
  if (isResourceBoard(url) && /^#resourceboard\/?(?:\?.*)?$/i.test(url.hash)) return 'resources';
  if (currentClassSection(url) && /^#academicclass\/[1-9]\d*\/(?:(?:\d+|undefined)\/)?(?:bulletinboard|assignments|roster)\/?(?:\?.*)?$/i.test(url.hash)) return 'class';
  if (!/^\/app\/student\/?$/i.test(url.pathname)) return null;
  if (/^#studentmyday\/progress\/?(?:\?.*)?$/i.test(url.hash)) return 'progress';
  if (/^#studentmyday\/schedule\/?(?:\?.*)?$/i.test(url.hash)) return 'schedule';
  return null;
}

// A route identifies the intended page, while a unique native root supplies
// the concrete scope for cosmetics. Layout changes require separate checks.
export function nativeAppearancePage(url: URL, page: Document = document): NativeAppearancePage | null {
  const kind = nativeAppearancePageKind(url);
  if (!kind) return null;
  if (kind === 'assignments') {
    const toolbars = page.querySelectorAll<HTMLElement>(ASSIGNMENT_TOOLBAR_SELECTOR);
    const rows = page.querySelectorAll<HTMLElement>(ASSIGNMENT_ROW_SELECTOR);
    if (toolbars.length !== 1 || !rows.length || !page.body) return null;
    for (const row of rows) {
      const links = [...row.querySelectorAll<HTMLAnchorElement>(ASSIGNMENT_LINK_SELECTOR)]
        .filter((link) => link.closest(ASSIGNMENT_ROW_SELECTOR) === row);
      if (links.length !== 1 || !assignmentTitleLinkUrl(links[0]!)) return null;
    }
    return { element: page.body, kind };
  }
  const roots = page.querySelectorAll<HTMLElement>('#site-main');
  if (roots.length !== 1 || !roots[0]?.isConnected) return null;
  const components = {
    progress: '#coursesContainer', schedule: '#accordionSchedules', class: '#academicclassmaincontainer',
    directory: '#overview', resources: '#board-container .board-container.isotope',
  };
  if (roots[0].querySelectorAll(components[kind]).length !== 1) return null;
  return { element: roots[0], kind };
}

export function nativeLegacyAppearanceShell(url: URL, page: Document = document): HTMLElement | null {
  if (!isLmsPage(url) || url.username || url.password || !/^\/app\/student\/?$/i.test(url.pathname)) return null;
  const main = page.querySelectorAll('#site-main');
  const headers = page.querySelectorAll('#site-header');
  const navigation = page.querySelectorAll('#site-nav-container');
  return main.length === 1 && headers.length === 1 && navigation.length === 1 ? page.documentElement : null;
}

export function nativeModernAppearanceShell(url: URL, page: Document = document): HTMLElement | null {
  const route = nativeModernAppearanceRoute(url);
  if (!route) return null;
  const headers = page.querySelectorAll('#site-header');
  const navigation = page.querySelectorAll('#site-nav-container');
  if (headers.length !== 1 || navigation.length !== 1) return null;
  if (route !== 'assignments') {
    if (page.querySelectorAll('app-root').length !== 1) return null;
    const myDay = [...navigation[0]!.querySelectorAll<HTMLAnchorElement>('.topnav > li > a[href]')].filter((link) => {
      try {
        const destination = new URL(link.getAttribute('href') ?? '', url);
        return destination.origin === url.origin && !destination.username && !destination.password &&
          /^\/app\/student\/?$/i.test(destination.pathname) && /^#studentmyday\/?$/i.test(destination.hash);
      } catch { return false; }
    });
    return myDay.length === 1 ? page.documentElement : null;
  }
  const lowerNavigation = page.querySelectorAll('#site-nav-lower');
  return lowerNavigation.length === 1 ? page.documentElement : null;
}

function nativeClassLink(link: HTMLAnchorElement, url: URL): boolean {
  try {
    const destination = new URL(link.getAttribute('href') ?? '', url);
    return destination.origin === url.origin && destination.pathname === url.pathname &&
      !destination.username && !destination.password && currentClassSection(destination) !== null;
  } catch { return false; }
}

// The five-column native Progress row is a known layout. A new/malformed row
// falls back individually instead of forcing arbitrary native content into it.
export function nativeCourseRows(main: HTMLElement, url: URL): HTMLElement[] {
  if (nativeAppearancePageKind(url) !== 'progress' || main.id !== 'site-main' || !main.isConnected) return [];
  const containers = main.querySelectorAll<HTMLElement>('#coursesContainer');
  if (containers.length !== 1) return [];
  const columns = ['col-md-3', 'col-md-2', 'col-md-2', 'col-md-2', 'col-md-3'];
  return [...containers[0]!.querySelectorAll<HTMLElement>(':scope > .row')].filter((row) => {
    const children = [...row.children];
    if (children.length !== columns.length || children.some((child, index) => child.tagName !== 'DIV' ||
      !child.classList.contains(columns[index]!) || [...child.classList].some((name) => /^col-md-\d+$/.test(name) && name !== columns[index]))) return false;
    return [...children[0]!.querySelectorAll<HTMLAnchorElement>('a[href]')].some((link) => nativeClassLink(link, url));
  });
}

export function nativeProgressSummaryRow(main: HTMLElement, url: URL): HTMLElement | null {
  const context = nativeAppearancePage(url, main.ownerDocument);
  if (context?.kind !== 'progress' || context.element !== main) return null;
  const matches = [...main.querySelectorAll<HTMLElement>('.row')].filter((row) => {
    const wrappers = [...row.children];
    if (wrappers.length !== 2 || wrappers.some((wrapper) => wrapper.tagName !== 'DIV') ||
      !['performance', 'attendance'].every((id) => wrappers.filter((wrapper) => wrapper.id === id).length === 1)) return false;
    return wrappers.every((wrapper) => {
      const columns = [...wrapper.children];
      if (columns.length !== 1) return false;
      const column = columns[0]!;
      if (column.tagName !== 'DIV' || !column.matches('.ch.col-md-4') ||
        [...column.classList].some((name) => /^col-md-\d+$/.test(name) && name !== 'col-md-4') || column.children.length !== 1) return false;
      const tile = column.children[0]!;
      return tile.tagName === 'SECTION' && tile.classList.contains('bb-tile') && tile.id === wrapper.id &&
        tile.querySelectorAll(':scope > .bb-tile-title').length === 1 &&
        tile.querySelectorAll(':scope > .bb-tile-content').length === 1;
    });
  });
  return matches.length === 1 ? matches[0]! : null;
}
