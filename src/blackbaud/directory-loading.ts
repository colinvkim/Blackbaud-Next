import { directoryTargetFromUrl, fetchDirectoryPreparedSnapshot } from './directory.ts';
import type { DirectoryPreparedSnapshot, DirectoryTarget } from './directory.ts';
import { isLmsPage } from './routes.ts';
import type { Cleanup } from '../shared/types.ts';

export const DIRECTORY_READ_LIFETIME = 15_000;
export type DirectoryPreparedReader = typeof fetchDirectoryPreparedSnapshot;

export interface DirectoryLoadingManager {
  start(target: DirectoryTarget, sourceUrl: URL, destinationUrl: URL): boolean;
  updateRoute(url: URL, occurredAt?: number): void;
  claim(target: DirectoryTarget, signal: AbortSignal): Promise<DirectoryPreparedSnapshot> | null;
  dispose(): void;
}

interface PendingRead {
  target: DirectoryTarget;
  sourceHref: string;
  destination: URL;
  controller: AbortController;
  promise: Promise<DirectoryPreparedSnapshot>;
  startedAt: number;
  deadline: ReturnType<typeof setTimeout>;
  entered: boolean;
  claimed: boolean;
  settled: boolean;
  detachClaim: Cleanup;
}

function sameTarget(left: DirectoryTarget, right: DirectoryTarget): boolean {
  return left.directoryId === right.directoryId && left.origin === right.origin;
}

function nativeAppUrl(url: URL): boolean {
  return isLmsPage(url) && !url.username && !url.password && /^\/app\/[^/]+\/?$/.test(url.pathname);
}

function destinationMatches(url: URL, pending: PendingRead): boolean {
  const target = directoryTargetFromUrl(url);
  return target !== null && sameTarget(target, pending.target) && url.origin === pending.destination.origin &&
    url.pathname === pending.destination.pathname && url.search === pending.destination.search &&
    url.hash.replace(/\/(?=\?|$)/u, '') === pending.destination.hash.replace(/\/(?=\?|$)/u, '');
}

// One navigation owns one read. A resolved, unclaimed result lives only until
// its short deadline; it is never a reusable Directory cache.
export function createDirectoryLoadingManager(
  readPrepared: DirectoryPreparedReader = fetchDirectoryPreparedSnapshot,
  currentUrl: () => URL = () => new URL(window.location.href),
  currentTime: () => number = () => window.performance.now(),
): DirectoryLoadingManager {
  let pending: PendingRead | null = null;
  let disposed = false;
  const finish = (read: PendingRead, abort = true) => {
    if (pending === read) pending = null;
    clearTimeout(read.deadline);
    read.detachClaim();
    read.detachClaim = () => {};
    if (abort) read.controller.abort();
  };
  const updateRoute = (url: URL, occurredAt?: number) => {
    const read = pending;
    if (!read) return;
    // Chrome timestamps hash changes at the transition, before their queued
    // dispatch. A prior navigation's event must not affect a newer intent.
    if (occurredAt !== undefined && (!Number.isFinite(occurredAt) || occurredAt < read.startedAt)) return;
    if (destinationMatches(url, read)) read.entered = true;
    else if (read.entered || url.href !== read.sourceHref) finish(read);
  };
  return {
    start: (target, sourceUrl, destinationUrl) => {
      if (disposed || currentUrl().href !== sourceUrl.href || !nativeAppUrl(sourceUrl) || !nativeAppUrl(destinationUrl) ||
        destinationUrl.origin !== sourceUrl.origin || destinationUrl.pathname !== sourceUrl.pathname || destinationUrl.search !== sourceUrl.search) return false;
      const destinationTarget = directoryTargetFromUrl(destinationUrl);
      if (!destinationTarget || !sameTarget(destinationTarget, target)) return false;
      const sourceTarget = directoryTargetFromUrl(sourceUrl);
      if (sourceTarget && sameTarget(sourceTarget, target)) return false;
      if (pending && !pending.claimed && pending.sourceHref === sourceUrl.href && pending.destination.href === destinationUrl.href && sameTarget(pending.target, target)) return true;
      if (pending) finish(pending);
      const startedAt = currentTime();
      const controller = new AbortController();
      let promise: Promise<DirectoryPreparedSnapshot>;
      try {
        // Calling the reader here starts its GET during the native click's
        // capture phase, before Blackbaud's route rendering begins.
        promise = readPrepared(target, controller.signal, new URL(destinationUrl.href));
      } catch {
        controller.abort();
        return false;
      }
      const read: PendingRead = {
        target: { ...target }, sourceHref: sourceUrl.href, destination: new URL(destinationUrl.href), controller, promise, startedAt,
        deadline: setTimeout(() => finish(read), DIRECTORY_READ_LIFETIME), entered: false, claimed: false, settled: false, detachClaim: () => {},
      };
      pending = read;
      // Captured reads have no consumer until the native route is eligible.
      // Observe rejection immediately so cancellation/failure stays handled.
      void promise.then(() => {
        read.settled = true;
        if (pending === read && read.claimed) finish(read, false);
      }, () => finish(read));
      return true;
    },
    updateRoute,
    claim: (target, signal) => {
      if (disposed) return null;
      const url = currentUrl();
      updateRoute(url);
      const read = pending;
      if (!read || read.claimed || !sameTarget(read.target, target) || !destinationMatches(url, read)) return null;
      if (signal.aborted) { finish(read); return null; }
      read.claimed = true;
      const abort = () => finish(read);
      signal.addEventListener('abort', abort, { once: true });
      read.detachClaim = () => signal.removeEventListener('abort', abort);
      if (read.settled) finish(read, false);
      return read.promise;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (pending) finish(pending);
    },
  };
}

const managers = new WeakMap<Document, DirectoryLoadingManager>();

export function registerDirectoryLoadingManager(manager: DirectoryLoadingManager, doc: Document = document): Cleanup {
  managers.get(doc)?.dispose();
  managers.set(doc, manager);
  return () => {
    if (managers.get(doc) === manager) managers.delete(doc);
    manager.dispose();
  };
}

export function claimDirectoryPreparedSnapshot(target: DirectoryTarget, signal: AbortSignal): Promise<DirectoryPreparedSnapshot> | null {
  return managers.get(document)?.claim(target, signal) ?? null;
}

// Metadata may identify a search-first directory after this speculative read
// starts. Keep its failure observed and its cancellation separate from the
// metadata/lease signal so an unused blank result cannot prevent searching.
export function startDirectoryPreparedRead(target: DirectoryTarget, signal: AbortSignal): {
  result: Promise<DirectoryPreparedSnapshot>;
  cancel(): void;
} {
  const controller = new AbortController();
  const readSignal = AbortSignal.any([signal, controller.signal]);
  const result = claimDirectoryPreparedSnapshot(target, readSignal) ?? fetchDirectoryPreparedSnapshot(target, readSignal);
  void result.catch(() => {});
  return { result, cancel: () => controller.abort() };
}
