import { fullSizePhotoUrl } from '../blackbaud/avatar.ts';
import type { DirectoryLease } from '../blackbaud/directory-bridge.ts';
import { directoryEntryGrades, directoryGradeCounts, directoryPage, directoryThumbnailUrl, filterDirectoryEntries, sortDirectoryEntries } from '../blackbaud/directory.ts';
import type { DirectoryEntry, DirectoryGradeCount, DirectorySnapshot, DirectoryTarget, fetchDirectorySnapshot } from '../blackbaud/directory.ts';
import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';
import { createButton } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import type { IconName } from '../shared/icons.ts';
import type { Settings } from '../shared/settings.ts';
import type { Cleanup } from '../shared/types.ts';

export const DIRECTORY_PAGE_SIZE = 50;
export const DIRECTORY_SEARCH_DELAY = 150;
export const DIRECTORY_REQUEST_TIMEOUT = 15_000;

interface DirectoryViewOptions {
  lease: DirectoryLease;
  target: DirectoryTarget;
  url: URL;
  settings: Settings;
  signal: AbortSignal;
  isCurrent(): boolean;
  returnToNative(): void;
  fetchSnapshot: typeof fetchDirectorySnapshot;
}

let directoryNumber = 0;

function ownedElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute(DIRECTORY_UI_ATTRIBUTE, '');
  return element;
}

function labelControl(text: string, control: HTMLElement, icon?: IconName): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'bn-directory-field';
  const caption = document.createElement('span');
  caption.textContent = text;
  if (icon) {
    caption.className = 'bn-icon-label';
    caption.prepend(createIcon(icon));
  }
  label.append(caption, control);
  return label;
}

function option(value: string, text: string): HTMLOptionElement {
  const result = document.createElement('option');
  result.value = value;
  result.textContent = text;
  return result;
}

function initials(name: string): string {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase();
}

export function buildDirectoryView(options: DirectoryViewOptions): Cleanup {
  const { lease, target, url, settings, signal, isCurrent, returnToNative, fetchSnapshot } = options;
  const header = lease.root.querySelector<HTMLElement>(':scope > #overview');
  if (!header) throw new Error('The native directory heading changed.');
  let alive = true;
  let snapshot: DirectorySnapshot = lease.searchOnly ? { entries: [], totalCount: 0, complete: false } : lease.snapshot;
  let query = '';
  let displayedQuery = '';
  let serverSearch = lease.searchOnly === true || snapshot.complete === false;
  let grade = '';
  let sort: 'first' | 'last' = 'last';
  let page = 1;
  let renderRevision = 0;
  let readRevision = 0;
  let read: AbortController | null = null;
  let readKind: 'search' | 'refresh' | null = null;
  let searchTimer: number | undefined;
  let clearReadDeadline: Cleanup = () => {};
  const current = () => alive && isCurrent() && lease.root.isConnected && !lease.signal.aborted;
  const section = ownedElement('section', 'bn-directory');
  section.setAttribute('aria-label', lease.name || 'Directory');
  const heading = document.createElement('div');
  heading.className = 'bn-directory-heading';
  const title = document.createElement('h2');
  title.textContent = 'Browse people';
  const actions = document.createElement('div');
  actions.className = 'bn-directory-actions';
  const refreshButton = createButton('Refresh', 'refresh');
  const cancelRefresh = createButton('Cancel refresh', 'x');
  cancelRefresh.hidden = true;
  const nativeButton = createButton('Use original directory', 'arrow-left');
  nativeButton.title = 'Use Blackbaud’s original filters and additional contact details.';
  actions.append(refreshButton, cancelRefresh, nativeButton);
  heading.append(title, actions);

  const controls = document.createElement('div');
  controls.className = 'bn-directory-controls';
  const search = document.createElement('input');
  search.type = 'search';
  search.autocomplete = 'off';
  search.maxLength = 200;
  search.placeholder = 'First, last, or preferred name';
  const grades = document.createElement('select');
  const gradeField = labelControl('Grade', grades);
  const order = document.createElement('select');
  order.append(option('last', 'Last name'), option('first', 'First name'));
  controls.append(labelControl('Search people', search, 'search'), gradeField, labelControl('Sort by', order));
  const count = document.createElement('p');
  count.className = 'bn-directory-count';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const limit = document.createElement('p');
  limit.className = 'bn-directory-limit';
  limit.textContent = 'More people may match. Refine your search to narrow the list.';
  const list = document.createElement('ul');
  list.className = 'bn-directory-list';
  list.id = `blackbaud-next-directory-list-${++directoryNumber}`;
  search.setAttribute('aria-controls', list.id);
  const empty = document.createElement('div');
  empty.className = 'bn-directory-empty';
  const emptyMessage = document.createElement('p');
  const reset = createButton('Clear filters', 'x');
  empty.append(emptyMessage, reset);
  const pagination = document.createElement('nav');
  pagination.className = 'bn-directory-pagination';
  pagination.setAttribute('aria-label', 'Directory pages');
  const previous = createButton('Previous', 'chevron-left');
  const pageText = document.createElement('span');
  const next = createButton('Next', 'chevron-right');
  pagination.append(previous, pageText, next);
  const feedback = document.createElement('p');
  feedback.className = 'bn-directory-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  section.append(heading, controls, count, limit, list, empty, pagination, feedback);

  let derived: {
    snapshot: DirectorySnapshot;
    query: string;
    grade: string;
    sort: 'first' | 'last';
    grades: DirectoryGradeCount[];
    searchCounts: Map<string, number>;
    entries: DirectoryEntry[];
  } | null = null;
  const results = () => {
    const localQuery = serverSearch ? '' : query;
    if (!derived || derived.snapshot !== snapshot || derived.query !== localQuery || derived.grade !== grade || derived.sort !== sort) {
      const gradeCounts = directoryGradeCounts(snapshot.entries);
      if (grade && !gradeCounts.some((item) => item.grade === grade)) { grade = ''; page = 1; }
      const matchingNames = filterDirectoryEntries(snapshot.entries, { query: localQuery });
      derived = {
        snapshot, query: localQuery, grade, sort, grades: gradeCounts,
        searchCounts: new Map(directoryGradeCounts(matchingNames).map((item) => [item.grade, item.count])),
        entries: sortDirectoryEntries(grade ? filterDirectoryEntries(matchingNames, { grade }) : matchingNames, sort),
      };
    }
    return derived;
  };
  const renderGrades = () => {
    const { grades: counts, searchCounts } = results();
    const hasGrades = counts.length > 0;
    const moveFocus = !hasGrades && gradeField.contains(document.activeElement);
    gradeField.hidden = !hasGrades;
    grades.disabled = !hasGrades || readKind === 'search';
    controls.classList.toggle('bn-directory-controls-no-grades', !hasGrades);
    grades.replaceChildren(option('', 'All grades'), ...counts.map((item) => option(item.grade, `${item.grade} (${searchCounts.get(item.grade) ?? 0})`)));
    grades.value = grade;
    if (moveFocus) search.focus();
  };
  const row = (entry: DirectoryEntry, revision: number): HTMLLIElement => {
    const item = document.createElement('li');
    item.className = 'bn-directory-row';
    item.dataset.bnDirectoryUser = String(entry.userId);
    const photo = entry.canViewProfile && entry.photoUrl ? directoryThumbnailUrl(entry.photoUrl, url.origin) : '';
    const fullPhoto = settings.downloadFullAvatar && photo ? fullSizePhotoUrl(entry.photoUrl, url.origin) : null;
    const avatar = document.createElement(fullPhoto ? 'a' : 'span');
    avatar.className = 'bn-directory-avatar';
    if (avatar instanceof window.HTMLAnchorElement && fullPhoto) {
      avatar.href = fullPhoto;
      avatar.target = '_blank';
      avatar.rel = 'noopener noreferrer';
      avatar.setAttribute('aria-label', `Open full-size photo of ${entry.displayName}`);
    } else avatar.setAttribute('aria-hidden', 'true');
    const fallback = document.createElement('span');
    fallback.className = 'bn-directory-initials';
    fallback.textContent = initials(entry.displayName);
    fallback.setAttribute('aria-hidden', 'true');
    avatar.append(fallback);
    if (photo) {
      const image = document.createElement('img');
      image.src = photo;
      image.alt = '';
      image.width = 48;
      image.height = 48;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.append(image);
    }
    const person = document.createElement('div');
    person.className = 'bn-directory-person';
    const name = document.createElement(entry.canViewProfile ? 'a' : 'span');
    name.className = 'bn-directory-name';
    name.textContent = entry.displayName;
    if (name instanceof window.HTMLAnchorElement) name.setAttribute('href', `#profile/${entry.userId}/contactcard`);
    person.append(name);
    const schoolGrades = directoryEntryGrades(entry);
    if (entry.canViewProfile && schoolGrades.length) {
      const schoolGrade = document.createElement('div');
      schoolGrade.className = 'bn-directory-grade';
      schoolGrade.textContent = `${schoolGrades.length > 1 ? 'Grades' : 'Grade'} ${schoolGrades.join(', ')}`;
      person.append(schoolGrade);
    }
    if (entry.canViewProfile && entry.email) {
      const email = document.createElement('div');
      email.className = 'bn-directory-email';
      const address = document.createElement('a');
      address.setAttribute('href', `mailto:${encodeURIComponent(entry.email).replace(/%40/gu, '@')}`);
      address.textContent = entry.email;
      const copy = createButton('Copy', 'copy');
      copy.setAttribute('aria-label', `Copy email for ${entry.displayName}`);
      copy.addEventListener('click', () => {
        void (async () => {
          try {
            await window.navigator.clipboard.writeText(entry.email);
            if (current() && renderRevision === revision && item.isConnected) feedback.textContent = `Copied email for ${entry.displayName}.`;
          } catch {
            if (current() && renderRevision === revision && item.isConnected) feedback.textContent = 'Could not copy the email. You can select the address or open your email app.';
          }
        })();
      });
      email.append(address, copy);
      person.append(email);
    }
    item.append(avatar, person);
    return item;
  };
  const renderResults = () => {
    if (!current()) return;
    const searching = readKind === 'search';
    const inviteSearch = serverSearch && !displayedQuery.trim() && snapshot.totalCount === 0 && (lease.searchOnly === true || snapshot.complete === false);
    list.hidden = searching;
    pagination.hidden = searching;
    limit.hidden = searching || inviteSearch || snapshot.complete !== false;
    count.hidden = !searching && inviteSearch;
    if (searching) {
      renderRevision += 1;
      count.textContent = 'Searching directory…';
      empty.hidden = true;
      return;
    }
    const revision = ++renderRevision;
    const resultPage = directoryPage(results().entries, page, DIRECTORY_PAGE_SIZE);
    page = resultPage.page;
    list.replaceChildren(...resultPage.entries.map((entry) => row(entry, revision)));
    const first = (page - 1) * DIRECTORY_PAGE_SIZE + 1;
    const last = first + resultPage.entries.length - 1;
    const noun = resultPage.totalCount === 1 ? 'person' : 'people';
    const partial = snapshot.complete === false;
    const previousPrefix = serverSearch && query !== displayedQuery ? 'Previous results: ' : '';
    const nameFiltered = (serverSearch ? displayedQuery : query).trim() !== '';
    const scope = grade || (!serverSearch && query) ? ` (${snapshot.totalCount} ${partial ? 'loaded' : serverSearch && displayedQuery ? 'search results' : 'in this directory'})` : '';
    count.textContent = resultPage.totalCount ? `${previousPrefix}Showing ${first}–${last} of ${resultPage.totalCount} ${partial ? 'available ' : ''}${noun}${scope}.` : `${previousPrefix}0 people${snapshot.totalCount || nameFiltered || grade ? ` match your filters${scope}` : partial ? ' in the available results' : ' in this directory'}.`;
    empty.hidden = resultPage.totalCount > 0;
    if (inviteSearch) emptyMessage.textContent = 'Search by name to find people in this directory.';
    else if (serverSearch && nameFiltered && !grade) emptyMessage.textContent = 'No people match this search.';
    else emptyMessage.textContent = snapshot.totalCount || nameFiltered || grade ? 'No people match these filters.' : 'No people are listed in this directory.';
    reset.hidden = !query && !grade;
    previous.disabled = page <= 1;
    next.disabled = page >= resultPage.pageCount;
    pageText.textContent = `Page ${page} of ${resultPage.pageCount}`;
  };
  const setPending = (kind: 'search' | 'refresh' | null) => {
    readKind = kind;
    refreshButton.disabled = kind !== null;
    cancelRefresh.hidden = kind !== 'refresh';
    grades.disabled = gradeField.hidden || kind === 'search';
    section.setAttribute('aria-busy', String(kind !== null));
  };
  const cancelPendingRead = () => {
    readRevision += 1;
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
    clearReadDeadline();
    clearReadDeadline = () => {};
    read?.abort();
    read = null;
    setPending(null);
  };
  const requestResults = async (kind: 'search' | 'refresh', requestedQuery: string, revision: number) => {
    if (!current() || revision !== readRevision) return;
    const controller = new AbortController();
    const timeout = new AbortController();
    const deadline = window.setTimeout(() => timeout.abort(new DOMException('The directory request timed out.', 'TimeoutError')), DIRECTORY_REQUEST_TIMEOUT);
    const clearDeadline = () => window.clearTimeout(deadline);
    clearReadDeadline = clearDeadline;
    read = controller;
    setPending(kind);
    feedback.textContent = kind === 'refresh' ? 'Refreshing directory…' : '';
    renderResults();
    let followUpSearch = false;
    try {
      const updated = await fetchSnapshot(target, AbortSignal.any([controller.signal, timeout.signal, signal, lease.signal]), lease.photoBaseUrl, requestedQuery);
      if (!current() || controller.signal.aborted || readRevision !== revision) return;
      const wasServerSearch = serverSearch;
      if (updated.complete === false) serverSearch = true;
      else if (!lease.searchOnly && kind === 'refresh' && requestedQuery === '' && updated.complete === true) serverSearch = false;
      snapshot = updated;
      displayedQuery = requestedQuery;
      followUpSearch = !wasServerSearch && serverSearch && query !== requestedQuery;
      setPending(null);
      renderGrades();
      renderResults();
      feedback.textContent = kind === 'refresh' ? 'Directory refreshed.' : '';
    } catch {
      if (!current() || controller.signal.aborted || readRevision !== revision) return;
      setPending(null);
      renderGrades();
      renderResults();
      feedback.textContent = kind === 'refresh' ? 'Could not refresh. Showing the previous directory results.' : 'Could not search. Showing previous results. Try another name or Refresh to retry.';
    } finally {
      clearDeadline();
      if (clearReadDeadline === clearDeadline) clearReadDeadline = () => {};
      if (current() && readRevision === revision) { read = null; setPending(null); }
    }
    if (followUpSearch && current() && readRevision === revision) scheduleSearch();
  };
  const showSearchInvitation = () => {
    snapshot = { entries: [], totalCount: 0, complete: false };
    displayedQuery = '';
    grade = '';
    page = 1;
    feedback.textContent = '';
    renderGrades();
    renderResults();
  };
  const scheduleSearch = () => {
    cancelPendingRead();
    if (lease.searchOnly && !query.trim()) { showSearchInvitation(); return; }
    const revision = readRevision;
    const requestedQuery = query;
    page = 1;
    setPending('search');
    feedback.textContent = '';
    renderResults();
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined;
      void requestResults('search', requestedQuery, revision);
    }, DIRECTORY_SEARCH_DELAY);
  };
  const refreshResults = () => {
    cancelPendingRead();
    if (lease.searchOnly && !query.trim()) { showSearchInvitation(); return; }
    void requestResults('refresh', serverSearch ? query : '', readRevision);
  };
  search.addEventListener('input', () => {
    query = search.value;
    page = 1;
    if (serverSearch) scheduleSearch();
    else { renderGrades(); renderResults(); }
  });
  grades.addEventListener('change', () => { grade = grades.value; page = 1; renderResults(); });
  order.addEventListener('change', () => { sort = order.value === 'first' ? 'first' : 'last'; page = 1; renderResults(); });
  reset.addEventListener('click', () => {
    const changedQuery = query !== '';
    query = ''; grade = ''; page = 1; search.value = '';
    if (serverSearch && changedQuery) scheduleSearch();
    else { renderGrades(); renderResults(); }
    search.focus();
  });
  previous.addEventListener('click', () => { page -= 1; renderResults(); });
  next.addEventListener('click', () => { page += 1; renderResults(); });
  refreshButton.addEventListener('click', refreshResults);
  cancelRefresh.addEventListener('click', () => { cancelPendingRead(); renderGrades(); renderResults(); feedback.textContent = 'Refresh canceled. Showing the previous directory results.'; });
  nativeButton.addEventListener('click', returnToNative);
  const previousNativeAttribute = lease.root.getAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
  const nativeAttributeValue = `enhanced-${directoryNumber}`;
  renderGrades();
  renderResults();
  header.after(section);
  lease.root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, nativeAttributeValue);
  return () => {
    if (!alive) return;
    alive = false;
    cancelPendingRead();
    section.remove();
    if (lease.root.getAttribute(DIRECTORY_NATIVE_ATTRIBUTE) === nativeAttributeValue) {
      if (previousNativeAttribute === null) lease.root.removeAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
      else lease.root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, previousNativeAttribute);
    }
  };
}
