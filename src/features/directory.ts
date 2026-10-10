import { fullSizePhotoUrl } from '../blackbaud/avatar.ts';
import { acquireDirectory, DirectoryUnsupportedError } from '../blackbaud/directory-bridge.ts';
import type { DirectoryLease } from '../blackbaud/directory-bridge.ts';
import { directoryEntryGrades, directoryGradeCounts, directoryPage, directoryTargetFromUrl, directoryThumbnailUrl, fetchDirectorySnapshot, filterDirectoryEntries, sortDirectoryEntries } from '../blackbaud/directory.ts';
import type { DirectoryEntry, DirectorySnapshot } from '../blackbaud/directory.ts';
import { DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';
import { INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE } from '../blackbaud/directory-independent-protocol.ts';
import { addStyle, createButton } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import type { IconName } from '../shared/icons.ts';
import type { Cleanup, Feature } from '../shared/types.ts';
import { directoryStyles } from './directory-styles.ts';

export const DIRECTORY_PAGE_SIZE = 50;
export const DIRECTORY_SEARCH_DELAY = 150;
export const DIRECTORY_REQUEST_TIMEOUT = 15_000;

export interface DirectoryFeatureDependencies {
  acquireDirectory: typeof acquireDirectory;
  fetchDirectorySnapshot: typeof fetchDirectorySnapshot;
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

export function createEnhancedDirectoryFeature(overrides: Partial<DirectoryFeatureDependencies> = {}): Feature {
  const dependencies = { acquireDirectory, fetchDirectorySnapshot, ...overrides };
  return {
    id: 'enhanced-directory',
    enabled: (settings) => settings.enhancedDirectory,
    settingsKeys: ['downloadFullAvatar'],
    matches: (url) => directoryTargetFromUrl(url) !== null,
    mount: ({ url, settings, signal }) => {
      const target = directoryTargetFromUrl(url);
      if (signal.aborted || !target) return;
      const removeStyle = addStyle('directory', directoryStyles);
      let disposed = false;
      let acquisition: AbortController | null = null;
      let acquisitionRevision = 0;
      let detachPendingNative: Cleanup = () => {};
      let notice: HTMLElement | null = null;
      let noticeObserver: MutationObserver | null = null;
      let mounted: { lease: DirectoryLease; dispose: Cleanup; detach: Cleanup } | null = null;
      const isCurrent = () => !disposed && !signal.aborted && window.location.href === url.href;
      const clearNotice = () => {
        noticeObserver?.disconnect();
        noticeObserver = null;
        notice?.remove();
        notice = null;
      };
      const noticeHost = () => document.querySelector<HTMLElement>('#site-main #overview') ?? document.getElementById('site-main');
      const restoreNotice = () => {
        // A late lease still has to release its native patches. Its restoration
        // may remove the fallback control that was created while it was pending.
        if (!isCurrent() || mounted || !notice) return;
        if (acquisition && document.querySelector(`#site-main > [${INDEPENDENT_DIRECTORY_ATTRIBUTE}="${target!.directoryId}"] > [${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`)) {
          clearNotice();
          return;
        }
        if (!notice.isConnected) noticeHost()?.append(notice);
      };
      const showNotice = (message: string, action: string, handler: () => void, icon: IconName = 'refresh') => {
        clearNotice();
        if (!isCurrent()) return;
        const host = noticeHost();
        if (!host) return;
        notice = ownedElement('div', 'bn-directory-notice');
        const text = document.createElement('p');
        text.setAttribute('role', 'status');
        text.textContent = message;
        const button = createButton(action, icon);
        button.addEventListener('click', handler);
        notice.append(text, button);
        host.append(notice);
        // Native metadata may replace the main view after fallback has already
        // returned. Retain its switch control across that delayed replacement.
        const main = document.getElementById('site-main');
        if (main) {
          noticeObserver = new window.MutationObserver(restoreNotice);
          noticeObserver.observe(main, { childList: true });
        }
      };
      const cancelAcquisition = () => {
        detachPendingNative();
        detachPendingNative = () => {};
        acquisitionRevision += 1;
        acquisition?.abort();
        acquisition = null;
      };
      const clearMounted = () => {
        const current = mounted;
        mounted = null;
        if (!current) return;
        current.detach();
        current.dispose();
        current.lease.release();
      };
      const returnToNative = () => {
        cancelAcquisition();
        clearMounted();
        showNotice('Using the original Blackbaud directory, with its full search, filters, and contact details.', 'Use enhanced directory', () => { void prepare(true); }, 'users');
      };

      const buildDirectory = (lease: DirectoryLease): Cleanup => {
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

        const renderGrades = () => {
          const counts = directoryGradeCounts(snapshot.entries);
          const hasGrades = counts.length > 0;
          const moveFocus = !hasGrades && gradeField.contains(document.activeElement);
          gradeField.hidden = !hasGrades;
          grades.disabled = !hasGrades || readKind === 'search';
          controls.classList.toggle('bn-directory-controls-no-grades', !hasGrades);
          if (grade && !counts.some((item) => item.grade === grade)) { grade = ''; page = 1; }
          const searchCounts = new Map(directoryGradeCounts(filterDirectoryEntries(snapshot.entries, { query: serverSearch ? '' : query })).map((item) => [item.grade, item.count]));
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
          const results = sortDirectoryEntries(filterDirectoryEntries(snapshot.entries, { query: serverSearch ? '' : query, grade }), sort);
          const resultPage = directoryPage(results, page, DIRECTORY_PAGE_SIZE);
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
            const updated = await dependencies.fetchDirectorySnapshot(target, AbortSignal.any([controller.signal, timeout.signal, signal, lease.signal]), lease.photoBaseUrl, requestedQuery);
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
      };

      async function prepare(focusSearch = false) {
        if (!isCurrent()) return;
        cancelAcquisition();
        clearMounted();
        const revision = acquisitionRevision;
        const controller = new AbortController();
        acquisition = controller;
        // The independent container already has loading feedback and its own
        // native fallback while configuration and people are being read.
        const pending = document.querySelector(`#site-main > [${INDEPENDENT_DIRECTORY_ATTRIBUTE}="${target!.directoryId}"] > [${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`);
        const main = document.getElementById('site-main');
        const nativeAction = (event: Event) => {
          const element = event.target instanceof window.Element ? event.target : event.target instanceof window.Node ? event.target.parentElement : null;
          const button = element?.closest('button');
          const pendingUi = button?.closest(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`);
          const root = pendingUi?.parentElement;
          if (button && button.parentElement === pendingUi && root?.parentElement === main &&
            root?.getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE) === target!.directoryId && isCurrent() &&
            acquisition === controller) returnToNative();
        };
        const detachNativeAction = () => { main?.removeEventListener('click', nativeAction, true); };
        if (main) {
          // Backbone can create the shell after preparation starts. Capture its
          // fallback before the MAIN handler even when that button arrives late.
          main.addEventListener('click', nativeAction, true);
          detachPendingNative = detachNativeAction;
        }
        if (!pending) {
          showNotice('Preparing the enhanced directory…', 'Use original directory', returnToNative, 'arrow-left');
        }
        let lease: DirectoryLease | null = null;
        try {
          lease = await dependencies.acquireDirectory(target!, controller.signal);
          if (!isCurrent() || controller.signal.aborted || revision !== acquisitionRevision || !lease.root.isConnected || lease.signal.aborted) { lease.release(); restoreNotice(); return; }
          acquisition = null;
          clearNotice();
          const dispose = buildDirectory(lease);
          const currentLease = lease;
          const unexpectedRelease = () => {
            if (mounted?.lease !== currentLease) return;
            clearMounted();
            queueMicrotask(() => {
              if (isCurrent() && !mounted && !acquisition) showNotice('The original directory is available. The enhanced view stopped when Blackbaud updated.', 'Try enhanced directory', () => { void prepare(true); }, 'users');
            });
          };
          lease.signal.addEventListener('abort', unexpectedRelease, { once: true });
          mounted = { lease, dispose, detach: () => currentLease.signal.removeEventListener('abort', unexpectedRelease) };
          if (focusSearch) lease.root.querySelector<HTMLInputElement>('.bn-directory input[type="search"]')?.focus();
        } catch (error) {
          lease?.release();
          if (!isCurrent() || controller.signal.aborted || revision !== acquisitionRevision) { restoreNotice(); return; }
          acquisition = null;
          if (error instanceof DirectoryUnsupportedError) { clearNotice(); return; }
          showNotice('This directory is using the original Blackbaud view. The enhanced view could not load.', 'Try again', () => { void prepare(true); });
        } finally {
          detachNativeAction();
          if (detachPendingNative === detachNativeAction) detachPendingNative = () => {};
        }
      }

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        cancelAcquisition();
        clearMounted();
        clearNotice();
        removeStyle();
        signal.removeEventListener('abort', cleanup);
      };
      signal.addEventListener('abort', cleanup, { once: true });
      void prepare();
      return cleanup;
    },
  };
}

export const enhancedDirectoryFeature = createEnhancedDirectoryFeature();
