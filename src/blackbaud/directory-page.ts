import { DIRECTORY_LEASE_LIFETIME, DIRECTORY_NATIVE_ATTRIBUTE, DIRECTORY_OWNER_ATTRIBUTE, DIRECTORY_REQUEST_EVENT, DIRECTORY_RESPONSE_EVENT, DIRECTORY_UI_ATTRIBUTE, directoryRequest } from './directory-protocol.ts';
import type { DirectoryRequest } from './directory-protocol.ts';
import type { Cleanup } from '../shared/types.ts';

type NativeMethod = (this: NativeView, ...args: unknown[]) => unknown;
interface NativeCollection { length: number; toJSON(): unknown; }
interface NativeView {
  template?: string;
  el: HTMLElement;
  model?: { get(key: string): unknown };
  results?: NativeCollection;
  collection?: NativeCollection;
  facets?: NativeCollection;
  getResults?: NativeMethod;
  getFacetValues?: NativeMethod;
  renderResults?: NativeMethod;
  scrollHandler?: NativeMethod;
}
interface NativeModule {
  Data?: { directoryId?: unknown; searchVal?: unknown; searchFacets?: unknown; searchAllFields?: unknown };
  Vs?: { DirectoryList?: { prototype: NativeView } };
}
interface NativeApp {
  _currentMainView?: NativeView;
  _modules?: Record<string, NativeModule>;
  Config?: Record<string, unknown>;
}
type PageWindow = Window & typeof globalThis & { p3?: NativeApp };
type ReplayMethod = 'renderResults' | 'getFacetValues';
type PausedMethod = 'getResults' | ReplayMethod | 'scrollHandler';

interface NativeLease {
  token: string;
  directoryId: string;
  root: HTMLElement;
  view: NativeView;
  lastHeartbeat: number;
  metadata: boolean;
  activated: boolean;
  restores: Cleanup[];
  owed: Map<ReplayMethod, unknown[]>;
}

const recordFields = ['UserID', 'FirstName', 'LastName', 'UserNameFormatted', 'Nickname', 'PublishUserProfile', 'PublishEmail', 'Email', 'EmailBad', 'LargeFileName', 'Grade', 'GradeDisplay', 'GradeNumericDisplay', 'TotalCount'] as const;

// Only the verified native Directory view is adapted. No network, history,
// global event, or AJAX hooks are replaced.
export function installDirectoryPageBridge(page: PageWindow): Cleanup {
  let active: NativeLease | null = null;
  let pending: DirectoryRequest & { timer: number; deadline: number } | null = null;
  let watchdog: number | undefined;
  const routeId = () => /^#directory\/([1-9]\d*)\/?(?:\?.*)?$/i.exec(page.location.hash)?.[1] ?? null;
  const respond = (token: string, payload: Record<string, unknown>) => {
    page.document.dispatchEvent(new page.CustomEvent(DIRECTORY_RESPONSE_EVENT, { detail: JSON.stringify({ token, ...payload }) }));
  };
  const cancelPending = () => {
    if (pending) page.clearTimeout(pending.timer);
    pending = null;
  };
  const currentNativeView = (lease: NativeLease) => routeId() === lease.directoryId && lease.root.isConnected &&
    lease.root.parentElement?.id === 'site-main' && page.p3?._currentMainView === lease.view &&
    lease.view.template === 'directory/directory.template.html' &&
    String(lease.view.model?.get('DirectoryId') ?? lease.view.model?.get('DirectoryID')) === lease.directoryId &&
    String(page.p3?._modules?.['shared/directory']?.Data?.directoryId) === lease.directoryId;
  const valid = (lease: NativeLease | null = active) => !!lease && currentNativeView(lease) &&
    lease.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) === lease.token;
  const release = (notify = true, recover = false) => {
    const owned = active;
    const canRecover = !!owned && recover && valid(owned);
    active = null;
    page.clearInterval(watchdog);
    watchdog = undefined;
    if (!owned) return;
    for (let index = owned.restores.length - 1; index >= 0; index--) {
      try { owned.restores[index]!(); } catch { /* Always attempt every native restoration. */ }
    }
    if (owned.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) === owned.token) {
      owned.root.removeAttribute(DIRECTORY_NATIVE_ATTRIBUTE);
      owned.root.removeAttribute(DIRECTORY_OWNER_ATTRIBUTE);
      for (const ui of owned.root.querySelectorAll(`[${DIRECTORY_UI_ATTRIBUTE}]`)) ui.remove();
    }
    // The retained native GET may have completed while its rendering was
    // paused. Reuse that collection on fallback; never make another results GET.
    if (canRecover) {
      for (const key of ['renderResults', 'getFacetValues'] as const) {
        if (!currentNativeView(owned)) break;
        const args = owned.owed.get(key);
        const method = owned.view[key];
        if (args && typeof method === 'function') {
          try { method.apply(owned.view, args); } catch { /* Other owed work still needs recovery. */ }
        }
      }
    }
    owned.owed.clear();
    if (notify) respond(owned.token, { status: 'released' });
  };
  const patch = (owned: NativeLease, object: NativeView, key: PausedMethod, suppress: (receiver: NativeView) => boolean): Cleanup => {
    const original = object[key];
    if (typeof original !== 'function') return () => {};
    const own = Object.getOwnPropertyDescriptor(object, key);
    const wrapped: NativeMethod = function (...args) {
      if (active === owned && !valid(owned)) release();
      if (active === owned && owned.activated && suppress(this)) {
        if (key === 'renderResults' || key === 'getFacetValues') owned.owed.set(key, args);
        return;
      }
      return original.apply(this, args);
    };
    object[key] = wrapped;
    return () => {
      if (object[key] !== wrapped) return;
      if (own) Object.defineProperty(object, key, own);
      else delete object[key];
    };
  };
  const activate = () => {
    const owned = active;
    if (!owned || !valid(owned)) return false;
    if (owned.activated) return true;
    if (owned.metadata && (['getResults', 'getFacetValues', 'renderResults'] as const).some((key) =>
      typeof owned.view[key] !== 'function')) {
      release(false, true);
      return false;
    }
    owned.activated = true;
    try {
      for (const key of ['getResults', 'getFacetValues', 'renderResults'] as const) {
        owned.restores.push(patch(owned, owned.view, key, (receiver) => receiver === owned.view));
      }
      const prototype = page.p3?._modules?.['shared/directory']?.Vs?.DirectoryList?.prototype;
      if (prototype) owned.restores.push(patch(owned, prototype, 'scrollHandler', (receiver) =>
        !!owned.view.results && receiver.collection === owned.view.results && owned.view.el.contains(receiver.el)));
      return true;
    } catch {
      release(false, true);
      return false;
    }
  };
  const attempt = () => {
    const request = pending;
    if (!request) return;
    if (routeId() !== request.directoryId) { cancelPending(); return; }
    const app = page.p3;
    const view = app?._currentMainView;
    const module = app?._modules?.['shared/directory'];
    const root = view?.el;
    const matches = view?.template === 'directory/directory.template.html' && root?.isConnected && root.parentElement?.id === 'site-main' &&
      String(view.model?.get('DirectoryId') ?? view.model?.get('DirectoryID')) === request.directoryId && String(module?.Data?.directoryId) === request.directoryId;
    const defaultResults = matches ? view?.model?.get('DefaultResults') : undefined;
    if (matches && defaultResults !== undefined && typeof defaultResults !== 'boolean') {
      cancelPending();
      respond(request.token, { status: 'unsupported' });
      return;
    }
    const searchOnly = defaultResults === false;
    if (matches && view && module && root && view.facets && (request.mode !== 'metadata' || ((view.results || searchOnly) && root.querySelector(':scope > #overview')))) {
      const facets = view.facets.toJSON();
      if (!Array.isArray(facets)) {
        cancelPending();
        respond(request.token, { status: 'unsupported' });
        return;
      }
      const records = request.mode === 'metadata' ? null : view.results?.toJSON();
      if (Array.isArray(records) && records.length > 10_000) {
        cancelPending();
        respond(request.token, { status: 'unsupported' });
        return;
      }
      // Preserve an already-started native read for fallback. Search-first
      // directories explicitly skip that initial read and have no collection.
      if (request.mode === 'metadata' || (Array.isArray(records) && (records.length > 0 || root.querySelector('#directory-items-container')))) {
        cancelPending();
        release(true, true);
        active = { token: request.token, directoryId: request.directoryId, root, view, lastHeartbeat: Date.now(), metadata: request.mode === 'metadata', activated: false, restores: [], owed: new Map() };
        watchdog = page.setInterval(check, 2_000);
        try {
          root.setAttribute(DIRECTORY_OWNER_ATTRIBUTE, request.token);
          if (request.mode !== 'metadata' && !activate()) {
            respond(request.token, { status: 'unavailable' });
            return;
          }
          const collection = Array.isArray(records) ? records : [];
          const data = request.mode === 'metadata' ? { mode: 'metadata', searchOnly } : {
            records: collection.map((item: unknown) => {
              const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
              return Object.fromEntries(recordFields.map((key) => {
                const value = source[key];
                return [key, ['string', 'boolean', 'number'].includes(typeof value) ? value : null];
              }));
            }),
            // A new empty collection may still be loading beneath old DOM.
            unfiltered: collection.length > 0 && !module.Data?.searchVal && Array.isArray(module.Data?.searchFacets) && module.Data.searchFacets.length === 0 && !module.Data.searchAllFields,
          };
          respond(request.token, {
            status: 'ready', ...data,
            name: typeof view.model?.get('DirectoryName') === 'string' ? view.model.get('DirectoryName') : 'Directory',
            photoBaseUrl: typeof app?.Config?.PhotonForUserPhotoUrl === 'string' ? app.Config.PhotonForUserPhotoUrl : '',
          });
        } catch {
          release(false, true);
          respond(request.token, { status: 'unavailable' });
        }
        return;
      }
    }
    if (Date.now() >= request.deadline) {
      cancelPending();
      respond(request.token, { status: 'unavailable' });
    } else request.timer = page.setTimeout(attempt, 100);
  };
  const receive = (event: Event) => {
    const request = directoryRequest((event as CustomEvent).detail);
    if (!request) return;
    if (request.action === 'release') {
      if (pending?.token === request.token && pending.directoryId === request.directoryId) cancelPending();
      if (active?.token === request.token && active.directoryId === request.directoryId) release(true, true);
      return;
    }
    if (request.action === 'activate') {
      if (active?.token !== request.token || active.directoryId !== request.directoryId) return;
      if (!valid()) { release(); return; }
      if (activate()) respond(request.token, { status: 'active' });
      else respond(request.token, { status: 'unavailable' });
      return;
    }
    if (routeId() !== request.directoryId) return;
    if (request.action === 'heartbeat') {
      if (active?.token === request.token && valid()) active.lastHeartbeat = Date.now();
      else if (active?.token === request.token) release();
    } else {
      cancelPending();
      // One isolated feature owns one current Directory lease.
      release(true, true);
      pending = { ...request, timer: 0, deadline: Date.now() + 12_000 };
      attempt();
    }
  };
  const navigation = () => {
    // Back/Forward can emit popstate followed by hashchange for one URL. The
    // runtime may already acquire the destination between those notifications.
    if (pending && routeId() !== pending.directoryId) cancelPending();
    if (active && !valid()) release();
  };
  const teardown = () => { cancelPending(); release(); };
  const check = () => {
    if (active && (!valid() || (page.document.visibilityState !== 'hidden' && Date.now() - active.lastHeartbeat > DIRECTORY_LEASE_LIFETIME))) release(true, true);
  };
  page.document.addEventListener(DIRECTORY_REQUEST_EVENT, receive);
  page.document.addEventListener('visibilitychange', check);
  page.addEventListener('hashchange', navigation);
  page.addEventListener('popstate', navigation);
  page.addEventListener('pagehide', teardown);
  return () => {
    teardown();
    page.document.removeEventListener(DIRECTORY_REQUEST_EVENT, receive);
    page.document.removeEventListener('visibilitychange', check);
    page.removeEventListener('hashchange', navigation);
    page.removeEventListener('popstate', navigation);
    page.removeEventListener('pagehide', teardown);
  };
}
