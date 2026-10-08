import { FeatureController } from './controller.ts';
import { getSettings, subscribeSettings } from '../shared/settings.ts';
import type { Settings } from '../shared/settings.ts';
import type { Feature, Cleanup } from '../shared/types.ts';

export async function startExtension(features: Feature[]): Promise<Cleanup> {
  const controller = new FeatureController(features);
  let settings: Settings | null = null;
  let disposed = false;
  let reading = 0;
  let loadingRevision: number | null = null;
  let href = window.location.href;
  const refresh = () => {
    if (disposed) return;
    const currentHref = window.location.href;
    const navigated = href !== currentHref;
    href = currentHref;
    if (!settings) {
      // Retry once on a real navigation, without polling failed storage reads.
      if (navigated && loadingRevision === null) void loadSettings();
      return;
    }
    controller.update(new URL(href), settings);
  };
  const loadSettings = async () => {
    const revision = ++reading;
    loadingRevision = revision;
    try {
      const next = await getSettings();
      if (disposed || revision !== reading) return;
      settings = next;
      refresh();
    } catch (error) {
      if (disposed || revision !== reading) return;
      // Remove active enhancements if their settings can no longer be read.
      settings = null;
      controller.dispose();
      console.warn('Blackbaud Next could not read settings.', error);
    } finally {
      if (loadingRevision === revision) loadingRevision = null;
    }
  };
  const unsubscribe = subscribeSettings(() => { void loadSettings(); });
  window.addEventListener('hashchange', refresh);
  window.addEventListener('popstate', refresh);
  // pushState runs in Blackbaud's isolated page environment. Observe its URL
  // without patching native history or injecting a privileged page bridge.
  const navigationCheck = window.setInterval(() => {
    if (window.location.href !== href) refresh();
  }, 300);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    clearInterval(navigationCheck);
    window.removeEventListener('hashchange', refresh);
    window.removeEventListener('popstate', refresh);
    window.removeEventListener('pagehide', cleanup);
    controller.dispose();
  };
  // The entrypoint starts a fresh runtime when pageshow restores the BFCache.
  window.addEventListener('pagehide', cleanup, { once: true });
  await loadSettings();
  return cleanup;
}
