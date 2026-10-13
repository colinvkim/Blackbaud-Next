import type { IconName } from '../shared/icons.ts';
import { nativeAppearanceShellKind } from './appearance.ts';
import type { NativeAppearanceShellKind } from './appearance.ts';

export interface NativeNavigationIconTarget {
  control: HTMLAnchorElement;
  kind: IconName;
  original: Element | null;
}

export interface NativeAppearanceNavigation {
  shell: NativeAppearanceShellKind | null;
  icons: NativeNavigationIconTarget[];
}

export function nativeAppearanceNavigation(page: Document, url: URL): NativeAppearanceNavigation {
  const shell = nativeAppearanceShellKind(url, page);
  return { shell, icons: nativeNavigationIconTargets(page, url, shell) };
}

const topItems = [
  { id: 'group-header-Classes', kind: 'book-open', file: 'classes_48.png', destination: 'menu' },
  { id: 'group-header-Groups', kind: 'users-round', file: 'groups.png', destination: 'groups' },
  { id: 'group-header-Resources', kind: 'folder-closed', file: 'resources.png', destination: 'resources' },
  { id: 'group-header-News', kind: 'newspaper', file: 'news.png', destination: 'menu' },
  { id: 'calendar-subnav', kind: 'calendar-outline', file: 'calendar.png', destination: 'calendar' },
  { id: 'directory-subnav', kind: 'book-user', file: 'directory.png', destination: 'menu' },
] as const satisfies readonly { id: string; kind: IconName; file: string; destination: string }[];

const lowerItems = [
  { id: 'progress-btn', kind: 'chart-column', className: 'p3icon-progress', destination: 'progress' },
  { id: 'schedule-btn', kind: 'clock-3', className: 'p3icon-schedule', destination: 'schedule' },
  { id: 'assignment-center-btn', kind: 'clipboard-check', className: 'p3icon-assignments', destination: 'assignments' },
  { id: 'course-requests-btn', kind: 'graduation-cap', className: 'p3icon-courseRequest', destination: 'courses' },
] as const satisfies readonly { id: string; kind: IconName; className: string; destination: string }[];

function destination(control: HTMLAnchorElement, url: URL): URL | null {
  const href = control.getAttribute('href');
  if (!href) return null;
  try {
    const target = new URL(href, control.ownerDocument.baseURI);
    return target.origin === url.origin && !target.username && !target.password ? target : null;
  } catch { return null; }
}

function studentHash(target: URL, hash: string): boolean {
  return /^\/app\/student\/?$/i.test(target.pathname) && new RegExp(`^#${hash}\\/?(?:\\?.*)?$`, 'i').test(target.hash);
}

function topDestination(control: HTMLAnchorElement, url: URL, kind: typeof topItems[number]['destination']): boolean {
  const target = destination(control, url);
  if (!target) return false;
  const menu = control.getAttribute('href') === '#';
  if (kind === 'menu') return menu;
  if (kind === 'groups') return menu || (/^\/app\/SignOut\/?$/i.test(target.pathname) && !target.hash && !target.search);
  return studentHash(target, kind === 'resources' ? 'resourceboard' : 'calendar');
}

function lowerDestination(control: HTMLAnchorElement, url: URL, kind: typeof lowerItems[number]['destination']): boolean {
  const target = destination(control, url);
  if (!target) return false;
  if (kind === 'progress' || kind === 'schedule') return studentHash(target, `studentmyday/${kind}`);
  if (kind === 'assignments') return studentHash(target, 'studentmyday/assignment-center') ||
    (/^\/lms-assignment\/assignment-center\/student\/?$/i.test(target.pathname) && !target.hash);
  return /^\/edu-self-registration\/student-course-requests\/?$/i.test(target.pathname) && !target.hash;
}

function hasNativeTitle(control: HTMLAnchorElement): boolean {
  const descriptions = control.querySelectorAll(':scope > .desc');
  const titles = descriptions[0]?.querySelectorAll(':scope > .title');
  return descriptions.length === 1 && titles?.length === 1 && !!titles[0]!.textContent?.trim();
}

function nativeImage(control: HTMLAnchorElement, file: string, modern: boolean): Element | null | undefined {
  const images = control.querySelectorAll(':scope > img');
  if (!images.length) {
    // The modern shell sometimes omits the large image. Its caret is an action
    // affordance, so it remains native and is never an icon replacement target.
    const icons = [...control.querySelectorAll(':scope > sky-icon')];
    return modern && !control.querySelector(':scope > i, :scope > svg:not([data-bn-navigation-icon])') &&
      icons.every((icon) => icon.getAttribute('iconname') === 'caret-down') ? null : undefined;
  }
  if (images.length !== 1) return undefined;
  const image = images[0]!;
  if (image.matches('.caret, [aria-controls], [aria-haspopup], [onclick]') || image.getAttribute('alt')?.trim() ||
    image.hasAttribute('aria-label') || image.hasAttribute('aria-labelledby') || image.hasAttribute('tabindex') ||
    (image.hasAttribute('role') && !['none', 'presentation'].includes(image.getAttribute('role')!))) return undefined;
  try {
    const source = new URL(image.getAttribute('src') ?? '', control.ownerDocument.baseURI);
    if (source.protocol !== 'https:' || source.username || source.password ||
      !source.hostname.endsWith('.myschoolapp.com') || source.pathname !== `/p3-cache/img/48x48/${file}`) return undefined;
    return image;
  } catch { return undefined; }
}

function nativeLowerIcon(control: HTMLAnchorElement, className: string): Element | null {
  const icons = control.querySelectorAll(':scope > i[class*="p3icon-"]');
  const icon = icons[0];
  if (icons.length !== 1 || !icon?.classList.contains(className) ||
    [...icon.classList].some((name) => name.startsWith('p3icon-') && name !== className) ||
    icon.matches('[aria-controls], [aria-haspopup], [onclick], [aria-label], [aria-labelledby]') ||
    icon.hasAttribute('tabindex') || icon.children.length || icon.textContent?.trim() ||
    (icon.hasAttribute('role') && !['none', 'presentation'].includes(icon.getAttribute('role')!))) return null;
  return icon;
}

function nativeDayBadge(control: HTMLAnchorElement): Element | null {
  const badges = control.querySelectorAll(':scope > .dayicon');
  const badge = badges[0];
  const day = /^(?:0?[1-9]|[12]\d|3[01])$/;
  if (badges.length !== 1 || !badge || !['SPAN', 'DIV'].includes(badge.tagName) ||
    badge.matches('[aria-controls], [aria-haspopup], [onclick], [tabindex], [aria-label], [aria-labelledby]') ||
    (badge.hasAttribute('role') && !['none', 'presentation'].includes(badge.getAttribute('role')!)) ||
    badge.querySelector('a, button, input, select, textarea, img, svg, i, sky-icon, [tabindex], [onclick], [aria-controls], [aria-haspopup], [aria-label], [aria-labelledby], [role]:not([role="none"]):not([role="presentation"])') ||
    control.querySelector(':scope > img, :scope > i, :scope > svg:not([data-bn-navigation-icon]), :scope > sky-icon:not([iconname="caret-down"])')) return null;
  if (!badge.children.length) return day.test(badge.textContent?.trim() ?? '') ? badge : null;
  const month = badge.querySelectorAll(':scope > span.month');
  const date = badge.querySelectorAll(':scope > span.day');
  return badge.tagName === 'DIV' && badge.children.length === 2 && month.length === 1 && date.length === 1 &&
    !month[0]!.children.length && !!month[0]!.textContent?.trim() && !date[0]!.children.length &&
    day.test(date[0]!.textContent?.trim() ?? '') ? badge : null;
}

/** Read only known native navigation; each returned control keeps its action and text. */
export function nativeNavigationIconTargets(page: Document, url: URL, shell = nativeAppearanceShellKind(url, page)): NativeNavigationIconTarget[] {
  if (!shell) return [];
  const modern = shell === 'modern';
  const navigation = page.querySelector('#site-nav-container')!;
  const controls = [...navigation.querySelectorAll<HTMLAnchorElement>('.topnav > li > a')];
  const targets: NativeNavigationIconTarget[] = [];
  const myDay = controls.filter((control) => {
    const target = destination(control, url);
    return target && studentHash(target, 'studentmyday(?:/(?:progress|schedule|assignment-center))?');
  });
  if (myDay.length === 1) {
    const control = myDay[0]!;
    const original = nativeDayBadge(control);
    if (original && hasNativeTitle(control) && (!modern || control.classList.contains('root-nav-item'))) {
      targets.push({ control, kind: 'house', original });
    }
  }
  for (const item of topItems) {
    const matches = controls.filter((control) => control.id === item.id);
    if (matches.length !== 1 || navigation.querySelectorAll(`#${item.id}`).length !== 1) continue;
    const control = matches[0]!;
    if ((modern && !control.classList.contains('root-nav-item')) || !hasNativeTitle(control) || !topDestination(control, url, item.destination)) continue;
    const original = nativeImage(control, item.file, modern);
    if (original !== undefined) targets.push({ control, kind: item.kind, original });
  }

  const roots: Element[] = [];
  for (const id of modern ? ['site-nav-lower'] : ['site-nav-lower', 'site-nav-bottom']) {
    const matches = page.querySelectorAll(`#${id}`);
    if (matches.length === 1) roots.push(matches[0]!);
  }
  const lowerControls = [...new Set(roots.flatMap((root) => [...root.querySelectorAll<HTMLAnchorElement>('ul > li > a[href]')]))];
  for (const item of lowerItems) {
    const matches = lowerControls.filter((control) => (modern || control.id === item.id) && lowerDestination(control, url, item.destination));
    if (matches.length !== 1) continue;
    const control = matches[0]!;
    const original = nativeLowerIcon(control, item.className);
    if (original) targets.push({ control, kind: item.kind, original });
  }
  return targets;
}
