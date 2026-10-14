import { ASSIGNMENT_ROW_SELECTOR, assignmentTitleLinkUrl, readAssignmentRow } from './assignment-list.ts';
import { ASSIGNMENT_STATUS_REQUEST_EVENT, ASSIGNMENT_STATUS_RESPONSE_EVENT, assignmentStatusResponse, isAssignmentStatusPage } from './assignment-status-protocol.ts';

export type ManualAssignmentStatus = 'todo' | 'in-progress' | 'completed' | 'overdue';
export const COMPLETION_NATIVE_ATTRIBUTE = 'data-blackbaud-next-completion-native';
export const completionSettledEvent = 'blackbaud-next:assignment-completion-settled';

export interface AssignmentCompletionTarget {
  assignmentIndexId: string;
  row: HTMLElement;
  component: HTMLElement;
  button: HTMLButtonElement;
  status: ManualAssignmentStatus;
  title: string;
}

export class AssignmentCompletionError extends Error {
  readonly kind: 'unsupported' | 'failed' | 'unconfirmed' | 'busy';

  constructor(kind: AssignmentCompletionError['kind'], message: string) {
    super(message);
    this.name = 'AssignmentCompletionError';
    this.kind = kind;
  }
}

const statuses = [
  { status: 'todo', value: -1, label: 'To do' },
  { status: 'in-progress', value: 0, label: 'In progress' },
  { status: 'completed', value: 1, label: 'Completed' },
  { status: 'overdue', value: 2, label: 'Overdue' },
] as const;
const MODAL_SELECTOR = 'app-status-change-modal';
const MODAL_ATTRIBUTE = 'data-blackbaud-next-completion-modal';
const shortcutHiddenAttribute = 'data-blackbaud-next-shortcut-hidden';
interface CompletionOperation {
  assignmentIndexId: string;
  backgroundMask: { background: HTMLElement; root: HTMLElement; host: HTMLElement; token: string } | null;
}

const operations = new WeakMap<Document, CompletionOperation>();

export function isAssignmentCompletionPage(url: URL): boolean {
  return isAssignmentStatusPage(url);
}

function label(element: Element): string {
  return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function isUnfinished(status: ManualAssignmentStatus): boolean {
  return status === 'todo' || status === 'overdue';
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The assignment change was canceled.', 'AbortError');
}

function nativeAvailable(element: HTMLElement, component?: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const page = element.ownerDocument;
  const mask = operations.get(page)?.backgroundMask;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const ownedMask = current === mask?.background && current.parentElement === page.body && mask.root.isConnected &&
      mask.root.parentElement === mask.host && mask.root.getAttribute(MODAL_ATTRIBUTE) === mask.token &&
      mask.host.parentElement === page.body && mask.host.getAttribute(MODAL_ATTRIBUTE) === mask.token;
    if (current.hasAttribute('hidden') || (current.getAttribute('aria-hidden') === 'true' && !ownedMask) || current.hasAttribute('inert') ||
      current.hasAttribute('disabled') || current.getAttribute('aria-disabled') === 'true') return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    const ownedHidden = (current === component && current.hasAttribute(COMPLETION_NATIVE_ATTRIBUTE)) ||
      current.getAttribute(shortcutHiddenAttribute) === 'true';
    if ((style?.display === 'none' && !ownedHidden) || style?.visibility === 'hidden' || style?.visibility === 'collapse' ||
      current.style.display === 'none') return false;
  }
  return true;
}

export function readAssignmentCompletionTarget(row: HTMLElement): AssignmentCompletionTarget | null {
  const page = row.ownerDocument;
  if (!isAssignmentCompletionPage(new URL(page.URL)) || !row.matches(ASSIGNMENT_ROW_SELECTOR)) return null;
  const parsed = readAssignmentRow(row);
  const details = parsed && assignmentTitleLinkUrl(parsed.link);
  const assignmentIndexId = details?.pathname.match(/\/([1-9]\d*)\/?$/)?.[1];
  if (!parsed || !assignmentIndexId || !Number.isSafeInteger(Number(assignmentIndexId))) return null;
  const components = [...row.querySelectorAll<HTMLElement>('app-assignment-status-display')].filter((element) => element.closest(ASSIGNMENT_ROW_SELECTOR) === row);
  if (components.length !== 1) return null;
  const component = components[0]!;
  const buttons = component.querySelectorAll('button');
  const button = buttons[0];
  const Button = page.defaultView?.HTMLButtonElement;
  if (buttons.length !== 1 || !Button || !(button instanceof Button) || !nativeAvailable(button, component)) return null;
  const status = statuses.find((candidate) => candidate.label.toLowerCase() === label(button).toLowerCase())?.status;
  return status ? { assignmentIndexId, row, component, button, status, title: parsed.title } : null;
}

export function isAssignmentCompletionBusy(id?: string): boolean {
  const active = operations.get(document);
  return !!active && (id === undefined || active.assignmentIndexId === id);
}

interface NativeModal {
  root: HTMLElement;
  host: HTMLElement;
  save: HTMLButtonElement;
  cancel: HTMLButtonElement;
  radios: Map<ManualAssignmentStatus, HTMLInputElement>;
  previous: ManualAssignmentStatus;
}

function readModal(root: HTMLElement): NativeModal | null {
  const page = root.ownerDocument;
  const Input = page.defaultView?.HTMLInputElement;
  const Button = page.defaultView?.HTMLButtonElement;
  const host = root.parentElement;
  if (!Input || !Button || host?.tagName !== 'SKY-MODAL-HOST' || host.parentElement !== page.body) return null;
  const radios = new Map<ManualAssignmentStatus, HTMLInputElement>();
  let previous: ManualAssignmentStatus | null = null;
  let radioName: string | null = null;
  for (const element of root.querySelectorAll('input[type="radio"]')) {
    if (!(element instanceof Input) || element.closest(MODAL_SELECTOR) !== root) return null;
    const definition = statuses.find((candidate) => String(candidate.value) === element.value && label(element.closest('sky-radio') ?? element) === candidate.label);
    if (!definition || radios.has(definition.status) || element.disabled || element.getAttribute('aria-label') !== definition.label ||
      !element.name || (radioName !== null && element.name !== radioName)) return null;
    radioName = element.name;
    radios.set(definition.status, element);
    if (element.checked) {
      if (previous) return null;
      previous = definition.status;
    }
  }
  const saves = root.querySelectorAll('#print-button');
  const cancels = root.querySelectorAll('#cancel-button');
  const save = saves[0];
  const cancel = cancels[0];
  if (!previous || !radios.has('in-progress') || !radios.has('completed') || (radios.has('todo') === radios.has('overdue')) ||
    radios.size !== 3 || saves.length !== 1 || cancels.length !== 1 || !(save instanceof Button) || !(cancel instanceof Button) ||
    save.type !== 'button' || cancel.type !== 'button' || save.closest(MODAL_SELECTOR) !== root || cancel.closest(MODAL_SELECTOR) !== root ||
    label(save) !== 'Save' || label(cancel) !== 'Cancel' || save.disabled || cancel.disabled ||
    save.getAttribute('aria-disabled') === 'true' || cancel.getAttribute('aria-disabled') === 'true') return null;
  return { root, host, save, cancel, radios, previous };
}

export function setAssignmentCompletion(
  target: AssignmentCompletionTarget,
  desired: 'completed' | 'unfinished' | ManualAssignmentStatus,
  signal: AbortSignal,
): Promise<{ previous: ManualAssignmentStatus; current: ManualAssignmentStatus }> {
  const page = target.row.ownerDocument;
  const view = page.defaultView;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (!view || operations.has(page)) return Promise.reject(new AssignmentCompletionError('busy', 'Another assignment is being saved.'));
  const browser = view;
  const current = readAssignmentCompletionTarget(target.row);
  if (!current || current.assignmentIndexId !== target.assignmentIndexId || current.button !== target.button || current.status !== target.status ||
    page.querySelector(MODAL_SELECTOR)) return Promise.reject(new AssignmentCompletionError('unsupported', 'Use the native assignment status control.'));

  const root = target.row.closest<HTMLElement>('app-root');
  const background = root?.parentElement === page.body && root.getAttribute('aria-hidden') !== 'true' ? root : null;
  const operation: CompletionOperation = { assignmentIndexId: target.assignmentIndexId, backgroundMask: null };
  operations.set(page, operation);
  const token = crypto.randomUUID();
  const initialUrl = page.URL;
  const focused = page.activeElement;
  return new Promise((resolve, reject) => {
    let modal: NativeModal | null = null;
    let ownedRoot: HTMLElement | null = null;
    let ownedHost: HTMLElement | null = null;
    let style: HTMLStyleElement | null = null;
    let saved = false;
    let sent = false;
    let acknowledged = false;
    let ready = false;
    let settled = false;
    let released = false;
    let closingRequested = false;
    let terminalError: AssignmentCompletionError | null = null;
    let requested: ManualAssignmentStatus | null = null;
    let previous: ManualAssignmentStatus | null = null;
    let deadline: ReturnType<typeof setTimeout>;
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    let confirmationDeadline: ReturnType<typeof setTimeout> | undefined;
    const observer = new browser.MutationObserver(() => check());
    const observe = () => observer.observe(page, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'disabled', 'aria-disabled', 'hidden', 'aria-hidden', 'inert', 'href'] });
    const targetUnchanged = () => {
      const current = readAssignmentCompletionTarget(target.row);
      return page.URL === initialUrl && current?.assignmentIndexId === target.assignmentIndexId &&
        current.button === target.button && current.status === target.status;
    };
    const ownsModal = () => !!ownedRoot?.isConnected && ownedRoot.parentElement === ownedHost && ownedHost?.parentElement === page.body &&
      ownedRoot.getAttribute(MODAL_ATTRIBUTE) === token && ownedHost.getAttribute(MODAL_ATTRIBUTE) === token;
    const request = (action: 'arm' | 'cancel') => page.dispatchEvent(new browser.CustomEvent(ASSIGNMENT_STATUS_REQUEST_EVENT, {
      detail: JSON.stringify(action === 'arm'
        ? { action, token, assignmentIndexId: Number(target.assignmentIndexId), assignmentStatus: statuses.find((status) => status.status === requested)!.value }
        : { action, token }),
    }));
    const restorePresentation = (removeOwnership = true) => {
      style?.remove();
      style = null;
      if (removeOwnership && ownedRoot?.getAttribute(MODAL_ATTRIBUTE) === token) ownedRoot.removeAttribute(MODAL_ATTRIBUTE);
      if (removeOwnership && ownedHost?.getAttribute(MODAL_ATTRIBUTE) === token) ownedHost.removeAttribute(MODAL_ATTRIBUTE);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(readinessTimer);
      restorePresentation(false);
      if (error) reject(error);
      else if (previous && requested) resolve({ previous, current: requested });
    };
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(deadline);
      clearTimeout(readinessTimer);
      readinessTimer = undefined;
      clearTimeout(confirmationDeadline);
      observer.disconnect();
      page.removeEventListener(ASSIGNMENT_STATUS_RESPONSE_EVENT, response);
      page.removeEventListener('pointerdown', competingIntent, true);
      page.removeEventListener('keydown', competingIntent, true);
      signal.removeEventListener('abort', abort);
      browser.removeEventListener('pagehide', departed);
      browser.removeEventListener('hashchange', navigation);
      browser.removeEventListener('popstate', navigation);
      restorePresentation();
      if (operations.get(page) === operation) operations.delete(page);
      page.dispatchEvent(new browser.Event(completionSettledEvent));
    };
    const dismissOwnedModal = () => {
      if (closingRequested) return;
      const cancel = ownedRoot?.querySelector('#cancel-button');
      if (ownsModal() && ownedRoot?.querySelectorAll('#cancel-button').length === 1 &&
        cancel instanceof browser.HTMLButtonElement && cancel.closest(MODAL_SELECTOR) === ownedRoot &&
        cancel.type === 'button' && label(cancel) === 'Cancel' && !cancel.disabled) {
        closingRequested = true;
        cancel.click();
      }
    };
    const cancelBeforeSave = (error: unknown) => {
      if (saved || released) return;
      const beforeCancel = page.activeElement;
      const ownsFocus = (element: Element | null) => element === focused || element === page.body || element === page.documentElement ||
        element === null || !!ownedRoot?.contains(element);
      request('cancel');
      dismissOwnedModal();
      finish(error);
      release();
      const restoreFocus = ownsFocus(beforeCancel) ? focused : beforeCancel;
      if (ownsFocus(page.activeElement) && restoreFocus instanceof browser.HTMLElement && restoreFocus.isConnected && page.URL === initialUrl) {
        restoreFocus.focus({ preventScroll: true });
      }
    };
    const fail = (kind: AssignmentCompletionError['kind'], message: string) => {
      const error = new AssignmentCompletionError(kind, message);
      if (!saved) cancelBeforeSave(error);
      else if (kind === 'failed') {
        terminalError = error;
        clearTimeout(deadline);
        observe();
        dismissOwnedModal();
        deadline = setTimeout(() => {
          finish(new AssignmentCompletionError('unsupported', 'Close the native status dialog to continue.'));
          release();
        }, 2_000);
        check();
      } else { finish(error); release(); }
    };
    function abort() {
      if (!saved) cancelBeforeSave(abortReason(signal));
      else restorePresentation(false);
    }
    function navigation() {
      if (page.URL !== initialUrl && !saved) cancelBeforeSave(new AssignmentCompletionError('unsupported', 'The assignment page changed.'));
    }
    function departed() {
      if (!saved) cancelBeforeSave(new AssignmentCompletionError('unsupported', 'The assignment page changed.'));
      else restorePresentation(false);
    }
    function competingIntent(event: Event) {
      if (!saved && event.isTrusted && (!ownedRoot || !(event.target instanceof browser.Node) || !ownedRoot.contains(event.target))) {
        cancelBeforeSave(new AssignmentCompletionError('unsupported', 'Use the native assignment status control.'));
      }
    }
    function response(event: Event) {
      if (!(event instanceof browser.CustomEvent)) return;
      const result = assignmentStatusResponse(event.detail);
      if (!result || result.token !== token || released) return;
      if (result.status === 'ready') ready = true;
      else if (result.status === 'sent') sent = true;
      else if (result.status === 'saved') {
        if (acknowledged) return;
        acknowledged = true;
        observe();
        confirmationDeadline = setTimeout(() => fail('unconfirmed', 'The assignment was saved, but the updated list could not be confirmed.'), 5_000);
        check();
      } else if (result.status === 'failed') {
        if (result.httpStatus === 0 || (result.httpStatus >= 200 && result.httpStatus < 300)) {
          fail('unconfirmed', 'The native assignment save could not be confirmed. Check its status before retrying.');
        } else fail('failed', 'The native assignment save failed. Use its status control to retry.');
      }
      else if (result.status === 'unavailable') {
        if (saved) {
          if (!sent) dismissOwnedModal();
          finish(new AssignmentCompletionError('unconfirmed', 'The native assignment save could not be confirmed.'));
          if (!sent) release();
        }
        else fail(result.reason === 'busy' ? 'busy' : 'unsupported', 'Use the native assignment status control.');
      }
    }
    function check() {
      if (released) return;
      if (saved) {
        if (terminalError) {
          dismissOwnedModal();
          if (!ownsModal()) { finish(terminalError); release(); }
          return;
        }
        if (!acknowledged || !previous || !requested) return;
        const candidates = [...page.querySelectorAll<HTMLElement>(ASSIGNMENT_ROW_SELECTOR)].map(readAssignmentCompletionTarget)
          .filter((candidate): candidate is AssignmentCompletionTarget => candidate?.assignmentIndexId === target.assignmentIndexId);
        if (candidates.length === 1 && candidates[0]!.status === requested) {
          dismissOwnedModal();
          if (ownsModal()) return;
          finish();
          release();
        } else if (!candidates.length && page.URL === initialUrl && !target.row.isConnected && ownedRoot && !ownsModal()) {
          // Native filtering may remove the row in its successful save callback.
          // The matched, parsed response and closed dialog still confirm it.
          finish();
          release();
        }
        return;
      }
      if (signal.aborted || page.URL !== initialUrl) { abort(); navigation(); return; }
      const roots = page.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
      if (!roots.length) return;
      if (roots.length !== 1) { fail('unsupported', 'Use the native assignment status control.'); return; }
      const root = roots[0]!;
      const host = root.parentElement;
      if (host?.tagName !== 'SKY-MODAL-HOST' || host.parentElement !== page.body || (ownedRoot && root !== ownedRoot)) {
        fail('unsupported', 'The native assignment dialog changed.'); return;
      }
      if (!ownedRoot) {
        ownedRoot = root;
        ownedHost = host;
        host.setAttribute(MODAL_ATTRIBUTE, token);
        root.setAttribute(MODAL_ATTRIBUTE, token);
        if (background) operation.backgroundMask = { background, root, host, token };
        style = page.createElement('style');
        style.textContent = `sky-modal-host[${MODAL_ATTRIBUTE}="${token}"]:has(> ${MODAL_SELECTOR}[${MODAL_ATTRIBUTE}="${token}"]) { visibility: hidden !important; }`;
        page.head.append(style);
      }
      const candidate = readModal(root);
      if (!candidate) return;
      if (modal && root !== modal.root) { fail('unsupported', 'The native assignment dialog changed.'); return; }
      modal = candidate;
      previous = candidate.previous;
      if (!targetUnchanged() || (candidate.previous !== target.status && !(isUnfinished(candidate.previous) && isUnfinished(target.status)))) {
        fail('unsupported', 'The assignment changed before saving.'); return;
      }
      requested = desired === 'unfinished' || isUnfinished(desired) ? (candidate.radios.has('todo') ? 'todo' : 'overdue') : desired;
      const radio = candidate.radios.get(requested);
      if (!radio) { fail('unsupported', 'This assignment does not offer that status.'); return; }
      radio.click();
      const modalUnchanged = () => {
        const current = readModal(root);
        return current?.save === candidate.save && current.cancel === candidate.cancel && current.radios.get(requested!) === radio && current.previous === requested;
      };
      if (!radio.checked || !modalUnchanged() || !targetUnchanged() || signal.aborted) {
        fail('unsupported', 'The native assignment control is not ready.'); return;
      }
      page.addEventListener(ASSIGNMENT_STATUS_RESPONSE_EVENT, response);
      request('arm');
      if (!ready || released || signal.aborted || !targetUnchanged() || !modalUnchanged() || !root.isConnected || page.querySelectorAll(MODAL_SELECTOR).length !== 1) {
        fail('unsupported', 'Use the native assignment status control.'); return;
      }
      saved = true;
      clearTimeout(readinessTimer);
      readinessTimer = undefined;
      observer.disconnect();
      clearTimeout(deadline);
      deadline = setTimeout(() => {
        finish(new AssignmentCompletionError('unconfirmed', 'The assignment save is still pending. Check the native status before retrying.'));
        // Native requests cannot be canceled by feature cleanup. Keep the
        // document operation until the observer reports its terminal result.
      }, 30_000);
      candidate.save.click();
    }
    function pollReadiness() {
      readinessTimer = undefined;
      check();
      if (!saved && !released) readinessTimer = setTimeout(pollReadiness, 100);
    }
    deadline = setTimeout(() => cancelBeforeSave(new AssignmentCompletionError('unsupported', 'The native assignment dialog did not become ready.')), 5_000);
    // Angular can initialize radio.checked without a DOM mutation, including
    // when SkyModal reuses its existing host. Poll only until Save or teardown.
    readinessTimer = setTimeout(pollReadiness, 100);
    observe();
    signal.addEventListener('abort', abort, { once: true });
    page.addEventListener('pointerdown', competingIntent, true);
    page.addEventListener('keydown', competingIntent, true);
    browser.addEventListener('pagehide', departed, { once: true });
    browser.addEventListener('hashchange', navigation);
    browser.addEventListener('popstate', navigation);
    target.button.click();
    check();
  });
}
