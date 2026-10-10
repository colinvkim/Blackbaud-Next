import { directoryTargetFromUrl } from './directory.ts';
import type { DirectoryTarget } from './directory.ts';

export interface DirectoryConfiguration {
  name: string;
  searchOnly: boolean;
}

function validDirectoryId(value: string): boolean {
  return /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value));
}

function unsupported(): Error {
  return new Error('The directory configuration has an unsupported format.');
}

// Project only the configuration needed by the independent view. Missing
// DefaultResults must not turn a native search-first directory into a listing.
export function normalizeDirectoryConfiguration(payload: unknown, target: DirectoryTarget): DirectoryConfiguration {
  if (!validDirectoryId(target.directoryId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw unsupported();
  const item = payload as Record<string, unknown>;
  if (typeof item.DirectoryID !== 'number' || !Number.isSafeInteger(item.DirectoryID) ||
    item.DirectoryID !== Number(target.directoryId) || typeof item.DirectoryName !== 'string' ||
    item.DirectoryName.length > 200 || /[<>\u0000-\u001f\u007f-\u009f]/u.test(item.DirectoryName) ||
    typeof item.DefaultResults !== 'boolean') throw unsupported();
  const name = item.DirectoryName.trim().replace(/\s+/gu, ' ');
  if (!name) throw unsupported();
  return { name, searchOnly: !item.DefaultResults };
}

function currentDirectoryMatches(target: DirectoryTarget, href: string): boolean {
  const current = directoryTargetFromUrl(new URL(window.location.href));
  return window.location.href === href && validDirectoryId(target.directoryId) && current !== null &&
    current.directoryId === target.directoryId && current.origin === target.origin;
}

export async function fetchDirectoryConfiguration(target: DirectoryTarget, signal: AbortSignal): Promise<DirectoryConfiguration> {
  signal.throwIfAborted();
  const sourceHref = window.location.href;
  if (!currentDirectoryMatches(target, sourceHref)) throw new Error('The directory identifier is invalid.');
  const parameters = new URLSearchParams({ directoryId: target.directoryId });
  const response = await fetch(`/api/directory/directoryget?${parameters}`, {
    method: 'GET', credentials: 'same-origin', redirect: 'error', signal, headers: { accept: 'application/json' },
  });
  signal.throwIfAborted();
  if (!currentDirectoryMatches(target, sourceHref)) throw new Error('The directory changed before its configuration could be loaded.');
  if (response.redirected) throw new Error('The directory configuration request was redirected.');
  if (!response.ok) throw new Error(`The directory configuration could not be loaded (${response.status}).`);
  const payload: unknown = await response.json();
  signal.throwIfAborted();
  if (!currentDirectoryMatches(target, sourceHref)) throw new Error('The directory changed before its configuration could be loaded.');
  return normalizeDirectoryConfiguration(payload, target);
}
