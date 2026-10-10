import { DIRECTORY_OWNER_ATTRIBUTE } from './directory-protocol.ts';
import { INDEPENDENT_DIRECTORY_ATTRIBUTE, INDEPENDENT_DIRECTORY_GATE_LIFETIME, INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, INDEPENDENT_DIRECTORY_REQUEST_EVENT, INDEPENDENT_DIRECTORY_RESPONSE_EVENT, independentDirectoryRequest } from './directory-independent-protocol.ts';
import { createIcon } from '../shared/icons.ts';
import type { Cleanup } from '../shared/types.ts';

type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;
interface NativeView {
  el: HTMLElement;
  template?: string;
  model?: { get(key: string): unknown };
  Page?: { name: string; dispose(): void };
  render?(): NativeView;
  dispose?(): void;
}
interface DirectoryModule {
  Data?: { directoryId?: unknown; searchVal?: unknown; searchFacets?: unknown; searchRun?: unknown; viewType?: unknown };
  Us?: { renderDirectory?: NativeMethod };
  Ms?: { Directory?: unknown };
  Vs?: { Directory?: unknown };
}
interface NativeApp {
  _currentMainView?: NativeView;
  _modules?: Record<string, DirectoryModule>;
  Layout?: { Containers?: { MainPage?: { [index: number]: unknown } } };
  Data?: { Context?: { get(key: string): unknown } };
  Config?: Record<string, unknown>;
  renderMainPage?: NativeMethod;
}
type PageWindow = Window & typeof globalThis & { p3?: NativeApp; Bb?: { View?: new () => NativeView } };
interface Hook {
  app: NativeApp;
  module: DirectoryModule;
  owner: NonNullable<DirectoryModule['Us']>;
  original: NativeMethod;
  wrapped: NativeMethod;
  descriptor?: PropertyDescriptor;
}
interface Lease {
  token: string;
  directoryId: string;
  name: string;
  root: HTMLElement;
  view: NativeView;
  app: NativeApp;
  callback: NativeMethod;
  receiver: unknown;
  args: unknown[];
}

const discoveryDeadline = 12_000;
const acquisitionDeadline = 2_000;
const directoryRoute = /^#directory\/([1-9]\d{0,14})\/?$/i;

// The normal router still selects routes and the native main-page lifecycle
// still disposes previous views. Only the verified directory startup is delayed.
export function installIndependentDirectoryPageBridge(page: PageWindow): Cleanup {
  let hook: Hook | null = null;
  let active: Lease | null = null;
  let suspended: Lease | null = null;
  let gate: { token: string; lastHeartbeat: number } | null = null;
  let pending: { token: string; deadline: number; timer: number } | null = null;
  let acquiring: { token: string; directoryId: string; deadline: number; timer: number } | null = null;
  let watchdog: number | undefined;
  let disposalCheck: number | undefined;
  let recovering = false;
  let nativeNextDirectory: string | null = null;
  const routeId = () => directoryRoute.exec(page.location.hash)?.[1] ?? null;
  const respond = (token: string, payload: Record<string, unknown>) => {
    page.document.dispatchEvent(new page.CustomEvent(INDEPENDENT_DIRECTORY_RESPONSE_EVENT, { detail: JSON.stringify({ token, ...payload }) }));
  };
  const mainRoot = (app: NativeApp) => {
    const root = page.document.getElementById('site-main');
    return root && app.Layout?.Containers?.MainPage?.[0] === root ? root : null;
  };
  const directoryName = (app: NativeApp, id: string): string | null => {
    try {
      const entries = app.Data?.Context?.get('Directories');
      if (!Array.isArray(entries) || entries.length > 500) return null;
      const matches = entries.filter((entry: unknown) => entry && typeof entry === 'object' &&
        Number.isSafeInteger((entry as Record<string, unknown>).DirectoryID) &&
        String((entry as Record<string, unknown>).DirectoryID) === id);
      const name = matches.length === 1 ? (matches[0] as Record<string, unknown>).DirectoryName : null;
      return typeof name === 'string' && name.trim().length > 0 && name.length <= 200 ? name : null;
    } catch { return null; }
  };
  const currentRoute = (lease: Lease) => page.p3 === lease.app && routeId() === lease.directoryId;
  const current = (lease: Lease) => currentRoute(lease) &&
    lease.app._currentMainView === lease.view && lease.root.isConnected &&
    lease.root.parentElement === mainRoot(lease.app) && lease.view.template === 'blackbaud-next/directory' &&
    lease.root.getAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE) === lease.directoryId &&
    lease.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) === lease.token;
  const suspendedCurrent = (lease: Lease) => currentRoute(lease) &&
    lease.app._currentMainView === lease.view && lease.root.isConnected &&
    lease.root.parentElement === mainRoot(lease.app) && lease.view.template === 'blackbaud-next/directory' &&
    !lease.root.hasAttribute(DIRECTORY_OWNER_ATTRIBUTE) && !lease.root.hasAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE);
  const resumeNative = (owned: Lease) => {
    if (owned.root.isConnected && owned.root.parentElement === mainRoot(owned.app)) {
      let pendingUi = owned.root.querySelector<HTMLElement>(`[${INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE}]`);
      if (!pendingUi) {
        pendingUi = page.document.createElement('div');
        pendingUi.setAttribute(INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, '');
        owned.root.append(pendingUi);
      }
      pendingUi.setAttribute('role', 'status');
      pendingUi.textContent = 'Loading original directory…';
    }
    recovering = true;
    try { owned.callback.apply(owned.receiver, owned.args); }
    catch { /* The native route owns its normal error handling. */ }
    finally { recovering = false; }
  };
  const release = (recover: boolean, notify = true, recoverLostView = false) => {
    const owned = active;
    if (!owned) return;
    const canRecover = recover && (current(owned) || (recoverLostView && currentRoute(owned)));
    active = null;
    page.clearTimeout(disposalCheck);
    disposalCheck = undefined;
    if (owned.root.getAttribute(DIRECTORY_OWNER_ATTRIBUTE) === owned.token) {
      owned.root.removeAttribute(DIRECTORY_OWNER_ATTRIBUTE);
      owned.root.removeAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE);
    }
    if (notify) respond(owned.token, { status: 'released', directoryId: owned.directoryId });
    if (canRecover) resumeNative(owned);
  };
  const cancelPending = () => {
    if (pending) page.clearTimeout(pending.timer);
    pending = null;
  };
  const cancelAcquisition = (notify = true) => {
    const request = acquiring;
    acquiring = null;
    if (!request) return;
    page.clearTimeout(request.timer);
    if (notify) respond(request.token, { status: 'unsupported', directoryId: request.directoryId });
  };
  const restoreHook = () => {
    const owned = hook;
    hook = null;
    if (owned && owned.owner.renderDirectory === owned.wrapped) {
      try {
        if (owned.descriptor) Object.defineProperty(owned.owner, 'renderDirectory', owned.descriptor);
        else delete owned.owner.renderDirectory;
      } catch { /* A later descriptor change may prevent restoration; the disabled wrapper forwards natively. */ }
    }
  };
  const disable = (recover: boolean) => {
    gate = null;
    nativeNextDirectory = null;
    cancelPending();
    cancelAcquisition();
    page.clearInterval(watchdog);
    watchdog = undefined;
    release(recover);
    restoreHook();
  };
  const check = () => {
    // A previously started native metadata callback can finish after the user
    // moves to this independent directory. Resume this route once if it stole
    // our main view; never resume a departed route or an unrelated application.
    if (active && !current(active)) release(true, true, true);
    if (gate && (!hook || page.p3 !== hook.app || hook.app._modules?.['shared/directory'] !== hook.module || hook.owner.renderDirectory !== hook.wrapped ||
      (page.document.visibilityState !== 'hidden' && Date.now() - gate.lastHeartbeat > INDEPENDENT_DIRECTORY_GATE_LIFETIME))) disable(true);
  };
  const ready = (token: string, owned: Lease) => respond(token, {
    status: 'ready', directoryId: owned.directoryId, leaseToken: owned.token, name: owned.name,
    photoBaseUrl: typeof owned.app.Config?.PhotonForUserPhotoUrl === 'string' ? owned.app.Config.PhotonForUserPhotoUrl : '',
  });
  const nativeCurrent = (app: NativeApp, id: string) => {
    const view = app._currentMainView;
    if (view?.template !== 'directory/directory.template.html' || !view.el.isConnected || view.el.parentElement !== mainRoot(app)) return false;
    try { return String(view.model?.get('DirectoryId') ?? view.model?.get('DirectoryID')) === id; }
    catch { return false; }
  };
  const attemptAcquisition = () => {
    const request = acquiring;
    if (!request) return;
    check();
    if (acquiring !== request) return;
    if (!gate || !hook || routeId() !== request.directoryId || !mainRoot(hook.app) || !directoryName(hook.app, request.directoryId)) {
      cancelAcquisition();
      return;
    }
    if (active && active.directoryId === request.directoryId && current(active)) {
      const owned = active;
      cancelAcquisition(false);
      ready(request.token, owned);
    } else if (nativeCurrent(hook.app, request.directoryId)) {
      // The native startup began before the preference gate was installed.
      // Preserve the normal bridge instead of replacing an in-flight view.
      cancelAcquisition();
    } else if (Date.now() >= request.deadline) {
      // Content hashchange can run before Backbone invokes the route callback.
      // If that callback never arrives, remove interception before letting the
      // client fall back; a delayed route must not create a competing shell.
      const gateToken = gate.token;
      cancelAcquisition(false);
      disable(true);
      respond(gateToken, { status: 'unsupported' });
      respond(request.token, { status: 'unsupported', directoryId: request.directoryId });
    } else {
      page.clearTimeout(request.timer);
      request.timer = page.setTimeout(attemptAcquisition, 50);
    }
  };
  const createShell = (owned: Hook, id: string, name: string, receiver: unknown, args: unknown[]) => {
    const View = page.Bb?.View;
    const container = mainRoot(owned.app);
    const data = owned.module.Data;
    if (!View || !container || !owned.app.renderMainPage || !data || typeof data !== 'object') return false;
    release(false);
    const view = new View();
    const root = view.el;
    if (!(root instanceof page.HTMLElement)) return false;
    const token = page.crypto.randomUUID();
    const lease: Lease = { token, directoryId: id, name, root, view, app: owned.app, callback: owned.original, receiver, args: [...args] };
    root.setAttribute(INDEPENDENT_DIRECTORY_ATTRIBUTE, id);
    root.setAttribute(DIRECTORY_OWNER_ATTRIBUTE, token);
    const overview = page.document.createElement('header');
    overview.id = 'overview';
    const heading = page.document.createElement('h1');
    heading.textContent = name;
    overview.append(heading);
    const pendingUi = page.document.createElement('div');
    pendingUi.setAttribute(INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE, '');
    pendingUi.setAttribute('role', 'status');
    const message = page.document.createElement('p');
    message.textContent = 'Loading directory…';
    const original = page.document.createElement('button');
    original.type = 'button';
    original.className = 'bn-button';
    original.textContent = 'Use original directory';
    original.prepend(createIcon('arrow-left', page.document));
    original.addEventListener('click', () => { if (active === lease) release(true); });
    pendingUi.append(message, original);
    root.append(overview, pendingUi);
    const dispose = () => {
      if (active !== lease) return;
      if (!currentRoute(lease)) { release(false); return; }
      // Native clearContainer disposes before assigning _currentMainView.
      // Check on the next task so a late native callback is distinguishable
      // from the normal departure lifecycle without patching renderMainPage.
      page.clearTimeout(disposalCheck);
      disposalCheck = page.setTimeout(() => {
        disposalCheck = undefined;
        if (active === lease) check();
      }, 0);
    };
    view.template = 'blackbaud-next/directory';
    view.Page = { name: 'blackbaud-next-directory', dispose };
    view.dispose = dispose;
    view.render = () => { container.append(root); return view; };
    // Match the native route's shared state transition. Otherwise returning
    // from a profile can select the previous directory, and fallback can reuse
    // stale filters after switching away and back through independent views.
    if (data.directoryId !== args[0]) {
      data.searchVal = '';
      data.searchFacets = [];
      data.searchRun = false;
      data.directoryId = args[0];
      data.viewType = -1;
    }
    owned.app.renderMainPage.call(owned.app, view);
    if (page.p3 !== owned.app || owned.app._currentMainView !== view || root.parentElement !== mainRoot(owned.app) || routeId() !== id) {
      root.remove();
      return false;
    }
    active = lease;
    respond(token, { status: 'shell', directoryId: id });
    attemptAcquisition();
    return true;
  };
  const discover = () => {
    const request = pending;
    if (!request) return;
    const app = page.p3;
    const module = app?._modules?.['shared/directory'];
    const owner = module?.Us;
    const original = owner?.renderDirectory;
    if (app && module && owner && typeof original === 'function' && module.Data && typeof module.Data === 'object' &&
      typeof module.Ms?.Directory === 'function' && typeof module.Vs?.Directory === 'function' &&
      typeof app.renderMainPage === 'function' && typeof app.Data?.Context?.get === 'function' &&
      typeof page.Bb?.View === 'function' && app._currentMainView && mainRoot(app)) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'renderDirectory');
      if (descriptor && (!('value' in descriptor) || descriptor.writable === false)) {
        cancelPending();
        respond(request.token, { status: 'unsupported' });
        return;
      }
      const wrapped: NativeMethod = function (...args) {
        const id = routeId();
        const useNative = id !== null && nativeNextDirectory === id && String(args[0]) === id;
        if (useNative) nativeNextDirectory = null;
        const eligible = !useNative && !recovering && gate && hook?.wrapped === wrapped && page.p3 === app &&
          app._modules?.['shared/directory'] === module && mainRoot(app) && id &&
          String(args[0]) === id && (args.length < 2 || args[1] === undefined || args[1] === null || args[1] === '') &&
          Date.now() - gate.lastHeartbeat <= INDEPENDENT_DIRECTORY_GATE_LIFETIME;
        const name = eligible && id ? directoryName(app, id) : null;
        if (name && id && hook) {
          try { if (createShell(hook, id, name, this, args)) return; }
          catch { release(false); }
        }
        try { return original.apply(this, args); }
        finally { attemptAcquisition(); }
      };
      try {
        owner.renderDirectory = wrapped;
        hook = { app, module, owner, original, wrapped, descriptor };
      } catch {
        cancelPending();
        respond(request.token, { status: 'unsupported' });
        return;
      }
      cancelPending();
      gate = { token: request.token, lastHeartbeat: Date.now() };
      watchdog = page.setInterval(check, 2_000);
      respond(request.token, { status: 'enabled' });
    } else if (Date.now() >= request.deadline) {
      cancelPending();
      respond(request.token, { status: 'unsupported' });
    } else request.timer = page.setTimeout(discover, 100);
  };
  const receive = (event: Event) => {
    const request = independentDirectoryRequest((event as CustomEvent).detail);
    if (!request) return;
    if (request.action === 'enable') {
      if (suspended) {
        // Isolated pageshow startup may run before our persisted pageshow
        // listener. Choose the normal bridge until native recovery runs; never
        // arm interception against an ownerless BFCache shell.
        respond(request.token, { status: 'unsupported' });
        return;
      }
      if (gate?.token === request.token) {
        check();
        if (gate) { gate.lastHeartbeat = Date.now(); respond(request.token, { status: 'enabled' }); return; }
      }
      disable(true);
      pending = { token: request.token, timer: 0, deadline: Date.now() + discoveryDeadline };
      discover();
    } else if (request.action === 'heartbeat') {
      if (gate?.token === request.token) { gate.lastHeartbeat = Date.now(); check(); }
    } else if (request.action === 'disable') {
      if (gate?.token === request.token || pending?.token === request.token) disable(true);
    } else if (request.action === 'acquire') {
      check();
      cancelAcquisition();
      const owned = active;
      if (!gate || !hook || routeId() !== request.directoryId || !directoryName(hook.app, request.directoryId)) {
        respond(request.token, { status: 'unsupported', directoryId: request.directoryId });
        return;
      }
      if (owned && owned.directoryId === request.directoryId && current(owned)) ready(request.token, owned);
      else {
        acquiring = { token: request.token, directoryId: request.directoryId, deadline: Date.now() + acquisitionDeadline, timer: 0 };
        attemptAcquisition();
      }
    } else if (request.action === 'original' || request.action === 'release') {
      if (acquiring?.token === request.token && acquiring.directoryId === request.directoryId) {
        // The route callback may not have run yet. Explicit fallback must let
        // its one upcoming startup proceed rather than create an orphan shell.
        if (routeId() === request.directoryId) nativeNextDirectory = request.directoryId;
        cancelAcquisition();
      }
      if (active?.token === request.token && active.directoryId === request.directoryId) release(true);
    }
  };
  const navigation = () => {
    if (nativeNextDirectory && routeId() !== nativeNextDirectory) nativeNextDirectory = null;
    if (active && !current(active)) release(true, true, true);
    if (acquiring && routeId() !== acquiring.directoryId) cancelAcquisition();
  };
  const pagehide = (event: Event) => {
    suspended = (event as PageTransitionEvent).persisted === true && active && current(active) ? active : null;
    disable(false);
  };
  const pageshow = (event: Event) => {
    const owned = suspended;
    suspended = null;
    if ((event as PageTransitionEvent).persisted !== true || !owned || !suspendedCurrent(owned)) return;
    const gateToken = gate?.token ?? pending?.token;
    disable(false);
    if (gateToken) respond(gateToken, { status: 'unsupported' });
    // A persisted document retains _currentMainView even though the isolated
    // runtime removed its UI on pagehide. Start native only after resuming.
    resumeNative(owned);
  };
  page.document.addEventListener(INDEPENDENT_DIRECTORY_REQUEST_EVENT, receive);
  page.document.addEventListener('visibilitychange', check);
  page.addEventListener('hashchange', navigation);
  page.addEventListener('popstate', navigation);
  page.addEventListener('pagehide', pagehide);
  page.addEventListener('pageshow', pageshow);
  return () => {
    suspended = null;
    disable(true);
    page.document.removeEventListener(INDEPENDENT_DIRECTORY_REQUEST_EVENT, receive);
    page.document.removeEventListener('visibilitychange', check);
    page.removeEventListener('hashchange', navigation);
    page.removeEventListener('popstate', navigation);
    page.removeEventListener('pagehide', pagehide);
    page.removeEventListener('pageshow', pageshow);
  };
}
