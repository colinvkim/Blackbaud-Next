import { createDirectoryLoadingManager, registerDirectoryLoadingManager } from '../blackbaud/directory-loading.ts';
import type { DirectoryPreparedReader } from '../blackbaud/directory-loading.ts';
import { directoryNavigationIntent, fetchDirectoryPreparedSnapshot } from '../blackbaud/directory.ts';
import { enableIndependentDirectory } from '../blackbaud/directory-independent.ts';
import { isLmsPage } from '../blackbaud/routes.ts';
import { isActionable } from '../shared/dom.ts';
import { watchLocation } from '../shared/location.ts';
import { createScope } from '../shared/scope.ts';
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
      const scope = createScope(signal);
      scope.add(enableIndependentDirectory(scope.signal));
      const manager = createDirectoryLoadingManager(readPrepared);
      scope.add(registerDirectoryLoadingManager(manager));
      scope.add(watchLocation(({ url, transition }) => {
        if (transition) manager.updateRoute(transition.url, transition.timeStamp);
        manager.updateRoute(url);
      }, scope.signal));
      const capture = (event: MouseEvent) => {
        if (scope.signal.aborted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
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
      scope.listen(document, 'click', capture, true);
      scope.listen(window, 'pagehide', scope.dispose, { once: true });
      return scope.dispose;
    },
  };
}

export const directoryLoadingFeature = createDirectoryLoadingFeature();
