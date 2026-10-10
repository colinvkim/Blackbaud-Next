import { isSchoolPage } from './routes.ts';

export const ASSIGNMENT_WARMUP_SOURCE_SELECTOR = '#accordionSchedules, #assignment-center-btn';

export function isAssignmentWarmupSource(url: URL): boolean {
  return isSchoolPage(url) && /^\/app\/student\/?$/.test(url.pathname) &&
    /^#studentmyday\/schedule\/?(?:\?.*)?$/.test(url.hash);
}

export function assignmentWarmupDestination(link: HTMLAnchorElement, source: URL): string | null {
  if (!isAssignmentWarmupSource(source)) return null;
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

export function supportsAssignmentWarmup(page: Document = document): boolean {
  try { return page.defaultView?.HTMLScriptElement.supports?.('speculationrules') === true; } catch { return false; }
}

export function canPrepareAssignmentCenter(page: Document = document): boolean {
  const browser = page.defaultView;
  const connection = (browser?.navigator as Navigator & { connection?: { saveData?: boolean } } | undefined)?.connection;
  return supportsAssignmentWarmup(page) && page.visibilityState === 'visible' &&
    !(page as Document & { prerendering?: boolean }).prerendering && connection?.saveData !== true;
}

export function assignmentWarmupRules(destination: string): string {
  return JSON.stringify({ prerender: [{ source: 'list', urls: [destination], eagerness: 'immediate' }] });
}
