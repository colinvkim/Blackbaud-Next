import { nativeAppearancePageKind, nativeModernAppearanceRoute } from './appearance.ts';
import { nativeAppearanceNavigation } from './appearance-icons.ts';
import type { NativeAppearanceNavigation, NativeNavigationIconTarget } from './appearance-icons.ts';

export type NativeHeaderAppearancePart = 'masthead-column' | 'brand' | 'tools' | 'tools-list' |
  'tool-search' | 'tool-notes' | 'tool-messages' | 'tool-account' | 'tool-icon' | 'tool-count' | 'tool-label' |
  'account-name' | 'account-name-line' | 'account-break' | 'primary-navigation' | 'primary-item' |
  'primary-description' | 'primary-title' | 'primary-count' | 'tabs-navigation' | 'tab-item' | 'spacer' |
  'dropdown' | 'dropdown-classes' | 'dropdown-list' | 'dropdown-footer' | 'dropdown-link' |
  'dropdown-divider' | 'dropdown-heading' | 'dropdown-pointer' | 'dropdown-search';

export interface NativeHeaderAppearanceTarget {
  element: HTMLElement;
  part: NativeHeaderAppearancePart;
  current?: boolean;
  icon?: NativeNavigationIconTarget;
  spaceAfter?: HTMLElement;
}

function one<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T | null {
  const matches = root.querySelectorAll<T>(selector);
  return matches.length === 1 ? matches[0]! : null;
}

function destination(control: HTMLAnchorElement, url: URL): URL | null {
  try {
    const target = new URL(control.getAttribute('href') ?? '', control.ownerDocument.baseURI);
    return control.hasAttribute('href') && target.origin === url.origin && !target.username && !target.password ? target : null;
  } catch { return null; }
}

function studentDestination(control: HTMLAnchorElement, url: URL, hash: string): boolean {
  const target = destination(control, url);
  return target !== null && /^\/app\/student\/?$/i.test(target.pathname) &&
    new RegExp(`^#${hash}\\/?$`, 'i').test(target.hash);
}

function decorative(element: HTMLElement): boolean {
  return !element.matches('[aria-controls], [aria-haspopup], [onclick], [tabindex], [aria-label], [aria-labelledby]') &&
    (!element.hasAttribute('role') || ['none', 'presentation'].includes(element.getAttribute('role')!));
}

function title(control: HTMLAnchorElement, modern: boolean): { description: HTMLElement; wrapper: HTMLElement; label: HTMLElement } | null {
  const description = one(control, ':scope > .desc');
  const wrapper = description && one(description, ':scope > .title');
  if (!description || !wrapper) return null;
  const label = modern ? one(wrapper, ':scope > div') : wrapper;
  if (!label || label.children.length || !label.textContent?.trim()) return null;
  if (modern && (wrapper.children.length !== 1 || [...wrapper.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()))) return null;
  return { description, wrapper, label };
}

function active(control: HTMLAnchorElement): boolean {
  return control.classList.contains('active') || control.parentElement?.classList.contains('active') === true ||
    control.getAttribute('aria-current') === 'page';
}

function currentPrimary(url: URL): string | null {
  const kind = nativeAppearancePageKind(url);
  const modern = nativeModernAppearanceRoute(url);
  if (kind === 'progress' || kind === 'schedule' || kind === 'assignments' || modern === 'assignment' || modern === 'calendar' ||
    /^#studentmyday\/assignment-center\/?$/i.test(url.hash)) return 'my-day';
  if (kind === 'resources') return 'group-header-Resources';
  if (kind === 'class') return 'group-header-Classes';
  if (kind === 'directory') return 'directory-subnav';
  if (/^#calendar\/?(?:\?.*)?$/i.test(url.hash)) return 'calendar-subnav';
  return null;
}

function currentTab(url: URL): string | null {
  const modern = nativeModernAppearanceRoute(url);
  if (modern === 'calendar') return 'schedule';
  if (modern === 'assignments' || modern === 'assignment' || /^#studentmyday\/assignment-center\/?$/i.test(url.hash)) return 'assignments';
  if (/^#studentmyday\/progress\/?(?:\?.*)?$/i.test(url.hash)) return 'progress';
  if (/^#studentmyday\/schedule\/?(?:\?.*)?$/i.test(url.hash)) return 'schedule';
  return null;
}

function primaryParts(page: Document, url: URL, modern: boolean, icons: NativeNavigationIconTarget[]): NativeHeaderAppearanceTarget[] {
  const navigation = one(page, '#site-nav-container');
  const list = navigation && one(navigation, '.topnav');
  if (!list) return [];
  const controls = [...list.querySelectorAll<HTMLAnchorElement>(':scope > li > a')];
  const known = new Map(icons.filter(({ control }) => control.closest('.topnav') === list).map((icon) => [icon.control, icon.kind]));
  const targets: NativeHeaderAppearanceTarget[] = [];
  const selected = currentPrimary(url);
  const captions = new Map([['group-header-Classes', 'Classes'], ['group-header-Groups', 'Groups'], ['directory-subnav', 'Directories']]);
  for (const control of controls) {
    const kind = known.get(control);
    const parts = kind && title(control, modern);
    if (!kind || !parts) continue;
    const count = one(parts.description, modern ? ':scope > strong' : ':scope > b');
    const caption = captions.get(control.id);
    const breaks = [...parts.description.querySelectorAll<HTMLElement>(':scope > br')];
    const expectedChildren = count ? modern ? [parts.wrapper, count] : [parts.wrapper, ...breaks, count] : [parts.wrapper];
    const children = [...parts.description.children];
    const text = [...parts.description.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
    const shape = children.length === expectedChildren.length && children.every((child, index) => child === expectedChildren[index]);
    const validCount = !!count && !!caption && !count.children.length && decorative(count) && /^\d+$/.test(count.textContent?.trim() ?? '') &&
      text.toLowerCase() === caption.toLowerCase() && (modern ? breaks.length === 0 : breaks.length === 1 && decorative(breaks[0]!));
    if (!shape || !((!count && !text) || validCount)) continue;
    targets.push({ element: control, part: 'primary-item', current: selected ? (kind === 'house' ? selected === 'my-day' : control.id === selected) : active(control) });
    targets.push({ element: parts.label, part: 'primary-title' }, { element: parts.description, part: 'primary-description' });
    if (count) targets.push({ element: count, part: 'primary-count' });
  }
  if (controls.length === 7 && known.size === 7 && list.children.length === 7 &&
    targets.filter(({ part }) => part === 'primary-item').length === 7 &&
    [...list.children].every((item) => item.tagName === 'LI' && item.querySelectorAll(':scope > a').length === 1)) {
    targets.push({ element: list, part: 'primary-navigation' });
  }
  return targets;
}

function accountParts(control: HTMLAnchorElement, modern: boolean): NativeHeaderAppearanceTarget[] | null {
  const description = one(control, ':scope > .desc');
  const name = description && one(description, ':scope > .title');
  const avatar = one(control, ':scope > .bb-avatar-wrapper-nav');
  if (!name?.textContent?.trim() || !avatar || avatar.children.length !== 1 || avatar.querySelectorAll(':scope > img.bb-avatar-image-nav').length !== 1) return null;
  if (modern) {
    const lines = [...name.children] as HTMLElement[];
    if (lines.length !== 2 || lines.some((line) => line.tagName !== 'DIV' || line.children.length || !line.textContent?.trim()) ||
      [...name.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())) return null;
    return [{ element: name, part: 'account-name', spaceAfter: lines[0] }, ...lines.map((element) => ({ element, part: 'account-name-line' as const }))];
  }
  const breaks = [...name.children] as HTMLElement[];
  if (breaks.length !== 1 || breaks[0]!.tagName !== 'BR' || !decorative(breaks[0]!)) return null;
  const pieces = [...name.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent?.trim()).filter(Boolean);
  if (pieces.length !== 2) return null;
  return [{ element: name, part: 'account-name', spaceAfter: breaks[0] }, { element: breaks[0]!, part: 'account-break' }];
}

function utilityParts(page: Document, url: URL, modern: boolean): NativeHeaderAppearanceTarget[] {
  const header = one(page, '#site-header');
  if (!header?.classList.contains(modern ? 'sky-container' : 'container')) return [];
  const column = one(header, ':scope > .row > .col-md-12');
  if (!column) return [];
  const targets: NativeHeaderAppearanceTarget[] = [];
  const logo = one(column, ':scope > #site-logo.logoimg');
  const brandLink = logo && one<HTMLAnchorElement>(logo, ':scope > a[href]');
  const brandImage = brandLink && one<HTMLImageElement>(brandLink, ':scope > img');
  let brand = false;
  if (logo && page.querySelectorAll('#site-logo').length === 1 && brandLink && brandImage && brandLink.children.length === 1) {
    try {
      const destination = new URL(brandLink.getAttribute('href')!, page.baseURI);
      const source = new URL(brandImage.getAttribute('src') ?? '', page.baseURI);
      brand = ['http:', 'https:'].includes(destination.protocol) && !!brandImage.getAttribute('src') && source.protocol === 'https:' &&
        !destination.username && !destination.password && !source.username && !source.password;
    } catch { /* An unexpected native logo keeps its original layout. */ }
    if (brand) targets.push({ element: logo, part: 'brand' });
  }
  const tools = one(column, modern ? ':scope > #site-user-container > #site-user-nav' : ':scope > #site-user-nav.site-header-nav');
  const list = tools && one(tools, modern ? ':scope > edu-user-nav > ul.topnav.user-nav' : ':scope > div > ul.topnav');
  if (!tools || !list || page.querySelectorAll('#site-user-nav').length !== 1) return targets;
  const controls = [...list.querySelectorAll<HTMLAnchorElement>(':scope > li > a')];
  const actions = new Set<string>();
  for (const control of controls) {
    if (studentDestination(control, url, 'searchresults')) {
      if (controls.filter((candidate) => studentDestination(candidate, url, 'searchresults')).length !== 1) continue;
      const original = one(control, modern ? ':scope > span.search' : ':scope > i.topnav-icon.p3icon-search');
      const validIcon = original && decorative(original) && (modern ? original.children.length === 1 &&
        original.querySelectorAll(':scope > sky-icon[iconname="search"]').length === 1 && decorative(original.children[0] as HTMLElement) :
        !original.children.length && !original.textContent?.trim());
      if (validIcon && !actions.has('search')) {
        actions.add('search');
        targets.push({ element: control, part: 'tool-search', icon: { control, kind: 'search', original } });
        targets.push({ element: original, part: 'tool-icon' });
      }
      continue;
    }
    const notes = studentDestination(control, url, 'message/officialnotes') && (!modern || control.id === 'official-notes');
    const messages = studentDestination(control, url, 'message/inbox') && control.id === 'inbox-link';
    if (notes || messages) {
      const part = notes ? 'notes' : 'messages';
      const count = one(control, `:scope > span.site-badge.${notes && !modern ? 'site-badge-official-notes' : 'site-badge-message'}`);
      const label = title(control, modern)?.label;
      const graphic = control.querySelector(':scope > img, :scope > i, :scope > sky-icon, :scope > svg:not([data-bn-navigation-icon])');
      if (actions.has(part) || !count || count.children.length || !decorative(count) || !/^\d+$/.test(count.textContent?.trim() ?? '') || !label ||
        graphic ||
        controls.filter((candidate) => studentDestination(candidate, url, notes ? 'message/officialnotes' : 'message/inbox')).length !== 1 ||
        ((modern || messages) && page.querySelectorAll(notes ? '#official-notes' : '#inbox-link').length !== 1)) continue;
      actions.add(part);
      targets.push({ element: control, part: notes ? 'tool-notes' : 'tool-messages', icon: { control, kind: notes ? 'file-text' : 'mail', original: null } });
      targets.push({ element: count, part: 'tool-count' }, { element: label, part: 'tool-label' });
      continue;
    }
    if (control.id === 'account-nav' && control.getAttribute('href') === '#' && destination(control, url) && page.querySelectorAll('#account-nav').length === 1) {
      const account = accountParts(control, modern);
      if (!account || actions.has('account')) continue;
      actions.add('account');
      targets.push({ element: control, part: 'tool-account' }, ...account);
    }
  }
  if (actions.size === 4 && controls.length === 4 && list.children.length === 4 &&
    [...list.children].every((item) => item.tagName === 'LI' && item.querySelectorAll(':scope > a').length === 1)) {
    targets.push({ element: tools, part: 'tools' }, { element: list, part: 'tools-list' });
    if (brand) targets.push({ element: column, part: 'masthead-column' });
  }
  return targets;
}

function lowerParts(url: URL, icons: NativeNavigationIconTarget[]): NativeHeaderAppearanceTarget[] {
  const classes = new Map([['p3icon-progress', 'progress'], ['p3icon-schedule', 'schedule'], ['p3icon-assignments', 'assignments'], ['p3icon-courseRequest', 'courses']]);
  const lower = icons.flatMap((target) => {
    const kind = target.original && [...target.original.classList].map((name) => classes.get(name)).find(Boolean);
    return kind ? [{ ...target, tab: kind }] : [];
  });
  const selected = currentTab(url);
  const targets: NativeHeaderAppearanceTarget[] = lower.map(({ control, tab }) => ({
    element: control, part: 'tab-item', current: selected ? selected === tab : active(control),
  }));
  const lists = new Set(lower.map(({ control }) => control.closest('ul')).filter((list): list is HTMLUListElement => list !== null));
  for (const list of lists) {
    const controls = [...list.querySelectorAll<HTMLAnchorElement>(':scope > li > a')];
    if (controls.length === 4 && list.children.length === 4 && lower.filter(({ control }) => controls.includes(control)).length === 4 &&
      [...list.children].every((item) => item.tagName === 'LI' && item.children.length === 1 && item.querySelectorAll(':scope > a').length === 1 &&
        ![...item.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()))) {
      targets.push({ element: list, part: 'tabs-navigation' });
    }
  }
  return targets;
}

function lowerNavigationVerified(page: Document, targets: NativeHeaderAppearanceTarget[]): boolean {
  const lists = targets.filter(({ part }) => part === 'tabs-navigation').map(({ element }) => element);
  const controls = new Set(targets.filter(({ part }) => part === 'tab-item').map(({ element }) => element));
  const actionable = 'a[href], button, input, select, textarea, summary, [onclick], [tabindex], ' +
    '[contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], ' +
    '[role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="slider"], [role="spinbutton"]';
  for (const id of ['site-nav-lower', 'site-nav-bottom']) {
    const roots = page.querySelectorAll<HTMLElement>(`#${id}`);
    if (roots.length > 1) return false;
    const root = roots[0];
    if (!root) continue;
    if (root.matches(actionable)) return false;
    const knownLists = lists.filter((list) => root.contains(list));
    for (const control of root.querySelectorAll<HTMLElement>(actionable)) {
      if (!controls.has(control) || !knownLists.some((list) => list.contains(control))) return false;
    }
    const text = page.createTreeWalker(root, 4);
    for (let node = text.nextNode(); node; node = text.nextNode()) {
      if (node.textContent?.trim() && !knownLists.some((list) => list.contains(node))) return false;
    }
  }
  return true;
}

function meaningfulDirectText(element: HTMLElement): boolean {
  return [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim());
}

function menuListParts(list: HTMLElement): NativeHeaderAppearanceTarget[] | null {
  if (list.tagName !== 'UL' || meaningfulDirectText(list)) return null;
  const targets: NativeHeaderAppearanceTarget[] = [{ element: list, part: list.classList.contains('subnavfooter') ? 'dropdown-footer' : 'dropdown-list' }];
  const nestedAction = 'a, button, input, select, textarea, summary, [onclick], [tabindex], [aria-controls], [aria-haspopup], ' +
    '[contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], ' +
    '[role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="textbox"], ' +
    '[role="slider"], [role="spinbutton"]';
  for (const row of list.children as HTMLCollectionOf<HTMLElement>) {
    if (row.tagName !== 'LI' || meaningfulDirectText(row)) return null;
    if ((row.classList.contains('divider') || row.classList.contains('sep')) && !row.children.length && !row.textContent?.trim() && decorative(row)) {
      targets.push({ element: row, part: 'dropdown-divider' });
      continue;
    }
    const heading = row.classList.contains('divider-label') && one(row, ':scope > h6');
    if (heading && row.children.length === 1 && heading.textContent?.trim() && !heading.querySelector(nestedAction) && decorative(row) && decorative(heading)) {
      targets.push({ element: row, part: 'dropdown-heading' });
      continue;
    }
    const link = one<HTMLAnchorElement>(row, ':scope > a[href]');
    if (!link || row.children.length !== 1 || !link.textContent?.trim() || link.querySelector(nestedAction)) return null;
    targets.push({ element: link, part: 'dropdown-link' });
  }
  return targets;
}

/** A menu must belong directly to one verified header action, never a body menu. */
function dropdownParts(targets: NativeHeaderAppearanceTarget[]): NativeHeaderAppearanceTarget[] {
  const controls = targets.filter(({ part }) => part === 'primary-item' || part === 'tool-search' || part === 'tool-account');
  const result: NativeHeaderAppearanceTarget[] = [];
  for (const { element: control, part } of controls) {
    const item = control.parentElement;
    if (item?.tagName !== 'LI' || item.querySelectorAll(':scope > a').length !== 1) continue;
    const menu = one(item, ':scope > div.subnav');
    if (!menu || meaningfulDirectText(menu)) continue;
    const parts: NativeHeaderAppearanceTarget[] = [];
    let verified = true;
    for (const child of menu.children as HTMLCollectionOf<HTMLElement>) {
      if (child.tagName === 'UL') {
        const list = menuListParts(child);
        if (!list) { verified = false; break; }
        parts.push(...list);
        continue;
      }
      // The separate class-navigation feature owns and validates its toolbar.
      if (control.id === 'group-header-Classes' && menu.hasAttribute('data-blackbaud-next-class-menu') &&
        child.matches('div.bn-class-search[role="search"]')) continue;
      if (part === 'tool-search' && child.tagName === 'DIV' && child.children.length === 1 && !meaningfulDirectText(child)) {
        const input = one<HTMLInputElement>(child, ':scope > input#site-search-input');
        if (input && ['text', 'search'].includes(input.type) && menu.querySelectorAll('#site-search-input').length === 1) {
          parts.push({ element: child, part: 'dropdown-search' });
          continue;
        }
      }
      verified = false;
      break;
    }
    if (!verified) continue;
    const classes = control.id === 'group-header-Classes' && menu.classList.contains('subnav-multicol');
    result.push({ element: menu, part: classes ? 'dropdown-classes' : 'dropdown' }, ...parts);
    const pointer = one(item, ':scope > div.subnavtop');
    if (pointer && !pointer.children.length && !pointer.textContent?.trim() && decorative(pointer)) {
      result.push({ element: pointer, part: 'dropdown-pointer' });
    }
  }
  return result;
}

/** Cosmetic targets preserve native nodes, text, destinations and actions. */
export function nativeHeaderAppearanceTargets(page: Document, url: URL, navigation: NativeAppearanceNavigation = nativeAppearanceNavigation(page, url)): NativeHeaderAppearanceTarget[] {
  if (!navigation.shell) return [];
  const modern = navigation.shell === 'modern';
  const icons = navigation.icons;
  const targets = [...utilityParts(page, url, modern), ...primaryParts(page, url, modern, icons), ...lowerParts(url, icons)];
  targets.push(...dropdownParts(targets));
  const spacer = one(page, '#site-top-spacer');
  const knownSpacer = spacer?.classList.contains('site-top-spacer') || (modern && spacer?.matches('.white-bg.site-top-spacer-lower-nav'));
  if (targets.some(({ part }) => part === 'masthead-column') && targets.some(({ part }) => part === 'primary-navigation') &&
    lowerNavigationVerified(page, targets) &&
    knownSpacer && spacer?.tagName === 'DIV' && !spacer.children.length && !spacer.textContent?.trim() &&
    spacer.parentElement?.contains(page.querySelector('#site-header')) && spacer.parentElement.contains(page.querySelector('#site-nav-container'))) {
    targets.push({ element: spacer, part: 'spacer' });
  }
  return targets;
}
