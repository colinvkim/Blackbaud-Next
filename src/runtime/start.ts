import { FeatureController } from './controller.ts';
import { getSettings, subscribeSettings } from '../shared/settings.ts';
import { watchLocation } from '../shared/location.ts';
import type { Settings } from '../shared/settings.ts';
import type { Feature, Cleanup } from '../shared/types.ts';

export interface StartOptions {
  // Read preferences immediately while parser-dependent features wait for a root.
  ready?: (signal: AbortSignal) => Promise<void>;
}

export async function startExtension(features: Feature[], options: StartOptions = {}): Promise<Cleanup> {
  const controller = new FeatureController(features);
  const startup = new AbortController();
  let ready = !options.ready;
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
    if (ready) controller.update(new URL(href), settings);
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
  const stopLocation = watchLocation(refresh, startup.signal);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    startup.abort();
    unsubscribe();
    stopLocation();
    window.removeEventListener('pagehide', cleanup);
    controller.dispose();
  };
  // The entrypoint starts a fresh runtime when pageshow restores the BFCache.
  window.addEventListener('pagehide', cleanup, { once: true });
  const loading = loadSettings();
  const prepare = options.ready;
  const preparing = prepare ? Promise.resolve().then(() => prepare(startup.signal)).then(() => {
    if (disposed) return;
    ready = true;
    refresh();
  }) : Promise.resolve();
  try {
    await Promise.all([loading, preparing]);
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
