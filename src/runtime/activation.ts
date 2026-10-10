import type { Cleanup } from '../shared/types.ts';

// Prerendered documents may prepare native Blackbaud, but extension settings,
// authentication metadata, and feature work belong to an activated document.
export function startOnActivation(
  start: () => void,
  page: Document = document,
  view: Window = page.defaultView ?? window,
): Cleanup {
  let disposed = false;
  let started = false;
  let running = false;
  let suspended = false;
  let waiting = false;
  const isPrerendering = () => (page as Document & { prerendering?: boolean }).prerendering === true;
  const stopWaiting = () => {
    page.removeEventListener('prerenderingchange', activated);
    waiting = false;
  };
  const begin = () => {
    if (disposed || running) return;
    if (isPrerendering()) {
      if (!waiting) {
        waiting = true;
        page.addEventListener('prerenderingchange', activated);
      }
      return;
    }
    stopWaiting();
    suspended = false;
    started = true;
    running = true;
    start();
  };
  const activated = () => {
    if (!isPrerendering()) begin();
  };
  const hide = () => {
    stopWaiting();
    if (!started) {
      // A prerender discarded before activation must never start later.
      cleanup();
      return;
    }
    running = false;
    suspended = true;
  };
  const show = (event: PageTransitionEvent) => {
    if (event.persisted && suspended) begin();
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stopWaiting();
    view.removeEventListener('pagehide', hide);
    view.removeEventListener('pageshow', show);
  };
  view.addEventListener('pagehide', hide);
  view.addEventListener('pageshow', show);
  try {
    begin();
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
