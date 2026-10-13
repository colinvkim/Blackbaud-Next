import { startDirectoryPreparedRead } from './directory-loading.ts';
import { directoryTargetFromUrl, finalizeDirectorySnapshot } from './directory.ts';
import type { DirectorySnapshot, DirectoryTarget } from './directory.ts';
import { fetchDirectoryConfiguration } from './directory-configuration.ts';
import { DIRECTORY_OWNER_ATTRIBUTE } from './directory-protocol.ts';
import { INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, INDEPENDENT_DIRECTORY_REQUEST_EVENT, INDEPENDENT_DIRECTORY_RESPONSE_EVENT } from './directory-independent-protocol.ts';
import type { DirectoryLease } from './directory-bridge.ts';
import type { Cleanup } from '../shared/types.ts';

interface Gate { token: string; ready: boolean; pending: boolean; }
const gates = new WeakMap<Document, Gate>();

export function independentDirectoryRequested(): boolean {
  const gate = gates.get(document);
  return gate?.ready === true || gate?.pending === true;
}

function send(action: string, token: string, directoryId?: string) {
  document.dispatchEvent(new window.CustomEvent(INDEPENDENT_DIRECTORY_REQUEST_EVENT, {
    detail: JSON.stringify({ action, token, ...(directoryId ? { directoryId } : {}) }),
  }));
}

function response(event: Event): Record<string, unknown> | null {
  const value: unknown = (event as CustomEvent).detail;
  if (typeof value !== 'string' || value.length > 4000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

// Settings own the gate for the document; navigation owns individual shells.
// The passive MAIN adapter never decides whether a preference is enabled.
export function enableIndependentDirectory(signal: AbortSignal): Cleanup {
  if (signal.aborted) return () => {};
  const gate: Gate = { token: crypto.randomUUID(), ready: false, pending: true };
  gates.set(document, gate);
  const receive = (event: Event) => {
    const value = response(event);
    if (value?.token === gate.token && ['enabled', 'unsupported'].includes(String(value.status))) {
      if (value.status === 'enabled' && !gate.pending && !gate.ready) return;
      gate.ready = value.status === 'enabled';
      gate.pending = false;
    }
  };
  document.addEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receive);
  send('enable', gate.token);
  const heartbeat = window.setInterval(() => send('heartbeat', gate.token), 5000);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    gate.ready = false;
    gate.pending = false;
    clearInterval(heartbeat);
    document.removeEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receive);
    signal.removeEventListener('abort', cleanup);
    if (gates.get(document) === gate) gates.delete(document);
    send('disable', gate.token);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}

export async function acquireIndependentDirectory(target: DirectoryTarget, signal: AbortSignal): Promise<DirectoryLease | null> {
  signal.throwIfAborted();
  const gate = gates.get(document);
  if (!gate || (!gate.ready && !gate.pending)) return null;
  const href = window.location.href;
  const current = directoryTargetFromUrl(new URL(href));
  if (!current || current.directoryId !== target.directoryId || current.origin !== target.origin) return null;
  if (gate.pending) {
    await new Promise<void>((resolve) => {
      let timer: number | undefined;
      const finish = () => {
        clearTimeout(timer);
        document.removeEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receiveGate);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const receiveGate = (event: Event) => {
        const value = response(event);
        if (value?.token === gate.token && ['enabled', 'unsupported'].includes(String(value.status))) finish();
      };
      document.addEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receiveGate);
      signal.addEventListener('abort', finish, { once: true });
      timer = window.setTimeout(() => {
        gate.pending = false;
        gate.ready = false;
        if (gates.get(document) === gate) send('disable', gate.token);
        finish();
      }, 3000);
    });
    if (signal.aborted && window.location.href === href && gates.get(document) === gate) {
      gate.pending = false;
      gate.ready = false;
      send('disable', gate.token);
    }
    signal.throwIfAborted();
  }
  if (gates.get(document) !== gate || !gate.ready || window.location.href !== href) return null;
  const requestToken = crypto.randomUUID();
  // Our hashchange listener can run before Backbone creates the new view.
  // Keep the handshake open until MAIN has either created it or chosen native
  // startup. A silent bridge must restore native startup before we fall back.
  const ready = await new Promise<Record<string, unknown> | null>((resolve) => {
    let settled = false;
    let timer: number | undefined;
    const finish = (value: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receiveReady);
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const receiveReady = (event: Event) => {
      const value = response(event);
      if (value?.token === requestToken && value.directoryId === target.directoryId) finish(value);
    };
    const cancel = () => {
      finish(null);
      send('release', requestToken, target.directoryId);
    };
    document.addEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receiveReady);
    signal.addEventListener('abort', cancel, { once: true });
    timer = window.setTimeout(() => {
      finish(null);
      if (gates.get(document) === gate) {
        gate.ready = false;
        gate.pending = false;
        send('disable', gate.token);
      }
    }, 3000);
    send('acquire', requestToken, target.directoryId);
  });
  if (signal.aborted) {
    if (ready?.status === 'ready' && typeof ready.leaseToken === 'string' && /^[a-z0-9-]{16,80}$/i.test(ready.leaseToken)) {
      send('release', ready.leaseToken, target.directoryId);
    }
    signal.throwIfAborted();
  }
  if (!ready || ready.status !== 'ready' || typeof ready.leaseToken !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(ready.leaseToken)) return null;
  const leaseToken = ready.leaseToken;
  if (signal.aborted) {
    send('release', leaseToken, target.directoryId);
    signal.throwIfAborted();
  }
  const root = document.querySelector<HTMLElement>(`[${INDEPENDENT_DIRECTORY_ATTRIBUTE}][${DIRECTORY_OWNER_ATTRIBUTE}="${leaseToken}"]`);
  if (!root || root.getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE) !== target.directoryId || root.parentElement?.id !== 'site-main' || !root.querySelector(':scope > #overview')) {
    send('original', leaseToken, target.directoryId);
    return null;
  }
  const leaseAbort = new AbortController();
  const operation = new AbortController();
  const readSignal = AbortSignal.any([signal, leaseAbort.signal, operation.signal]);
  let released = false;
  let deadline: number | undefined;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(deadline);
    operation.abort();
    signal.removeEventListener('abort', release);
    document.removeEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receive);
    send('release', leaseToken, target.directoryId);
  };
  const receive = (event: Event) => {
    const value = response(event);
    if (value?.token === leaseToken && value.status === 'released') {
      leaseAbort.abort(new DOMException('The independent directory changed.', 'AbortError'));
      release();
    }
  };
  document.addEventListener(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, receive);
  signal.addEventListener('abort', release, { once: true });
  deadline = window.setTimeout(() => operation.abort(new DOMException('The directory request timed out.', 'TimeoutError')), 15_000);
  try {
    // Both reads are independent of native directory view construction. The
    // click-captured people request can already be transferring at this point.
    const prepared = startDirectoryPreparedRead(target, readSignal);
    const configuration = await fetchDirectoryConfiguration(target, readSignal);
    if (configuration.searchOnly) prepared.cancel();
    const photoBaseUrl = typeof ready.photoBaseUrl === 'string' ? ready.photoBaseUrl : '';
    const snapshot: DirectorySnapshot = configuration.searchOnly
      ? { entries: [], totalCount: 0, reportedTotalCount: 0, complete: false }
      : finalizeDirectorySnapshot(await prepared.result, target.origin, photoBaseUrl);
    readSignal.throwIfAborted();
    if (released || window.location.href !== href || !root.isConnected || root.getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE) !== target.directoryId || root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) !== leaseToken) throw new Error('The directory changed.');
    const heading = root.querySelector<HTMLElement>(':scope > #overview h1');
    if (heading) heading.textContent = configuration.name;
    root.querySelector(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`)?.remove();
    clearTimeout(deadline);
    return { root, name: configuration.name, searchOnly: configuration.searchOnly, photoBaseUrl,
      snapshot, signal: leaseAbort.signal, release };
  } catch (error) {
    release();
    throw error;
  }
}
