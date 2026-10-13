import type { Cleanup } from '../shared/types.ts';

type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;
interface DirectoryModel {
  get(key: string): unknown;
  fetch: NativeMethod;
}
interface ModelConstructor { prototype: DirectoryModel; }

function modelPrototype(value: unknown): DirectoryModel | null {
  if (typeof value !== 'function') return null;
  const prototype = (value as unknown as ModelConstructor).prototype;
  if (!prototype || typeof prototype.get !== 'function' || typeof prototype.fetch !== 'function') return null;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'fetch');
  if (descriptor ? !('value' in descriptor) || (!descriptor.writable && !descriptor.configurable) : !Object.isExtensible(prototype)) return null;
  return prototype;
}

export function canGuardDirectoryStartup(model: unknown): boolean {
  return modelPrototype(model) !== null;
}

// Guard only the metadata request made by our saved native startup callback.
// The prototype shadow exists for that synchronous invocation; the captured
// callbacks/request remain route-owned without replacing AJAX or app methods.
export function startNativeDirectory(
  page: Window & typeof globalThis,
  model: unknown,
  directoryId: string,
  currentView: () => boolean,
  start: () => void,
): Cleanup {
  const prototype = modelPrototype(model);
  if (!prototype) { start(); return () => {}; }
  const original = prototype.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'fetch');
  const href = page.location.href;
  const startedAt = page.performance.now();
  let settled = false;
  let cancelled = false;
  let request: { abort(): unknown } | null = null;
  const detach = () => {
    page.removeEventListener('hashchange', navigation);
    page.removeEventListener('popstate', navigation);
    page.removeEventListener('pagehide', cancel);
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    cancelled = true;
    detach();
    try { request?.abort(); } catch { /* Route ownership already prevents callbacks from running. */ }
  };
  const navigation = (event: Event) => {
    const departed = event instanceof page.HashChangeEvent && event.newURL && event.timeStamp >= startedAt && event.newURL !== href;
    if (departed || page.location.href !== href || !currentView()) cancel();
  };
  const guarded = (callback: NativeMethod): NativeMethod => function (...args) {
    if (settled) return;
    if (page.location.href !== href || !currentView()) { cancel(); return; }
    settled = true;
    detach();
    return callback.apply(this, args);
  };
  let captured = false;
  const wrapped: NativeMethod = function (...args) {
    const options = args[0];
    const receiver = this as DirectoryModel;
    if (settled || captured || !Object.prototype.isPrototypeOf.call(prototype, receiver) || String(receiver.get('DirectoryId')) !== directoryId ||
      !options || typeof options !== 'object' || Array.isArray(options)) return original.apply(this, args);
    const value = options as Record<string, unknown>;
    const data = value.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
      String((data as Record<string, unknown>).directoryId) !== directoryId || typeof value.success !== 'function' || typeof value.error !== 'function') return original.apply(this, args);
    captured = true;
    const result = original.apply(this, [{ ...value, success: guarded(value.success as NativeMethod), error: guarded(value.error as NativeMethod) }, ...args.slice(1)]);
    if (result && typeof result === 'object' && 'abort' in result && typeof result.abort === 'function') request = result as { abort(): unknown };
    if (cancelled) { try { request?.abort(); } catch { /* The callback is already guarded. */ } }
    return result;
  };
  page.addEventListener('hashchange', navigation);
  page.addEventListener('popstate', navigation);
  page.addEventListener('pagehide', cancel, { once: true });
  try {
    Object.defineProperty(prototype, 'fetch', descriptor
      ? { ...descriptor, value: wrapped }
      : { configurable: true, writable: true, value: wrapped });
    start();
  } catch (error) {
    cancel();
    throw error;
  } finally {
    if (prototype.fetch === wrapped) {
      try {
        if (descriptor) Object.defineProperty(prototype, 'fetch', descriptor);
        else Reflect.deleteProperty(prototype, 'fetch');
      } catch { /* A later frozen descriptor leaves a forwarding wrapper, not another captured read. */ }
    }
    if (!captured) cancel();
  }
  return cancel;
}
