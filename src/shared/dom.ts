import type { Cleanup } from './types.ts';
import { createIcon } from './icons.ts';
import type { IconName } from './icons.ts';

type QueryRoot = Document | Element;
type Watcher = () => void;
const hubs = new WeakMap<QueryRoot, { observer: MutationObserver; watchers: Set<Watcher> }>();
const readyDocuments = new WeakSet<Document>();

export function observeDom(callback: Watcher, signal: AbortSignal, root: QueryRoot = document): Cleanup {
  if (signal.aborted) return () => {};
  let hub = hubs.get(root);
  if (!hub) {
    const watchers = new Set<Watcher>();
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        for (const watcher of watchers) {
          try { watcher(); } catch (error) { console.warn('Blackbaud Next could not update a feature.', error); }
        }
      });
    });
    // Native views reuse elements and activate controls through class/ID changes.
    // Visibility also changes without a rerender, including on loading masks.
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'hidden', 'style', 'href', 'src', 'data-email', 'disabled', 'aria-disabled', 'aria-hidden', 'inert'],
    });
    hub = { observer, watchers };
    hubs.set(root, hub);
  }
  const activeHub = hub;
  activeHub.watchers.add(callback);
  const cleanup = () => {
    activeHub.watchers.delete(callback);
    if (!activeHub.watchers.size) {
      activeHub.observer.disconnect();
      hubs.delete(root);
    }
    signal.removeEventListener('abort', cleanup);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  callback();
  return cleanup;
}

export function watchElements<T extends Element>(
  selector: string,
  mount: (element: T) => Cleanup | void,
  signal: AbortSignal,
  root: QueryRoot = document,
): Cleanup {
  const mounted = new Map<T, Cleanup>();
  const update = () => {
    for (const [element, cleanup] of mounted) {
      if (!element.isConnected || !root.contains(element) || !element.matches(selector)) {
        cleanup();
        mounted.delete(element);
      }
    }
    for (const element of root.querySelectorAll<T>(selector)) {
      if (!mounted.has(element)) mounted.set(element, mount(element) ?? (() => {}));
    }
  };
  const stop = observeDom(update, signal, root);
  const cleanup = () => {
    stop();
    for (const dispose of mounted.values()) dispose();
    mounted.clear();
  };
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}

// Discover self-matching elements once, then examine only added subtrees and
// the elements whose identifying attributes changed. Descendant-dependent
// selectors belong in a scoped observeDom callback instead.
export function watchAddedElements<T extends Element>(
  selector: string,
  mount: (element: T) => Cleanup | void,
  signal: AbortSignal,
  root: QueryRoot = document,
  identifyingAttributes: string[] = ['id', 'class'],
): Cleanup {
  if (signal.aborted) return () => {};
  const mounted = new Map<T, Cleanup>();
  let disposed = false;
  const remove = (element: T) => {
    mounted.get(element)?.();
    mounted.delete(element);
  };
  const consider = (element: T) => {
    if (disposed || signal.aborted) return;
    if (!element.isConnected || !root.contains(element) || !element.matches(selector)) {
      remove(element);
    } else if (!mounted.has(element)) {
      const cleanup = mount(element) ?? (() => {});
      if (disposed || signal.aborted || !element.isConnected || !root.contains(element)) cleanup();
      else mounted.set(element, cleanup);
    }
  };
  const discover = (node: Node) => {
    if (node.nodeType !== 1) return;
    const element = node as T;
    if (element.matches(selector)) consider(element);
    for (const candidate of element.querySelectorAll<T>(selector)) consider(candidate);
  };
  const observer = new MutationObserver((records) => {
    if (disposed) return;
    if (records.some((record) => record.removedNodes.length > 0)) {
      for (const element of mounted.keys()) {
        if (!element.isConnected || !root.contains(element)) remove(element);
      }
    }
    for (const record of records) {
      if (record.type === 'attributes') consider(record.target as T);
      else for (const node of record.addedNodes) discover(node);
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    ...(identifyingAttributes.length ? { attributes: true, attributeFilter: identifyingAttributes } : {}),
  });
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    for (const element of mounted.keys()) remove(element);
    signal.removeEventListener('abort', cleanup);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  for (const element of root.querySelectorAll<T>(selector)) consider(element);
  return cleanup;
}

export function addStyle(id: string, css: string): Cleanup {
  const style = document.createElement('style');
  style.id = `blackbaud-next-${id}`;
  style.textContent = css;
  (document.head ?? document.documentElement).append(style);
  return () => style.remove();
}

export function createButton(text: string, icon?: IconName): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bn-button';
  if (icon) button.append(createIcon(icon));
  button.append(document.createTextNode(text));
  return button;
}

export function isActionable(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[disabled], [aria-disabled="true"], [hidden], [aria-hidden="true"], [inert]')) return false;
  const view = element.ownerDocument.defaultView;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function hasFinishedDomContentLoaded(page: Document): boolean {
  if (page.readyState === 'complete' || readyDocuments.has(page)) return true;
  // A content script can mount after DOMContentLoaded while readyState remains
  // interactive. Navigation timing distinguishes this from pending defer scripts.
  const navigation = page.defaultView?.performance.getEntriesByType?.('navigation') ?? [];
  return navigation.some((entry) => 'domContentLoadedEventEnd' in entry && Number(entry.domContentLoadedEventEnd) > 0);
}

export function waitForReadyElement<T extends HTMLElement>(find: () => T | null, signal: AbortSignal, timeout = 10_000): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  const page = document;
  return new Promise((resolve) => {
    let stop: Cleanup = () => {};
    let settled = false;
    let readyTask: ReturnType<typeof setTimeout> | undefined;
    const finish = (element: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(readyTask);
      stop();
      signal.removeEventListener('abort', abort);
      page.removeEventListener('DOMContentLoaded', parsed);
      page.removeEventListener('readystatechange', check);
      resolve(element);
    };
    const abort = () => finish(null);
    const check = () => {
      if (!hasFinishedDomContentLoaded(page)) return;
      const element = find();
      if (element) finish(element);
    };
    const parsed = () => {
      // Run after the remaining DOMContentLoaded listeners have installed their
      // handlers, including listeners registered after this content script.
      readyTask = setTimeout(() => { readyDocuments.add(page); check(); }, 0);
    };
    const deadline = setTimeout(() => finish(null), Math.max(0, timeout));
    signal.addEventListener('abort', abort, { once: true });
    page.addEventListener('DOMContentLoaded', parsed, { once: true });
    page.addEventListener('readystatechange', check);
    stop = observeDom(check, signal, page);
    if (settled) stop();
  });
}

export function waitForElement<T extends Element>(selector: string, signal: AbortSignal, timeout = 12_000): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let stop: Cleanup = () => {};
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (element: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      signal.removeEventListener('abort', abort);
      resolve(element);
    };
    const abort = () => finish(null);
    timer = setTimeout(() => finish(null), timeout);
    signal.addEventListener('abort', abort, { once: true });
    stop = observeDom(() => {
      const element = document.querySelector<T>(selector);
      if (element) finish(element);
    }, signal);
    // observeDom performs its first check synchronously.
    if (settled) stop();
  });
}
