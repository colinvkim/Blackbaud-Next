import { addStyle } from './dom.ts';
import type { Cleanup } from './types.ts';

export function createScope(parent: AbortSignal) {
  const controller = new AbortController();
  const ListenerController = globalThis.document?.defaultView?.AbortController ?? AbortController;
  const listeners = ListenerController === AbortController ? controller : new ListenerController();
  const cleanups = new Set<Cleanup>();
  const add = (cleanup: Cleanup): Cleanup => {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      cleanups.delete(release);
      cleanup();
    };
    if (controller.signal.aborted) release();
    else cleanups.add(release);
    return release;
  };
  const dispose = () => {
    if (controller.signal.aborted) return;
    parent.removeEventListener('abort', dispose);
    controller.abort();
    if (listeners !== controller) listeners.abort();
    for (const cleanup of [...cleanups].reverse()) {
      try { cleanup(); } catch (error) { console.warn('Blackbaud Next could not clean up a feature.', error); }
    }
  };
  function listen<K extends keyof WindowEventMap>(target: Window, type: K, listener: (event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  function listen<K extends keyof DocumentEventMap>(target: Document, type: K, listener: (event: DocumentEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  function listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  function listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  function listen(target: EventTarget, type: string, listener: EventListener, options: boolean | AddEventListenerOptions = {}): void {
    target.addEventListener(type, listener, { ...(typeof options === 'boolean' ? { capture: options } : options), signal: listeners.signal });
  }
  parent.addEventListener('abort', dispose, { once: true });
  if (parent.aborted) dispose();
  return {
    signal: controller.signal,
    add,
    listen,
    style: (id: string, css: string) => { if (!controller.signal.aborted) add(addStyle(id, css)); },
    dispose,
  };
}
