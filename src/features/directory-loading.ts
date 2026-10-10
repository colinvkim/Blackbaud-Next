import { createDirectoryLoadingManager, registerDirectoryLoadingManager } from '../blackbaud/directory-loading.ts';
import type { DirectoryPreparedReader } from '../blackbaud/directory-loading.ts';
import { directoryNavigationIntent, fetchDirectoryPreparedSnapshot } from '../blackbaud/directory.ts';
import { enableIndependentDirectory } from '../blackbaud/directory-independent.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { isActionable } from '../shared/dom.ts';
import type { Feature } from '../shared/types.ts';

export function createDirectoryLoadingFeature(readPrepared: DirectoryPreparedReader = fetchDirectoryPreparedSnapshot): Feature {
  return {
    id: 'directory-loading',
    enabled: (settings) => settings.enhancedDirectory,
    settingsKeys: [],
    routeScope: 'document',
    matches: (url) => isLmsPage(url) && !url.username && !url.password && /^\/app\/[^/]+\/?$/.test(url.pathname),
    mount: ({ signal }) => {
      if (signal.aborted) return;
      const disableIndependentDirectory = enableIndependentDirectory(signal);
      const manager = createDirectoryLoadingManager(readPrepared);
      const unregister = registerDirectoryLoadingManager(manager);
      let disposed = false;
      let href = window.location.href;
      const updateRoute = (event?: Event) => {
        if (event instanceof window.HashChangeEvent && event.newURL) {
          try {
            // Hash events can be queued after a quick destination→source
            // return. Keep that transition evidence before checking the live
            // URL, or the abandoned read could look like its original intent.
            const transition = new URL(event.newURL);
            if (transition.origin === window.location.origin) manager.updateRoute(transition, event.timeStamp);
          } catch { /* Generic/malformed events still reconcile the live URL. */ }
        }
        href = window.location.href;
        manager.updateRoute(new URL(href));
      };
      const capture = (event: MouseEvent) => {
        if (disposed || signal.aborted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const element = event.target instanceof window.Element ? event.target : event.target instanceof window.Node ? event.target.parentElement : null;
        const anchor = element?.closest<HTMLAnchorElement>('a[href]');
        if (!anchor || !isActionable(anchor) || anchor.hasAttribute('download')) return;
        const target = (anchor.getAttribute('target') ?? document.querySelector('base[target]')?.getAttribute('target') ?? '').trim().toLowerCase();
        if (target && target !== '_self') return;
        const source = new URL(window.location.href);
        manager.updateRoute(source);
        const intent = directoryNavigationIntent(anchor, source);
        if (intent) manager.start(intent.target, source, intent.url);
      };
      document.addEventListener('click', capture, true);
      window.addEventListener('hashchange', updateRoute);
      window.addEventListener('popstate', updateRoute);
      // Native pushState executes in another JS world. Compare only the URL;
      // no document observer or navigation interception is needed.
      const navigationCheck = window.setInterval(() => { if (window.location.href !== href) updateRoute(); }, 300);
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        unregister();
        disableIndependentDirectory();
        clearInterval(navigationCheck);
        document.removeEventListener('click', capture, true);
        window.removeEventListener('hashchange', updateRoute);
        window.removeEventListener('popstate', updateRoute);
        window.removeEventListener('pagehide', cleanup);
        signal.removeEventListener('abort', cleanup);
      };
      window.addEventListener('pagehide', cleanup, { once: true });
      signal.addEventListener('abort', cleanup, { once: true });
      return cleanup;
    },
  };
}

export const directoryLoadingFeature = createDirectoryLoadingFeature();
