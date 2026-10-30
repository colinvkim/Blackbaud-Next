import type { Cleanup } from './types.ts';
import { createIcon } from './icons.ts';
import type { IconName } from './icons.ts';

type QueryRoot = Document | Element;
type Watcher = () => void;
const hubs = new WeakMap<QueryRoot, { observer: MutationObserver; watchers: Set<Watcher> }>();
const readyDocuments = new WeakSet<Document>();

export function markOwned<T extends Element>(element: T): T {
  element.setAttribute('data-bn-owned', '');
  return element;
}

function isOwnedNode(node: Node): boolean {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return Boolean(element?.closest('[data-bn-owned]'));
}

function isRelevantMutation(record: MutationRecord): boolean {
  if (isOwnedNode(record.target)) return false;
  return record.type !== 'childList' || record.removedNodes.length > 0 ||
    [...record.addedNodes].some((node) => !isOwnedNode(node));
}

export function observeDom(callback: Watcher, signal: AbortSignal, root: QueryRoot = document): Cleanup {
  if (signal.aborted) return () => {};
  let hub = hubs.get(root);
  if (!hub) {
    const watchers = new Set<Watcher>();
    let queued = false;
    const observer = new MutationObserver((records) => {
      if (queued || !records.some(isRelevantMutation)) return;
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
      if (!isOwnedNode(element) && !mounted.has(element)) mounted.set(element, mount(element) ?? (() => {}));
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
    if (!element.isConnected || !root.contains(element) || !element.matches(selector) || isOwnedNode(element)) {
      remove(element);
    } else if (!mounted.has(element)) {
      const cleanup = mount(element) ?? (() => {});
      if (disposed || signal.aborted || !element.isConnected || !root.contains(element)) cleanup();
      else mounted.set(element, cleanup);
    }
  };
  const discover = (node: Node) => {
    if (node.nodeType !== 1 || isOwnedNode(node)) return;
    const element = node as T;
    if (element.matches(selector)) consider(element);
    for (const candidate of element.querySelectorAll<T>(selector)) consider(candidate);
  };
  const observer = new MutationObserver((records) => {
    if (disposed) return;
    records = records.filter(isRelevantMutation);
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

export interface ElementContextChange {
  /** The element or one of its ancestors was inserted or removed. */
  moved: boolean;
  /** A visibility or state attribute changed on a strict ancestor. */
  ancestors: boolean;
  /** An attribute changed on the element, or (with subtree) anything inside it changed. */
  contents: boolean;
}

interface ContextWatcher {
  subtree: boolean;
  onChange: (change: ElementContextChange) => void;
  active: boolean;
}

interface ContextEntry {
  element: Element;
  path: Node[];
  watchers: Set<ContextWatcher>;
}

interface ContextHub {
  observer: MutationObserver;
  entries: Map<Element, ContextEntry>;
  descendants: Map<Node, Set<ContextEntry>>;
  subtreeWatchers: number;
}

const CONTEXT_ATTRIBUTES = ['class', 'id', 'style', 'hidden', 'aria-hidden', 'inert', 'disabled', 'aria-disabled', 'href', 'aria-label'];
const contextHubs = new WeakMap<Document, ContextHub>();

function observeContextHub(page: Document, hub: ContextHub): void {
  hub.observer.observe(page, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: CONTEXT_ATTRIBUTES,
    characterData: hub.subtreeWatchers > 0,
  });
}

function unindexContext(hub: ContextHub, entry: ContextEntry): void {
  for (const node of entry.path) {
    const entries = hub.descendants.get(node);
    entries?.delete(entry);
    if (!entries?.size) hub.descendants.delete(node);
  }
  entry.path = [];
}

function indexContext(hub: ContextHub, entry: ContextEntry): void {
  unindexContext(hub, entry);
  for (let node: Node | null = entry.element; node; node = node.parentNode) {
    entry.path.push(node);
    let entries = hub.descendants.get(node);
    if (!entries) { entries = new Set(); hub.descendants.set(node, entries); }
    entries.add(entry);
  }
}

function dispatchContextRecords(hub: ContextHub, records: MutationRecord[]): void {
  const changes = new Map<ContextWatcher, ElementContextChange>();
  const moved = new Set<ContextEntry>();
  const mark = (watcher: ContextWatcher, key: keyof ElementContextChange) => {
    let change = changes.get(watcher);
    if (!change) { change = { moved: false, ancestors: false, contents: false }; changes.set(watcher, change); }
    change[key] = true;
  };
  for (const record of records.filter(isRelevantMutation)) {
    for (let node: Node | null = record.target; node; node = node.parentNode) {
      if (node.nodeType !== 1) continue;
      const entry = hub.entries.get(node as Element);
      if (!entry) continue;
      for (const watcher of entry.watchers) {
        if (watcher.subtree || (node === record.target && record.type === 'attributes')) mark(watcher, 'contents');
      }
    }
    if (record.type === 'attributes') {
      for (const entry of hub.descendants.get(record.target) ?? []) {
        if (entry.element !== record.target) for (const watcher of entry.watchers) mark(watcher, 'ancestors');
      }
    } else if (record.type === 'childList') {
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        for (const entry of hub.descendants.get(node) ?? []) moved.add(entry);
      }
      // A watched element can move into a new wrapper before that wrapper is inserted.
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || isOwnedNode(node)) continue;
        const element = node as Element;
        const own = hub.entries.get(element);
        if (own) moved.add(own);
        for (const child of element.querySelectorAll('*')) {
          const entry = hub.entries.get(child);
          if (entry) moved.add(entry);
        }
      }
    }
  }
  for (const entry of moved) {
    if (hub.entries.get(entry.element) !== entry) continue;
    indexContext(hub, entry);
    for (const watcher of entry.watchers) mark(watcher, 'moved');
  }
  for (const [watcher, change] of changes) {
    if (!watcher.active) continue;
    try { watcher.onChange(change); } catch (error) { console.warn('Blackbaud Next could not update a feature.', error); }
  }
}

export function observeElementContext(
  element: Element,
  onChange: (change: ElementContextChange) => void,
  options: { subtree?: boolean } = {},
): Cleanup {
  const page = element.ownerDocument;
  let hub = contextHubs.get(page);
  if (!hub) {
    const created: ContextHub = {
      observer: new MutationObserver((records) => dispatchContextRecords(created, records)),
      entries: new Map(),
      descendants: new Map(),
      subtreeWatchers: 0,
    };
    hub = created;
    contextHubs.set(page, hub);
    observeContextHub(page, hub);
  }
  const activeHub = hub;
  const watcher: ContextWatcher = { subtree: options.subtree ?? false, onChange, active: true };
  let entry = activeHub.entries.get(element);
  if (!entry) {
    entry = { element, path: [], watchers: new Set() };
    activeHub.entries.set(element, entry);
    indexContext(activeHub, entry);
  }
  const activeEntry = entry;
  activeEntry.watchers.add(watcher);
  if (watcher.subtree && ++activeHub.subtreeWatchers === 1) observeContextHub(page, activeHub);
  return () => {
    if (!watcher.active) return;
    watcher.active = false;
    activeEntry.watchers.delete(watcher);
    if (!activeEntry.watchers.size) {
      unindexContext(activeHub, activeEntry);
      activeHub.entries.delete(element);
    }
    if (watcher.subtree) activeHub.subtreeWatchers -= 1;
    if (!activeHub.entries.size) {
      activeHub.observer.disconnect();
      contextHubs.delete(page);
    } else if (watcher.subtree && activeHub.subtreeWatchers === 0) observeContextHub(page, activeHub);
  };
}

type ManagedStyle = { css: string; references: number } & (
  | { kind: 'sheet'; sheet: CSSStyleSheet }
  | { kind: 'element'; element: HTMLStyleElement }
);
const stylesByDocument = new WeakMap<Document, Map<string, ManagedStyle>>();

export function addStyle(id: string, css: string): Cleanup {
  const page = document;
  let styles = stylesByDocument.get(page);
  if (!styles) { styles = new Map(); stylesByDocument.set(page, styles); }
  let style = styles.get(id);
  if (style && style.css !== css) throw new Error(`Conflicting Blackbaud Next style: ${id}`);
  if (!style) {
    const Sheet = page.defaultView?.CSSStyleSheet;
    if (Sheet?.prototype.replaceSync && 'adoptedStyleSheets' in page) {
      const sheet = new Sheet();
      sheet.replaceSync(css);
      page.adoptedStyleSheets = [...page.adoptedStyleSheets, sheet];
      style = { kind: 'sheet', sheet, css, references: 0 };
    } else {
      const element = markOwned(page.createElement('style'));
      element.id = `blackbaud-next-${id}`;
      element.textContent = css;
      (page.head ?? page.documentElement).append(element);
      style = { kind: 'element', element, css, references: 0 };
    }
    styles.set(id, style);
  }
  const activeStyle = style;
  activeStyle.references += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--activeStyle.references > 0) return;
    if (activeStyle.kind === 'sheet') page.adoptedStyleSheets = page.adoptedStyleSheets.filter((sheet) => sheet !== activeStyle.sheet);
    else activeStyle.element.remove();
    styles.delete(id);
  };
}

export function createButton(text: string, icon?: IconName): HTMLButtonElement {
  const button = markOwned(document.createElement('button'));
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
