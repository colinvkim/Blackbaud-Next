import { isLmsPage } from './routes.ts';

export interface DirectoryTarget {
  directoryId: string;
  origin: string;
}

export interface DirectoryEntry {
  userId: number;
  firstName: string;
  lastName: string;
  nickname: string;
  displayName: string;
  grade: string;
  email: string;
  photoUrl: string;
  canViewProfile: boolean;
}

export interface DirectorySnapshot {
  entries: readonly DirectoryEntry[];
  // Received rows drive local pagination. Native searches may cap their result
  // rows below the reported matching total; never present that as complete.
  totalCount: number;
  reportedTotalCount?: number;
  complete?: boolean;
}

export interface DirectoryPreparedSnapshot {
  snapshot: DirectorySnapshot;
  photoFiles: readonly { userId: number; fileName: string }[];
}

export interface DirectoryNavigationIntent {
  target: DirectoryTarget;
  url: URL;
}

export interface DirectoryFilter {
  query?: string;
  grade?: string;
}

export interface DirectoryGradeCount {
  grade: string;
  count: number;
}

export interface DirectoryPage {
  entries: readonly DirectoryEntry[];
  page: number;
  pageCount: number;
  totalCount: number;
}

const MAX_DIRECTORY_ENTRIES = 10_000;
const nameOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function validId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export function directoryTargetFromUrl(url: URL): DirectoryTarget | null {
  if (!isLmsPage(url) || url.username || url.password || !/^\/app\/[^/]+\/?$/.test(url.pathname)) return null;
  const match = url.hash.match(/^#directory\/([1-9]\d*)\/?(?:\?.*)?$/i);
  if (!match?.[1] || !validId(match[1])) return null;
  return { directoryId: match[1], origin: url.origin };
}

// Native same-document Directory links can start a read before navigation.
// The destination identifies a directory; schools can choose their own labels.
export function directoryNavigationIntent(anchor: HTMLAnchorElement, current: URL): DirectoryNavigationIntent | null {
  const linkTarget = (anchor.getAttribute('target') ?? '').trim().toLowerCase();
  if (!anchor.closest('#topnav-containter, #site-mobile-sitenav, #site-main .dropdown-menu, #site-main .dropdown-menu-mobile') ||
    anchor.hasAttribute('download') || (linkTarget && linkTarget !== '_self') || current.username || current.password) return null;
  try {
    const destination = new URL(anchor.getAttribute('href') ?? '', current);
    const target = directoryTargetFromUrl(destination);
    if (!target || !/^#directory\/[1-9]\d*\/?$/iu.test(destination.hash) || destination.origin !== current.origin || destination.pathname !== current.pathname ||
      destination.search !== current.search || destination.href === current.href) return null;
    return { target, url: destination };
  } catch { return null; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function plainText(value: unknown, limit = 300): string {
  if (typeof value !== 'string' || value.length > limit || /[<>\u0000-\u001f\u007f]/u.test(value)) return '';
  return value.trim().replace(/\s+/gu, ' ');
}

function gradeText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return plainText(value, 100);
}

function unsupported(): Error {
  return new Error('The directory response is incomplete or has an unsupported format.');
}

function photoHostAllowed(url: URL, baseUrl: string): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    (url.origin === new URL(baseUrl).origin || (!url.port && (url.hostname.endsWith('.myschoolcdn.com') || url.hostname.endsWith('.myschoolapp.com'))));
}

function publishedPhoto(value: unknown, baseUrl: string, photoBaseUrl?: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return '';
  try {
    let photo = value.trim();
    if (/^large_user_[a-z0-9_.-]+$/i.test(photo)) {
      if (!photoBaseUrl) return '';
      const prefix = new URL(photoBaseUrl, baseUrl);
      if (!photoHostAllowed(prefix, baseUrl) || !prefix.pathname.endsWith('/user/') || prefix.search || /%/u.test(prefix.pathname)) return '';
      photo = new URL(photo, prefix).href;
    }
    const url = new URL(photo, baseUrl);
    if (!photoHostAllowed(url, baseUrl) || !/^\/(?:[a-z0-9_.-]+\/)*user\/large_user_[a-z0-9_.-]+$/i.test(url.pathname)) return '';
    const parameters = [...url.searchParams];
    if (parameters.length && (parameters.length !== 1 || parameters[0]![0] !== 'resize' || !/^[1-9]\d{0,3},[1-9]\d{0,3}$/.test(parameters[0]![1]))) return '';
    return url.href;
  } catch { return ''; }
}

function publishedEmail(value: unknown): string {
  const email = plainText(value, 254);
  return /^[^\s@<>,;:?&#%]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(email) ? email : '';
}

export function directoryThumbnailUrl(photoUrl: string, baseUrl: string): string {
  const safe = publishedPhoto(photoUrl, baseUrl);
  if (!safe) return '';
  const url = new URL(safe);
  url.searchParams.set('resize', '96,96');
  return url.href;
}

// Keep a validated, projected snapshot rather than retaining the API payload.
// Report native result limits explicitly instead of implying all rows arrived.
function readDirectorySnapshot(payload: unknown, baseUrl: string, photoBaseUrl?: string, photoFiles?: { userId: number; fileName: string }[]): DirectorySnapshot {
  // The native endpoint reports the total on the first row; later rows use zero.
  if (!Array.isArray(payload) || payload.length > MAX_DIRECTORY_ENTRIES) throw unsupported();
  const reportedTotalCount = payload.length ? record(payload[0])?.TotalCount : 0;
  if (typeof reportedTotalCount !== 'number' || !Number.isSafeInteger(reportedTotalCount) || reportedTotalCount < payload.length) throw unsupported();
  const entries: DirectoryEntry[] = [];
  const seen = new Set<number>();
  for (const value of payload) {
    const item = record(value);
    const userId = item?.UserID;
    if (!item || typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0 || seen.has(userId) ||
      typeof item.FirstName !== 'string' || typeof item.LastName !== 'string' || typeof item.PublishUserProfile !== 'boolean' ||
      typeof item.PublishEmail !== 'boolean' || (item.TotalCount !== 0 && item.TotalCount !== reportedTotalCount)) throw unsupported();
    const firstName = plainText(item.FirstName);
    const lastName = plainText(item.LastName);
    if ((!firstName && !lastName) || (item.FirstName.trim() && !firstName) || (item.LastName.trim() && !lastName)) throw unsupported();
    seen.add(userId);
    const canViewProfile = item.PublishUserProfile;
    if (canViewProfile && photoFiles && typeof item.LargeFileName === 'string' && /^large_user_[a-z0-9_.-]+$/i.test(item.LargeFileName.trim()) && item.LargeFileName.length <= 2000) {
      photoFiles.push({ userId, fileName: item.LargeFileName.trim() });
    }
    const displayName = plainText(item.UserNameFormatted) || [firstName, lastName].filter(Boolean).join(' ');
    const visibleName = searchable(displayName);
    entries.push({
      userId,
      firstName: canViewProfile || visibleName.includes(searchable(firstName)) ? firstName : '',
      lastName: canViewProfile || visibleName.includes(searchable(lastName)) ? lastName : '',
      nickname: canViewProfile ? plainText(item.Nickname) : '',
      displayName,
      grade: canViewProfile ? gradeText(item.GradeDisplay) || gradeText(item.GradeNumericDisplay) || gradeText(item.Grade) : '',
      email: canViewProfile && item.PublishEmail && item.EmailBad === false ? publishedEmail(item.Email) : '',
      photoUrl: canViewProfile ? publishedPhoto(item.LargeFileName, baseUrl, photoBaseUrl) : '',
      canViewProfile,
    });
  }
  return { entries, totalCount: entries.length, reportedTotalCount, complete: entries.length === reportedTotalCount };
}

export function normalizeDirectorySnapshot(payload: unknown, baseUrl: string, photoBaseUrl?: string): DirectorySnapshot {
  return readDirectorySnapshot(payload, baseUrl, photoBaseUrl);
}

export function prepareDirectorySnapshot(payload: unknown, baseUrl: string): DirectoryPreparedSnapshot {
  const photoFiles: { userId: number; fileName: string }[] = [];
  const snapshot = readDirectorySnapshot(payload, baseUrl, undefined, photoFiles);
  // Prepare the initial last-name order while page metadata is still loading.
  return { snapshot: { ...snapshot, entries: sortDirectoryEntries(snapshot.entries, 'last') }, photoFiles };
}

export function finalizeDirectorySnapshot(prepared: DirectoryPreparedSnapshot, baseUrl: string, photoBaseUrl?: string): DirectorySnapshot {
  const files = new Map(prepared.photoFiles.map((item) => [item.userId, item.fileName]));
  return {
    ...prepared.snapshot,
    entries: prepared.snapshot.entries.map((entry) => ({
      ...entry,
      photoUrl: entry.canViewProfile ? publishedPhoto(files.get(entry.userId) ?? entry.photoUrl, baseUrl, photoBaseUrl) : '',
    })),
  };
}

async function readDirectoryPayload(target: DirectoryTarget, signal: AbortSignal, query = ''): Promise<unknown> {
  const parameters = new URLSearchParams({ directoryId: target.directoryId, searchVal: query, facets: '', searchAll: 'false' });
  const response = await fetch(`/api/directory/directoryresultsget?${parameters}`, {
    method: 'GET', credentials: 'same-origin', redirect: 'error', signal, headers: { accept: 'application/json' },
  });
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`The directory could not be loaded (${response.status}).`);
  const payload: unknown = await response.json();
  signal.throwIfAborted();
  return payload;
}

export async function fetchDirectorySnapshot(target: DirectoryTarget, signal: AbortSignal, photoBaseUrl?: string, query = ''): Promise<DirectorySnapshot> {
  signal.throwIfAborted();
  if (typeof query !== 'string' || query.length > 200 || /[<>\u0000-\u001f\u007f]/u.test(query)) throw new Error('The directory search is invalid.');
  const sourceHref = window.location.href;
  const current = directoryTargetFromUrl(new URL(sourceHref));
  if (!validId(target.directoryId) || !current || target.origin !== current.origin || target.directoryId !== current.directoryId) {
    throw new Error('The directory identifier is invalid.');
  }
  const payload = await readDirectoryPayload(target, signal, query);
  const latest = directoryTargetFromUrl(new URL(window.location.href));
  if (window.location.href !== sourceHref || !latest || latest.origin !== target.origin || latest.directoryId !== target.directoryId) {
    throw new Error('The directory changed before it could be loaded.');
  }
  return normalizeDirectorySnapshot(payload, target.origin, photoBaseUrl);
}

export async function fetchDirectoryPreparedSnapshot(target: DirectoryTarget, signal: AbortSignal, intentUrl?: URL): Promise<DirectoryPreparedSnapshot> {
  signal.throwIfAborted();
  const source = new URL(window.location.href);
  const destination = new URL(intentUrl?.href ?? source.href);
  const intent = directoryTargetFromUrl(destination);
  if (!validId(target.directoryId) || !intent || intent.origin !== target.origin || intent.directoryId !== target.directoryId ||
    !isLmsPage(source) || source.username || source.password || !/^\/app\/[^/]+\/?$/.test(source.pathname) ||
    source.origin !== destination.origin || source.pathname !== destination.pathname || source.search !== destination.search) {
    throw new Error('The directory intent is invalid.');
  }
  const payload = await readDirectoryPayload(target, signal);
  const latest = new URL(window.location.href);
  if (latest.href !== source.href && latest.href !== destination.href) throw new Error('The directory changed before it could be loaded.');
  return prepareDirectorySnapshot(payload, target.origin);
}

function searchable(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function filterDirectoryEntries(entries: readonly DirectoryEntry[], filter: DirectoryFilter = {}): DirectoryEntry[] {
  const tokens = searchable(filter.query ?? '').split(/\s+/u).filter(Boolean);
  return entries.filter((entry) => {
    if (filter.grade && !directoryEntryGrades(entry).includes(filter.grade)) return false;
    const name = searchable([entry.firstName, entry.lastName, entry.nickname, entry.displayName].join(' '));
    return tokens.every((token) => name.includes(token));
  });
}

function compareText(left: string, right: string): number {
  return nameOrder.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

export function sortDirectoryEntries(entries: readonly DirectoryEntry[], sort: 'first' | 'last' = 'last'): DirectoryEntry[] {
  const primary = sort === 'first' ? 'firstName' : 'lastName';
  const secondary = sort === 'first' ? 'lastName' : 'firstName';
  return [...entries].sort((left, right) => compareText(left[primary] || left.displayName, right[primary] || right.displayName) ||
    compareText(left[secondary], right[secondary]) || compareText(left.displayName, right.displayName) || left.userId - right.userId);
}

export function directoryGradeCounts(entries: readonly DirectoryEntry[]): DirectoryGradeCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const grade of directoryEntryGrades(entry)) counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  return [...counts].map(([grade, count]) => ({ grade, count })).sort((left, right) => compareGrades(left.grade, right.grade));
}

function gradeOrder(grade: string): number {
  const normalized = searchable(grade).replace(/\s/gu, '');
  if (['pk', 'prek', 'prekindergarten'].includes(normalized)) return -2;
  if (['k', 'kindergarten'].includes(normalized)) return -1;
  const numeric = /^\d{1,2}$/.test(normalized) ? Number(normalized) : NaN;
  return numeric >= 1 && numeric <= 12 ? numeric : Infinity;
}

function compareGrades(left: string, right: string): number {
  const first = gradeOrder(left);
  const second = gradeOrder(right);
  return first !== second ? first < second ? -1 : 1 : compareText(left, right);
}

export function directoryEntryGrades(entry: DirectoryEntry): string[] {
  if (!entry.canViewProfile) return [];
  return [...new Set(entry.grade.split(',').map((grade) => grade.trim()).filter(Boolean))].sort(compareGrades);
}

export function directoryPage(entries: readonly DirectoryEntry[], page: number, pageSize: number): DirectoryPage {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('The directory page size is invalid.');
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Number.isSafeInteger(page) ? Math.min(pageCount, Math.max(1, page)) : 1;
  return { entries: entries.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount, totalCount: entries.length };
}
