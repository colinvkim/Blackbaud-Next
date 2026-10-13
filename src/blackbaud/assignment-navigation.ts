import { isLmsPage } from './routes.ts';

export const ASSIGNMENT_DETAILS_SELECTOR = 'app-assignment-view-details';

export function isAssignmentDetail(url: URL): boolean {
  return isLmsPage(url) && !url.username && !url.password &&
    /^\/lms-assignment\/assignment\/assignment-student-view\/[1-9]\d*\/?$/.test(url.pathname);
}

export function assignmentCenterUrl(url: URL): string {
  return new URL('/lms-assignment/assignment-center/student/?svcid=edu', url).href;
}

export function assignmentBreadcrumbLinks(root: HTMLElement): HTMLAnchorElement[] {
  if (!root.matches(ASSIGNMENT_DETAILS_SELECTOR)) return [];
  return [...root.querySelectorAll<HTMLAnchorElement>('h1.sky-theme-font-heading-1.display-inline > a')].filter((link) =>
    link.closest(ASSIGNMENT_DETAILS_SELECTOR) === root &&
    link.textContent?.replace(/\s+/g, ' ').trim() === 'Assignments',
  );
}

export function isNativeAssignmentBackLink(link: HTMLAnchorElement): boolean {
  return /^javascript:\s*(?:window\.)?history\.back\(\s*\)\s*;?\s*$/i.test(link.getAttribute('href')?.trim() ?? '');
}
