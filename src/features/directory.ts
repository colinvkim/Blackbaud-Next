import { acquireDirectory, DirectoryUnsupportedError } from '../blackbaud/directory-bridge.ts';
import type { DirectoryLease } from '../blackbaud/directory-bridge.ts';
import { directoryTargetFromUrl, fetchDirectorySnapshot } from '../blackbaud/directory.ts';
import { DIRECTORY_UI_ATTRIBUTE } from '../blackbaud/directory-protocol.ts';
import { INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE } from '../blackbaud/directory-independent-protocol.ts';
import { addStyle, createButton } from '../shared/dom.ts';
import type { IconName } from '../shared/icons.ts';
import type { Cleanup, Feature } from '../shared/types.ts';
import { directoryStyles } from './directory-styles.ts';
import { buildDirectoryView } from './directory-view.ts';

export { DIRECTORY_PAGE_SIZE, DIRECTORY_SEARCH_DELAY, DIRECTORY_REQUEST_TIMEOUT } from './directory-view.ts';

export interface DirectoryFeatureDependencies {
  acquireDirectory: typeof acquireDirectory;
  fetchDirectorySnapshot: typeof fetchDirectorySnapshot;
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
        notice = document.createElement('div');
        notice.className = 'bn-directory-notice';
        notice.setAttribute(DIRECTORY_UI_ATTRIBUTE, '');
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
          noticeObserver.observe(main, { childList: true, subtree: true });
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
          const dispose = buildDirectoryView({ lease, target: target!, url, settings, signal, isCurrent, returnToNative, fetchSnapshot: dependencies.fetchDirectorySnapshot });
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
