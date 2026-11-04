import { isElementVisible } from '../shared/dom.ts';

export const ASSIGNMENT_LOADING_MASK_SELECTOR = '.sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking';
const errorSelector = '.sky-error, .sky-error-page, .sky-error-title, .alert-danger';

export function hasVisibleAssignmentError(page: Document): boolean {
  return [...page.querySelectorAll(errorSelector)].some(isElementVisible);
}
