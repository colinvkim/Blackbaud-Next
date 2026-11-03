import { fullSizePhotoUrl } from '../blackbaud/avatar.ts';
import type { DirectoryLease } from '../blackbaud/directory-bridge.ts';
import { directoryEntryGrades, directoryGradeCounts, directoryPage, directoryThumbnailUrl, filterDirectoryEntries, sortDirectoryEntries } from '../blackbaud/directory.ts';
import type { DirectoryEntry, DirectoryGradeCount, DirectorySnapshot, DirectoryTarget, fetchDirectorySnapshot } from '../blackbaud/directory.ts';
import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';
import { markOwned, createButton } from '../shared/dom.ts';
import { directoryLayout, rememberDirectoryLayout } from '../shared/directory-layout.ts';
import { createIcon } from '../shared/icons.ts';
import { createScope } from '../shared/scope.ts';
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
  fetchSnapshot: typeof fetchDirectorySnapshot;
}

let directoryNumber = 0;

function ownedElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = markOwned(document.createElement(tag));
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
  const { lease, target, url, settings, signal, isCurrent, fetchSnapshot } = options;
  const header = lease.root.querySelector<HTMLElement>(':scope > #overview');
  if (!header) throw new Error('The native directory heading changed.');
  let alive = true;
  let snapshot: DirectorySnapshot = lease.searchOnly ? { entries: [], totalCount: 0, complete: false } : lease.snapshot;
  let query = '';
  let displayedQuery = '';
  const serverSearch = lease.searchOnly === true || snapshot.complete === false;
  let grade = '';
  let sort: 'first' | 'last' = 'last';
  let page = 1;
  let renderRevision = 0;
  let readRevision = 0;
  let read: AbortController | null = null;
  let searching = false;
  let rowsScope = createScope(signal);
  let searchTimer: number | undefined;
  let clearReadDeadline: Cleanup = () => {};
  const current = () => alive && isCurrent() && lease.root.isConnected && !lease.signal.aborted;
  const section = ownedElement('section', 'bn-directory');
  section.setAttribute('aria-label', lease.name || 'Directory');
  const heading = document.createElement('div');
  heading.className = 'bn-directory-heading';
  const title = document.createElement('h2');
  title.textContent = 'Browse people';

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
  heading.append(title, controls);
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
  list.tabIndex = -1;
  list.setAttribute('aria-label', 'Directory results');
  search.setAttribute('aria-controls', list.id);
  const views = document.createElement('div');
  views.className = 'bn-directory-views';
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Directory view');
  const columnsView = createButton('Columns', 'columns-2');
  const rowsView = createButton('Rows', 'rows-3');
  for (const button of [columnsView, rowsView]) button.setAttribute('aria-controls', list.id);
  views.append(columnsView, rowsView);
  const selectView = (view: 'columns' | 'rows') => {
    if (!current()) return;
    rememberDirectoryLayout(list.ownerDocument, view);
    list.dataset.view = view;
    columnsView.setAttribute('aria-pressed', String(view === 'columns'));
    rowsView.setAttribute('aria-pressed', String(view === 'rows'));
  };
  columnsView.addEventListener('click', () => selectView('columns'));
  rowsView.addEventListener('click', () => selectView('rows'));
  selectView(directoryLayout(list.ownerDocument));
  const resultsBar = document.createElement('div');
  resultsBar.className = 'bn-directory-results-bar';
  resultsBar.append(count, views);
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
  section.append(heading, resultsBar, limit, list, empty, pagination, feedback);

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
    grades.disabled = !hasGrades || searching;
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
    const identity = document.createElement('div');
    identity.className = 'bn-directory-identity';
    const name = document.createElement(entry.canViewProfile ? 'a' : 'span');
    name.className = 'bn-directory-name';
    name.textContent = entry.displayName;
    if (name instanceof window.HTMLAnchorElement) name.setAttribute('href', `#profile/${entry.userId}/contactcard`);
    identity.append(name);
    if (entry.canViewProfile && entry.jobTitle) {
      const jobTitle = document.createElement('div');
      jobTitle.className = 'bn-directory-job-title';
      jobTitle.textContent = entry.jobTitle;
      identity.append(jobTitle);
    }
    const schoolGrades = directoryEntryGrades(entry);
    if (entry.canViewProfile && schoolGrades.length) {
      const schoolGrade = document.createElement('div');
      schoolGrade.className = 'bn-directory-grade';
      schoolGrade.textContent = `${schoolGrades.length > 1 ? 'Grades' : 'Grade'} ${schoolGrades.join(', ')}`;
      identity.append(schoolGrade);
    }
    person.append(identity);
    if (entry.canViewProfile && entry.email) {
      const email = document.createElement('div');
      email.className = 'bn-directory-email';
      const address = document.createElement('a');
      address.setAttribute('href', `mailto:${encodeURIComponent(entry.email).replace(/%40/gu, '@')}`);
      address.textContent = entry.email;
      const copy = createButton('', 'copy');
      copy.classList.add('bn-directory-copy');
      copy.setAttribute('aria-label', `Copy email for ${entry.displayName}`);
      copy.title = 'Copy email address';
      const copyFeedback = document.createElement('span');
      copyFeedback.className = 'bn-directory-copy-feedback';
      copyFeedback.setAttribute('role', 'status');
      copyFeedback.setAttribute('aria-atomic', 'true');
      const copySignal = rowsScope.signal;
      const copyCurrent = () => !copySignal.aborted && current() && renderRevision === revision && item.isConnected;
      let resetTimer: number | undefined;
      const resetCopy = () => {
        copy.replaceChildren(createIcon('copy'));
        copy.title = 'Copy email address';
        copy.removeAttribute('data-copied');
        copyFeedback.removeAttribute('data-error');
        copyFeedback.textContent = '';
      };
      rowsScope.add(() => window.clearTimeout(resetTimer));
      rowsScope.listen(copy, 'click', () => {
        if (!copyCurrent() || copy.disabled) return;
        window.clearTimeout(resetTimer);
        resetCopy();
        copy.disabled = true;
        copy.setAttribute('aria-busy', 'true');
        void (async () => {
          try {
            await window.navigator.clipboard.writeText(entry.email);
            if (!copyCurrent()) return;
            copy.replaceChildren(createIcon('check'));
            copy.title = 'Copied';
            copy.setAttribute('data-copied', 'true');
            copyFeedback.textContent = 'Email copied.';
            resetTimer = window.setTimeout(() => { if (copyCurrent()) resetCopy(); }, 2000);
          } catch {
            if (!copyCurrent()) return;
            copyFeedback.setAttribute('data-error', '');
            copyFeedback.textContent = 'Could not copy. Select the address to copy it manually.';
          } finally {
            if (copyCurrent()) {
              copy.disabled = false;
              copy.removeAttribute('aria-busy');
            }
          }
        })();
      });
      email.append(address, copy, copyFeedback);
      person.append(email);
    }
    if (entry.canViewProfile && (entry.address || entry.phones.length)) {
      const details = document.createElement('details');
      details.className = 'bn-directory-contact';
      const label = entry.phones.length ? 'Contact details' : 'Address';
      const summary = document.createElement('summary');
      summary.setAttribute('aria-label', `${label} for ${entry.displayName}`);
      summary.append(createIcon('chevron-right'), label);
      details.append(summary);
      if (entry.address) {
        const address = document.createElement('address');
        address.textContent = entry.address;
        details.append(address);
      }
      if (entry.phones.length) {
        const phones = document.createElement('dl');
        phones.className = 'bn-directory-phones';
        for (const phone of entry.phones) {
          const group = document.createElement('div');
          const label = document.createElement('dt');
          label.textContent = phone.label;
          const number = document.createElement('dd');
          const link = document.createElement('a');
          link.href = phone.href;
          link.textContent = phone.number;
          number.append(link);
          group.append(label, number);
          phones.append(group);
        }
        details.append(phones);
      }
      person.append(details);
    }
    item.append(avatar, person);
    return item;
  };
  const renderResults = () => {
    if (!current()) return;
    rowsScope.dispose();
    rowsScope = createScope(signal);
    const inviteSearch = serverSearch && !displayedQuery.trim() && snapshot.totalCount === 0 && (lease.searchOnly === true || snapshot.complete === false);
    list.hidden = searching;
    limit.hidden = searching || inviteSearch || snapshot.complete !== false;
    count.hidden = !searching && inviteSearch;
    if (searching) {
      pagination.hidden = true;
      renderRevision += 1;
      count.textContent = 'Searching directory…';
      empty.hidden = true;
      return;
    }
    const revision = ++renderRevision;
    const resultPage = directoryPage(results().entries, page, DIRECTORY_PAGE_SIZE);
    page = resultPage.page;
    pagination.hidden = resultPage.pageCount <= 1;
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
  const setPending = (pending: boolean) => {
    searching = pending;
    grades.disabled = Boolean(gradeField.hidden) || pending;
    section.setAttribute('aria-busy', String(pending));
  };
  const cancelPendingRead = () => {
    readRevision += 1;
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
    clearReadDeadline();
    clearReadDeadline = () => {};
    read?.abort();
    read = null;
    setPending(false);
  };
  const requestResults = async (requestedQuery: string, revision: number) => {
    if (!current() || revision !== readRevision) return;
    const controller = new AbortController();
    const timeout = new AbortController();
    const deadline = window.setTimeout(() => timeout.abort(new DOMException('The directory request timed out.', 'TimeoutError')), DIRECTORY_REQUEST_TIMEOUT);
    const clearDeadline = () => window.clearTimeout(deadline);
    clearReadDeadline = clearDeadline;
    read = controller;
    setPending(true);
    feedback.textContent = '';
    renderResults();
    try {
      const updated = await fetchSnapshot(target, AbortSignal.any([controller.signal, timeout.signal, signal, lease.signal]), lease.photoBaseUrl, requestedQuery);
      if (!current() || controller.signal.aborted || readRevision !== revision) return;
      snapshot = updated;
      displayedQuery = requestedQuery;
      setPending(false);
      renderGrades();
      renderResults();
      feedback.textContent = '';
    } catch {
      if (!current() || controller.signal.aborted || readRevision !== revision) return;
      setPending(false);
      renderGrades();
      renderResults();
      feedback.textContent = 'Could not search. Showing previous results. Try another name.';
    } finally {
      clearDeadline();
      if (clearReadDeadline === clearDeadline) clearReadDeadline = () => {};
      if (current() && readRevision === revision) { read = null; setPending(false); }
    }
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
    setPending(true);
    feedback.textContent = '';
    renderResults();
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined;
      void requestResults(requestedQuery, revision);
    }, DIRECTORY_SEARCH_DELAY);
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
  const changePage = (direction: -1 | 1) => {
    if (!current()) return;
    page += direction;
    renderResults();
    list.focus({ preventScroll: true });
    // The native page top includes its fixed-navigation spacer. Scrolling a
    // result directly into view would instead put it underneath that header.
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  previous.addEventListener('click', () => changePage(-1));
  next.addEventListener('click', () => changePage(1));
  const previousNativeAttribute = lease.root.getAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
  const nativeAttributeValue = `enhanced-${directoryNumber}`;
  renderGrades();
  renderResults();
  header.after(section);
  lease.root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, nativeAttributeValue);
  return () => {
    if (!alive) return;
    alive = false;
    rowsScope.dispose();
    cancelPendingRead();
    section.remove();
    if (lease.root.getAttribute(DIRECTORY_NATIVE_ATTRIBUTE) === nativeAttributeValue) {
      if (previousNativeAttribute === null) lease.root.removeAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
      else lease.root.setAttribute(DIRECTORY_NATIVE_ATTRIBUTE, previousNativeAttribute);
    }
  };
}
