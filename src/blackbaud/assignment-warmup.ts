import { isAssignmentCenter, isLmsPage, isSchoolPage } from './routes.ts';

export const ASSIGNMENT_WARMUP_SOURCE_SELECTOR = '#accordionSchedules, #assignment-center-btn';

export function isAssignmentWarmupSource(url: URL): boolean {
  return isSchoolPage(url) && /^\/app\/student\/?$/.test(url.pathname) &&
    /^#studentmyday\/schedule\/?(?:\?.*)?$/.test(url.hash);
}

export function isAssignmentWarmupPage(url: URL): boolean {
  return isLmsPage(url) && !url.username && !url.password && !isAssignmentCenter(url) &&
    !/^#studentmyday\/assignment-center(?:\/|\?|$)/.test(url.hash);
}

export function assignmentWarmupDestination(link: HTMLAnchorElement, source: URL): string | null {
  if (!isAssignmentWarmupPage(source)) return null;
  const href = link.getAttribute('href');
  if (!href || href.includes('#')) return null;
  try {
    const destination = new URL(href, link.ownerDocument.baseURI);
    if (destination.origin !== source.origin || destination.protocol !== 'https:' || destination.username || destination.password ||
      !/^\/lms-assignment\/assignment-center\/student\/?$/.test(destination.pathname) ||
      destination.search !== '?svcid=edu' || destination.hash) return null;
    // Speculation Rules and the native anchor resolve this same original href.
    return href;
  } catch {
    return null;
  }
}

export function assignmentWarmupDestinationKey(href: string, page: Document = document): string {
  const destination = new URL(href, page.baseURI);
  // Validated native trailing-slash aliases identify the same student center.
  return `${destination.origin}${destination.pathname.replace(/\/$/, '')}${destination.search}`;
}

export function assignmentWarmupIntentLink(event: Event, page: Document = document): HTMLAnchorElement | null {
  const Element = page.defaultView?.Element;
  if (!Element || !(event.target instanceof Element)) return null;
  return event.target.closest<HTMLAnchorElement>('a[href]');
}

export function assignmentWarmupConnection(page: Document = document): ({ saveData?: boolean } & Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>>) | undefined {
  return (page.defaultView?.navigator as Navigator & { connection?: ReturnType<typeof assignmentWarmupConnection> } | undefined)?.connection;
}

export function supportsAssignmentWarmup(page: Document = document): boolean {
  try { return page.defaultView?.HTMLScriptElement.supports?.('speculationrules') === true; } catch { return false; }
}

export function canPrepareAssignmentCenter(page: Document = document): boolean {
  return supportsAssignmentWarmup(page) && page.visibilityState === 'visible' &&
    !(page as Document & { prerendering?: boolean }).prerendering && assignmentWarmupConnection(page)?.saveData !== true;
}

export function assignmentWarmupRules(destination: string): string {
  return JSON.stringify({ prerender: [{ source: 'list', urls: [destination], eagerness: 'immediate' }] });
}
