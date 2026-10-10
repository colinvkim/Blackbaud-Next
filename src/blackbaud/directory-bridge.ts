import { directoryTargetFromUrl, fetchDirectoryPreparedSnapshot, finalizeDirectorySnapshot } from './directory.ts';
import type { DirectorySnapshot, DirectoryTarget } from './directory.ts';
import { acquireIndependentDirectory, independentDirectoryRequested } from './directory-independent.ts';
import { claimDirectoryPreparedSnapshot } from './directory-loading.ts';
import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_OWNER_ATTRIBUTE, DIRECTORY_REQUEST_EVENT, DIRECTORY_RESPONSE_EVENT, DIRECTORY_UI_ATTRIBUTE } from './directory-protocol.ts';

export class DirectoryUnsupportedError extends Error {
  constructor() {
    super('This directory uses the original Blackbaud view.');
    this.name = 'DirectoryUnsupportedError';
  }
}

export interface DirectoryLease {
  root: HTMLElement;
  name: string;
  searchOnly?: boolean;
  photoBaseUrl: string;
  snapshot: DirectorySnapshot;
  // Unexpected page-side teardown invalidates the UI even when this feature's
  // route signal has not caught up with native navigation yet.
  signal: AbortSignal;
  release(): void;
}

export async function acquireDirectory(target: DirectoryTarget, signal: AbortSignal): Promise<DirectoryLease> {
  signal.throwIfAborted();
  if (independentDirectoryRequested()) {
    const independent = await acquireIndependentDirectory(target, signal);
    if (independent) return independent;
    signal.throwIfAborted();
  }
  const current = directoryTargetFromUrl(new URL(window.location.href));
  if (!current || current.origin !== target.origin || current.directoryId !== target.directoryId) throw new Error('The directory changed.');
  const href = window.location.href;
  const token = crypto.randomUUID();
  const leaseAbort = new AbortController();
  const operation = new AbortController();
  const readSignal = AbortSignal.any([signal, leaseAbort.signal, operation.signal]);
  let root: HTMLElement | null = null;
  let released = false;
  let heartbeat: number | undefined;
  let deadline: number | undefined;
  let rejectPending: ((reason: unknown) => void) | null = null;
  let acceptPending: ((value: Record<string, unknown>) => void) | null = null;
  let expectedStatus: 'ready' | 'active' = 'ready';
  const send = (action: 'acquire' | 'activate' | 'heartbeat' | 'release') => document.dispatchEvent(new CustomEvent(DIRECTORY_REQUEST_EVENT, {
    detail: JSON.stringify({ action, token, directoryId: target.directoryId, ...(action === 'acquire' ? { mode: 'metadata' } : {}) }),
  }));
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    document.removeEventListener(DIRECTORY_RESPONSE_EVENT, receive);
    signal.removeEventListener('abort', abort);
    operation.abort();
    send('release');
    // This also restores usability if the page adapter is no longer present.
    if (root?.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) === token) {
      root.removeAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
      root.removeAttribute(DIRECTORY_OWNER_ATTRIBUTE);
      for (const ui of root.querySelectorAll(`[${DIRECTORY_UI_ATTRIBUTE}]`)) ui.remove();
    }
  };
  const abort = () => {
    rejectPending?.(signal.reason ?? new DOMException('The directory request was cancelled.', 'AbortError'));
    rejectPending = null;
    release();
  };
  const receive = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (typeof detail !== 'string' || detail.length > 8_000_000) return;
    let value: Record<string, unknown>;
    try { value = JSON.parse(detail) as Record<string, unknown>; } catch { return; }
    if (!value || typeof value !== 'object' || value.token !== token || released) return;
    if (value.status === 'released') {
      rejectPending?.(new Error('The native directory changed.'));
      leaseAbort.abort();
      release();
    } else if (value.status === 'ready' && expectedStatus === 'ready') {
      acceptPending?.(value);
      acceptPending = null;
      rejectPending = null;
    } else if (value.status === 'active' && expectedStatus === 'active') {
      acceptPending?.(value);
      acceptPending = null;
      rejectPending = null;
    } else if (value.status === 'unsupported' || value.status === 'unavailable') {
      rejectPending?.(value.status === 'unsupported' ? new DirectoryUnsupportedError() : new Error('The enhanced directory could not connect.'));
      release();
    }
  };
  document.addEventListener(DIRECTORY_RESPONSE_EVENT, receive);
  signal.addEventListener('abort', abort, { once: true });
  try {
    // The intent-captured read can already be in flight. Deep links and Back
    // start a direct read here, in parallel with native metadata readiness.
    const prepared = claimDirectoryPreparedSnapshot(target, readSignal) ?? fetchDirectoryPreparedSnapshot(target, readSignal);
    const metadata = new Promise<Record<string, unknown>>((resolve, reject) => {
      acceptPending = resolve;
      rejectPending = reject;
      deadline = window.setTimeout(() => {
        rejectPending?.(new Error('The enhanced directory could not connect.'));
        release();
      }, 15_000);
      send('acquire');
    }).then((response) => {
      readSignal.throwIfAborted();
      const leasedRoot = document.querySelector<HTMLElement>(`[${DIRECTORY_OWNER_ATTRIBUTE}="${token}"]`);
      if (!leasedRoot || leasedRoot.parentElement?.id !== 'site-main') throw new Error('The directory view changed.');
      root = leasedRoot;
      heartbeat = window.setInterval(() => send('heartbeat'), 5_000);
      return { response, leasedRoot };
    });
    const [{ response, leasedRoot }, data] = await Promise.all([metadata, prepared]);
    signal.throwIfAborted();
    const photoBaseUrl = typeof response.photoBaseUrl === 'string' ? response.photoBaseUrl : '';
    const finalized = finalizeDirectorySnapshot(data, target.origin, photoBaseUrl);
    const searchOnly = response.searchOnly === true;
    const snapshot = searchOnly ? { ...finalized, complete: false } : finalized;
    if (released || readSignal.aborted || !leasedRoot.isConnected || window.location.href !== href) throw new Error('The directory changed.');
    await new Promise<Record<string, unknown>>((resolve, reject) => {
      expectedStatus = 'active';
      acceptPending = resolve;
      rejectPending = reject;
      send('activate');
    });
    signal.throwIfAborted();
    if (released || readSignal.aborted || !leasedRoot.isConnected || window.location.href !== href) throw new Error('The directory changed.');
    clearTimeout(deadline);
    return { root: leasedRoot, snapshot, photoBaseUrl, searchOnly, name: typeof response.name === 'string' ? response.name.slice(0,200) : 'Directory', signal: leaseAbort.signal, release };
  } catch (error) {
    release();
    throw error;
  }
}
