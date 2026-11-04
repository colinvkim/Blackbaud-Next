import { isLmsPage, isStudentPortal } from './routes.ts';
import { isActionable } from '../shared/dom.ts';

export const ASSIGNMENT_VIEW_SELECTOR = 'sky-radio-group[name="viewMode"]';

export function isStudentAssignmentCenter(url: URL): boolean {
  return isLmsPage(url) && url.pathname.replace(/\/$/, '') === '/lms-assignment/assignment-center/student';
}

export function assignmentViewControls(group: HTMLElement) {
  const root = group.closest<HTMLElement>('app-student-assignment-center');
  const toolbar = group.closest<HTMLElement>('sky-toolbar');
  const fieldset = group.querySelector<HTMLFieldSetElement>('fieldset[role="radiogroup"]');
  const icons = fieldset?.querySelector<HTMLElement>('.sky-switch-icon-group');
  const inputs = [...group.querySelectorAll<HTMLInputElement>('input[name="viewMode"]')].filter(input => !input.closest('.bn-classic-view-label[data-bn-owned]'));
  if (!root || !toolbar || !fieldset || !icons || inputs.length !== 2 ||
    root.querySelectorAll('sky-radio-group[name="viewMode"]').length !== 1 ||
    !inputs.every(input => input.type === 'radio' && icons.contains(input)) ||
    !inputs.some(input => input.value === '0') || !inputs.some(input => input.value === '1')) return null;
  return { root, toolbar, fieldset, icons, inputs };
}

export function isClassicAssignmentCenter(url: URL): boolean {
  return isStudentPortal(url) && url.hash === '#studentmyday/assignment-center';
}

export function hasClassicAssignmentDialog(page: Document): boolean {
  const modal = page.querySelector<HTMLElement>('#site-modal.modal');
  return modal !== null && isActionable(modal);
}

export function classicAssignmentContent(page: Document): HTMLElement | null {
  const roots = page.querySelectorAll<HTMLElement>('#site-main #assignment-center');
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const list = root.querySelector('#assignment-center-header-view .assignment-calendar-header') &&
    root.querySelector('#assignment-center-content-view');
  const grid = root.querySelector('#calendar-main-view #calendar-header-container .assignment-calendar-header') &&
    root.querySelector('#calendar-main-view #calendar-container.fc');
  return list || grid ? root : null;
}
