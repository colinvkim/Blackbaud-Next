import { ASSIGNMENT_STATUS_REQUEST_EVENT, ASSIGNMENT_STATUS_RESPONSE_EVENT, assignmentStatusRequest, isAssignmentStatusPage } from './assignment-status-protocol.ts';
import type { AssignmentStatusRequest, AssignmentStatusResponse } from './assignment-status-protocol.ts';
import type { Cleanup } from '../shared/types.ts';

type PageWindow = Window & typeof globalThis;
type ArmRequest = Extract<AssignmentStatusRequest, { action: 'arm' }>;
type Operation =
  | { kind: 'armed'; request: ArmRequest; timer: number; restore: Cleanup }
  | { kind: 'sent'; request: ArmRequest; stop: Cleanup };

const armTimeout = 5_000;

function nativeJsonResponse(xhr: XMLHttpRequest): boolean {
  try {
    if (xhr.responseType === 'json') return true;
    if (xhr.responseType && xhr.responseType !== 'text') return false;
    const body = xhr.responseText;
    if (body !== '') JSON.parse(body);
    return true;
  } catch { return false; }
}

export function installAssignmentStatusPageBridge(page: PageWindow): Cleanup {
  let active: Operation | null = null;
  let disposed = false;
  const respond = (response: AssignmentStatusResponse) => {
    page.document.dispatchEvent(new page.CustomEvent(ASSIGNMENT_STATUS_RESPONSE_EVENT, { detail: JSON.stringify(response) }));
  };
  const current = () => {
    try {
      const url = new URL(page.location.href);
      const source = new URL(page.document.URL);
      return isAssignmentStatusPage(url) && isAssignmentStatusPage(source) && source.origin === url.origin;
    } catch { return false; }
  };
  const releaseArm = (operation: Extract<Operation, { kind: 'armed' }>) => {
    if (active !== operation) return;
    active = null;
    page.clearTimeout(operation.timer);
    operation.restore();
  };
  const arm = (request: ArmRequest) => {
    if (active) { respond({ token: request.token, status: 'unavailable', reason: 'busy' }); return; }
    const prototype = page.XMLHttpRequest.prototype;
    const open = Object.getOwnPropertyDescriptor(prototype, 'open');
    const send = Object.getOwnPropertyDescriptor(prototype, 'send');
    if (!current() || typeof open?.value !== 'function' || typeof send?.value !== 'function' ||
      (!open.writable && !open.configurable) || (!send.writable && !send.configurable)) {
      respond({ token: request.token, status: 'unavailable', reason: 'unsupported' });
      return;
    }
    const opened = new WeakMap<XMLHttpRequest, boolean>();
    const wrappedOpen = function (this: XMLHttpRequest, method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
      let matching = false;
      if (active?.kind === 'armed' && active.request === request && typeof method === 'string' && typeof url === 'string' && !username && !password) {
        try {
          const target = new URL(url, page.location.href);
          matching = method.toUpperCase() === 'POST' && target.origin === page.location.origin &&
            target.pathname === '/api/assignment2/assignmentstatusupdate' && !target.username && !target.password && !target.search && !target.hash;
        } catch { /* Unrecognized calls remain entirely native. */ }
      }
      opened.set(this, matching);
      try { return Reflect.apply(open.value, this, arguments); }
      catch (error) { opened.delete(this); throw error; }
    };
    const wrappedSend = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const operation = active;
      let matching = false;
      if (operation?.kind === 'armed' && operation.request === request && opened.get(this) && current() && typeof body === 'string' && body.length <= 500) {
        try {
          const value: unknown = JSON.parse(body);
          matching = !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 &&
            'assignmentIndexId' in value && value.assignmentIndexId === request.assignmentIndexId &&
            'assignmentStatus' in value && value.assignmentStatus === request.assignmentStatus;
        } catch { /* Other request bodies are never changed or inspected further. */ }
      }
      if (!matching || operation?.kind !== 'armed') return Reflect.apply(send.value, this, arguments);
      const xhr = this;
      const stop = () => xhr.removeEventListener('loadend', settled);
      const sent: Extract<Operation, { kind: 'sent' }> = { kind: 'sent', request, stop };
      const settled = () => {
        if (active !== sent) return;
        active = null;
        stop();
        const httpStatus = xhr.status;
        respond(httpStatus >= 200 && httpStatus < 300 && nativeJsonResponse(xhr)
          ? { token: request.token, status: 'saved' }
          : { token: request.token, status: 'failed', httpStatus });
      };
      xhr.addEventListener('loadend', settled);
      page.clearTimeout(operation.timer);
      operation.restore();
      active = sent;
      respond({ token: request.token, status: 'sent' });
      try { return Reflect.apply(send.value, this, arguments); }
      catch (error) {
        if (active === sent) {
          active = null;
          stop();
          respond({ token: request.token, status: 'failed', httpStatus: 0 });
        }
        throw error;
      }
    };
    const restore = () => {
      for (const [name, original, wrapped] of [['open', open, wrappedOpen], ['send', send, wrappedSend]] as const) {
        if (Object.getOwnPropertyDescriptor(prototype, name)?.value !== wrapped) continue;
        try { Object.defineProperty(prototype, name, original); } catch { /* A later owner can make its descriptor unmodifiable. */ }
      }
    };
    const operation: Extract<Operation, { kind: 'armed' }> = {
      kind: 'armed', request, restore,
      timer: page.setTimeout(() => {
        if (active !== operation) return;
        releaseArm(operation);
        respond({ token: request.token, status: 'unavailable', reason: 'timeout' });
      }, armTimeout),
    };
    active = operation;
    try {
      Object.defineProperty(prototype, 'open', { ...open, value: wrappedOpen });
      Object.defineProperty(prototype, 'send', { ...send, value: wrappedSend });
    } catch {
      releaseArm(operation);
      respond({ token: request.token, status: 'unavailable', reason: 'unsupported' });
      return;
    }
    respond({ token: request.token, status: 'ready' });
  };
  const receive = (event: Event) => {
    if (disposed) return;
    const request = assignmentStatusRequest((event as CustomEvent).detail);
    if (!request) return;
    if (request.action === 'arm') arm(request);
    else if (active?.request.token === request.token) {
      if (active.kind === 'armed') {
        releaseArm(active);
        respond({ token: request.token, status: 'released' });
      } else respond({ token: request.token, status: 'sent' });
    }
  };
  const pagehide = () => {
    if (active?.kind !== 'armed') return;
    const token = active.request.token;
    releaseArm(active);
    respond({ token, status: 'released' });
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    page.document.removeEventListener(ASSIGNMENT_STATUS_REQUEST_EVENT, receive);
    page.removeEventListener('pagehide', pagehide);
    if (active?.kind === 'armed') releaseArm(active);
    else if (active) { active.stop(); active = null; }
  };
  page.document.addEventListener(ASSIGNMENT_STATUS_REQUEST_EVENT, receive);
  page.addEventListener('pagehide', pagehide);
  return cleanup;
}
