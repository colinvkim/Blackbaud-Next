import type { Cleanup } from './types.ts';

export interface LocationChange {
  url: URL;
  transition?: { url: URL; timeStamp: number };
}

type LocationListener = (change: LocationChange) => void;

interface LocationSource {
  subscribe: (listener: LocationListener, signal: AbortSignal) => Cleanup;
}

declare global {
  interface Window {
    __blackbaudNextLocationV1?: LocationSource;
  }
}

function createLocationSource(target: Window & typeof globalThis): LocationSource {
  const subscribers = new Set<{ listener: LocationListener; signal: AbortSignal }>();
  let href = target.location.href;
  const notify = (listener: LocationListener, change: LocationChange) => {
    try { listener(change); } catch (error) { console.warn('Blackbaud Next could not update a route.', error); }
  };
  const update = (event?: Event) => {
    const url = new URL(target.location.href);
    let transition: LocationChange['transition'];
    if (event instanceof target.HashChangeEvent && event.newURL) {
      try {
        const destination = new URL(event.newURL);
        if (destination.origin === url.origin) transition = { url: destination, timeStamp: event.timeStamp };
      } catch {}
    }
    if (href === url.href && !transition) return;
    href = url.href;
    const change: LocationChange = { url, ...(transition ? { transition } : {}) };
    for (const subscriber of [...subscribers]) {
      if (subscribers.has(subscriber) && !subscriber.signal.aborted) notify(subscriber.listener, change);
    }
  };
  const navigation = 'navigation' in target && target.navigation instanceof target.EventTarget ? target.navigation : null;
  target.addEventListener('hashchange', update);
  target.addEventListener('popstate', update);
  navigation?.addEventListener('currententrychange', update);
  const timer = target.setInterval(update, navigation ? 2_000 : 300);
  const source: LocationSource = {
    subscribe(listener, signal) {
      const subscriber = { listener, signal };
      subscribers.add(subscriber);
      const cleanup = () => {
        if (!subscribers.delete(subscriber)) return;
        signal.removeEventListener('abort', cleanup);
        if (subscribers.size) return;
        target.clearInterval(timer);
        target.removeEventListener('hashchange', update);
        target.removeEventListener('popstate', update);
        navigation?.removeEventListener('currententrychange', update);
        if (target.__blackbaudNextLocationV1 === source) delete target.__blackbaudNextLocationV1;
      };
      signal.addEventListener('abort', cleanup, { once: true });
      notify(listener, { url: new URL(target.location.href) });
      return cleanup;
    },
  };
  return source;
}

export function watchLocation(listener: LocationListener, signal: AbortSignal): Cleanup {
  if (signal.aborted) return () => {};
  const source = window.__blackbaudNextLocationV1 ?? createLocationSource(window);
  window.__blackbaudNextLocationV1 = source;
  return source.subscribe(listener, signal);
}
