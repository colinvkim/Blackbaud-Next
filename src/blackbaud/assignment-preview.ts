import { ASSIGNMENT_LINK_SELECTOR, assignmentTitleLinkUrl } from './assignment-list.ts';
import { isActionable } from '../shared/dom.ts';

export interface AssignmentAttachment {
  name: string;
  url: string;
}

export interface AssignmentPreview {
  title: string;
  instructions: string;
  due: string;
  course: string;
  attachments: AssignmentAttachment[];
}

export interface AssignmentPreviewTarget {
  assignmentIndexId: string;
  detailsUrl: string;
  title: string;
}

export const ASSIGNMENT_PREVIEW_LINK_SELECTOR = ASSIGNMENT_LINK_SELECTOR;

function validIndexId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export function assignmentPreviewTarget(link: HTMLAnchorElement, base: string): AssignmentPreviewTarget | null {
  try {
    const url = assignmentTitleLinkUrl(link);
    if (!url || url.origin !== new URL(base).origin || url.protocol !== 'https:' || url.username || url.password) return null;
    const route = url.pathname.match(/^\/lms-assignment\/assignment\/assignment-student-view\/([1-9]\d*)\/?$/);
    if (!route?.[1] || !validIndexId(route[1])) return null;
    return { assignmentIndexId: route[1], detailsUrl: url.href, title: link.textContent?.trim().slice(0, 300) || 'Assignment' };
  } catch { return null; }
}

export function assignmentPreviewReturnFocus(page: Document): HTMLElement | null {
  const selected = [...page.querySelectorAll<HTMLElement>('.bn-assignment-shortcuts button[aria-pressed="true"]')].find(isActionable);
  if (selected) return selected;
  return [...page.querySelectorAll<HTMLElement>('sky-toolbar input[aria-label="Search items"]')].find(isActionable) ?? null;
}

const allowedTags = new Set(['P', 'BR', 'B', 'STRONG', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'CODE', 'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'HR', 'A', 'DIV', 'SPAN']);
const discardedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'SVG', 'MATH', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'TEMPLATE', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'SOURCE', 'IMG']);

export function safeAssignmentUrl(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    const origin = new URL(base);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && origin.protocol === 'http:' && url.origin === origin.origin))) return null;
    return url.href;
  } catch { return null; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, length = 1000): string {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

export function currentStudentUserId(payload: unknown): number {
  const user = record(record(payload)?.UserInfo);
  const id = user?.UserId;
  if (!user || user.DefaultPersonaId !== 2 || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Assignment previews require the current student account.');
  }
  return id;
}

export function normalizeAssignmentPreview(payload: unknown, target: AssignmentPreviewTarget): AssignmentPreview {
  const assignment = record(payload);
  if (!assignment || typeof assignment.AssignmentIndexId !== 'number' || !Number.isSafeInteger(assignment.AssignmentIndexId) ||
    String(assignment.AssignmentIndexId) !== target.assignmentIndexId || !text(assignment.ShortDescription)) {
    throw new Error('The assignment response has an unsupported format.');
  }
  const attachments: AssignmentAttachment[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(assignment.LinkItems) ? assignment.LinkItems.slice(0, 100) : []) {
    const item = record(value);
    const url = safeAssignmentUrl(item?.Url, target.detailsUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    attachments.push({ name: text(item?.ShortDescription, 300) || 'Assignment link', url });
  }
  for (const value of Array.isArray(assignment.DownloadItems) ? assignment.DownloadItems.slice(0, 100) : []) {
    const item = record(value);
    const url = safeAssignmentUrl(item?.DownloadUrl, target.detailsUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    attachments.push({ name: text(item?.ShortDescription, 300) || text(item?.FriendlyFileName, 300) || 'Assignment attachment', url });
  }
  return {
    title: text(assignment.ShortDescription, 300),
    instructions: typeof assignment.LongDescription === 'string' ? assignment.LongDescription.slice(0, 200_000) : '',
    due: text(assignment.DueDate, 100),
    course: text(assignment.GroupName, 300),
    attachments,
  };
}

async function assignmentJson(path: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetch(path, { credentials: 'same-origin', signal, redirect: 'error', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`The assignment could not be loaded (${response.status}).`);
  const payload: unknown = await response.json();
  signal.throwIfAborted();
  return payload;
}

export async function fetchAssignmentPreview(target: AssignmentPreviewTarget, signal: AbortSignal): Promise<AssignmentPreview> {
  const details = new URL(target.detailsUrl);
  if (!validIndexId(target.assignmentIndexId) || details.origin !== window.location.origin || details.protocol !== 'https:' || details.username || details.password ||
    (details.pathname !== `/lms-assignment/assignment/assignment-student-view/${target.assignmentIndexId}` &&
      details.pathname !== `/lms-assignment/assignment/assignment-student-view/${target.assignmentIndexId}/`)) {
    throw new Error('The assignment identifier is invalid.');
  }
  const studentUserId = currentStudentUserId(await assignmentJson('/api/webapp/context', signal));
  const path = `/api/assignment2/UserAssignmentDetailsGetAllStudentData?assignmentIndexId=${target.assignmentIndexId}&studentUserId=${studentUserId}&personaId=2`;
  return normalizeAssignmentPreview(await assignmentJson(path, signal), target);
}

// Build fresh nodes rather than inserting LMS HTML into the live document. The
// inert template is never attached, and none of its attributes are copied.
export function assignmentInstructions(html: string, base: string, page: Document = document): DocumentFragment {
  const source = page.createElement('template');
  source.innerHTML = html.slice(0, 200_000);
  const result = page.createDocumentFragment();
  const append = (node: Node, parent: Node, depth = 0) => {
    if (depth > 100) return;
    if (node.nodeType === 3) {
      parent.appendChild(page.createTextNode(node.textContent ?? ''));
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toUpperCase();
    if (discardedTags.has(tag)) return;
    let destination = parent;
    if (allowedTags.has(tag)) {
      const clean = page.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = safeAssignmentUrl(element.getAttribute('href'), base);
        if (href) {
          clean.setAttribute('href', href);
          clean.setAttribute('target', '_blank');
          clean.setAttribute('rel', 'noopener noreferrer');
        }
      }
      parent.appendChild(clean);
      destination = clean;
    }
    for (const child of element.childNodes) append(child, destination, depth + 1);
  };
  for (const child of source.content.childNodes) append(child, result);
  return result;
}
