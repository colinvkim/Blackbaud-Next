export type AssignmentShortcut = 'all' | 'unfinished' | 'today' | 'tomorrow';

export const ASSIGNMENT_LINK_SELECTOR = 'app-assignment-title-link a[href]';
export const ASSIGNMENT_ROW_SELECTOR = 'sky-repeater-item.assignment-repeater-item';
export const ASSIGNMENT_TOOLBAR_SELECTOR = 'sky-toolbar:has(input[aria-label="Search items"])';

export interface NativeAssignmentRow {
  element: HTMLElement;
  group: HTMLElement | null;
  link: HTMLAnchorElement;
  title: string;
  dueDate: string | null;
  status: string;
  finished: boolean;
}

export function assignmentTitleLinkUrl(link: HTMLAnchorElement): URL | null {
  try {
    const url = new URL(link.getAttribute('href') ?? '', link.ownerDocument.baseURI);
    const page = new URL(link.ownerDocument.URL);
    return url.origin === page.origin && /^\/lms-assignment\/assignment\/assignment-student-view\/[1-9]\d*\/?$/.test(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

export function isFinishedAssignmentStatus(status: string): boolean {
  return /^(?:completed|submitted|graded)$/i.test(status.trim());
}

export function readAssignmentRows(root: Document | Element): NativeAssignmentRow[] {
  const rows: NativeAssignmentRow[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(ASSIGNMENT_ROW_SELECTOR)) {
    const links = [...element.querySelectorAll<HTMLAnchorElement>(ASSIGNMENT_LINK_SELECTOR)].filter((link) =>
      link.closest(ASSIGNMENT_ROW_SELECTOR) === element && assignmentTitleLinkUrl(link),
    );
    if (links.length !== 1) continue;
    const link = links[0]!;
    const details = element.querySelector<HTMLElement>('.assignment-center-middle-block > div.assignment-details.sky-font-deemphasized');
    // Assigned dates and other metadata share this block. Only its labeled Due
    // field is a source; missing/unsupported dates remain unknown.
    const dueText = details?.textContent?.split('|').map((field) => field.trim()).find((field) => /^Due:\s*/i.test(field));
    const status = element.querySelector('app-assignment-status-display button')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    rows.push({
      element,
      group: element.parentElement?.closest<HTMLElement>('sky-repeater-item') ?? null,
      link,
      title: link.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      dueDate: dueText ? parseAssignmentDate(dueText.replace(/^Due:\s*/i, '')) : null,
      status,
      finished: isFinishedAssignmentStatus(status),
    });
  }
  return rows;
}

export function isNativeAssignmentVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const view = element.ownerDocument.defaultView;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

/** A calendar key in the student's local timezone, rather than an UTC date. */
export function localAssignmentDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validatedDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return localAssignmentDate(date);
}

/** Only read explicit calendar dates; avoid browser-dependent Date.parse guesses. */
export function parseAssignmentDate(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (iso) return validatedDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})\/(\d{4})(?=$|\s|,)/);
  if (numeric) return validatedDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
  const named = text.match(/(?:^|\s)(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (\d{1,2}),? (\d{4})(?=$|\s|,)/i);
  if (!named) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return validatedDate(Number(named[3]), months.indexOf(named[1]!.slice(0, 3).toLowerCase()) + 1, Number(named[2]));
}

export function assignmentShortcutDate(shortcut: AssignmentShortcut, now: Date): string | null {
  if (shortcut !== 'today' && shortcut !== 'tomorrow') return null;
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (shortcut === 'tomorrow') date.setDate(date.getDate() + 1);
  return localAssignmentDate(date);
}

export function matchesAssignmentShortcut(row: Pick<NativeAssignmentRow, 'dueDate' | 'finished'>, shortcut: AssignmentShortcut, now: Date): boolean {
  if (shortcut === 'all') return true;
  if (shortcut === 'unfinished') return !row.finished;
  const date = assignmentShortcutDate(shortcut, now);
  return date !== null && row.dueDate === date;
}
