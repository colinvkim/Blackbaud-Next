export const ASSIGNMENT_LOADING_MASK_SELECTOR = '.sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking';
const errorSelector = '.sky-error, .sky-error-page, .sky-error-title, .alert-danger';

export function isAssignmentLoadingVisible(element: Element): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

export function hasVisibleAssignmentError(page: Document): boolean {
  return [...page.querySelectorAll(errorSelector)].some(isAssignmentLoadingVisible);
}
