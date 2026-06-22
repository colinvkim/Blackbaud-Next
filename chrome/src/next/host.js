(function () {
  const BN = globalThis.BlackbaudNext;

  const rootId = "blackbaud-next-root";
  const appMountId = "blackbaud-next-app";
  const scriptId = "blackbaud-next-script";
  const stylesheetId = "blackbaud-next-stylesheet";
  const fontStyleId = "blackbaud-next-fonts";
  const requestChannel = "blackbaud-next:request";
  const responseChannel = "blackbaud-next:response";
  const eventChannel = "blackbaud-next:event";

  let currentSettings = null;
  let bridgeInstalled = false;
  let bundlePromise = null;
  let lastSession = null;
  let lastConnection = "checking";
  let lastErrorMessage = "";
  let routeWatcherInstalled = false;

  function extensionUrl(path) {
    return browser.runtime.getURL(path);
  }

  function ensureFonts() {
    if (document.getElementById(fontStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = fontStyleId;
    style.textContent = `
@font-face {
  font-display: swap;
  font-family: "Inter Variable";
  font-style: normal;
  font-weight: 100 900;
  src: url("${extensionUrl("dist/next/inter-latin-wght-normal.woff2")}") format("woff2-variations");
  unicode-range:
    U+0000-00ff,
    U+0131,
    U+0152-0153,
    U+02bb-02bc,
    U+02c6,
    U+02da,
    U+02dc,
    U+0304,
    U+0308,
    U+0329,
    U+2000-206f,
    U+20ac,
    U+2122,
    U+2191,
    U+2193,
    U+2212,
    U+2215,
    U+feff,
    U+fffd;
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureRoot() {
    let root = document.getElementById(rootId);

    if (!root) {
      root = document.createElement("div");
      root.id = rootId;
      root.setAttribute("data-blackbaud-next-host", "1");
      (document.body || document.documentElement).appendChild(root);
    }

    const shadow = root.shadowRoot || root.attachShadow({ mode: "open" });

    let stylesheet = shadow.getElementById(stylesheetId);
    if (!stylesheet) {
      stylesheet = document.createElement("link");
      stylesheet.id = stylesheetId;
      stylesheet.rel = "stylesheet";
      stylesheet.href = extensionUrl("dist/next/next.css");
      shadow.appendChild(stylesheet);
    }

    let mount = shadow.getElementById(appMountId);
    if (!mount) {
      mount = document.createElement("div");
      mount.id = appMountId;
      shadow.appendChild(mount);
    }

    return root;
  }

  function setRootVisible(visible) {
    const root = document.getElementById(rootId);
    if (!root) {
      return;
    }

    root.style.display = visible ? "" : "none";
  }

  function syncRootState(nativeHidden = BN.native.controller.isNativeHidden()) {
    const root = document.getElementById(rootId);
    if (!root) {
      return;
    }

    root.dataset.blackbaudNextExpanded = nativeHidden ? "1" : "0";
  }

  function loadBundle() {
    if (bundlePromise) {
      return bundlePromise;
    }

    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      bundlePromise = Promise.resolve();
      return bundlePromise;
    }

    bundlePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = extensionUrl("dist/next/next.js");
      script.async = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => {
        reject(new Error("Next bundle failed to load."));
      });
      (document.head || document.documentElement).appendChild(script);
    });

    return bundlePromise;
  }

  function serializeError(error) {
    return error instanceof Error ? error.message : "Unknown Next host error.";
  }

  function buildPayload() {
    const nativeHidden = BN.native.controller.isNativeHidden();
    const nextPage = BN.shared.routes.getNextPageRoute();
    syncRootState(nativeHidden);

    return {
      connection: lastConnection,
      errorMessage: lastErrorMessage,
      nativeHidden,
      route: {
        href: window.location.href,
        hash: window.location.hash || "",
        nextPage,
        schoolHostname: BN.shared.routes.getSchoolHostname(),
        shellKind: BN.sources.dom.nativeShell.getShellKind(),
      },
      session: lastSession,
      settings: {
        uiMode: currentSettings?.uiMode || "",
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async function refreshSession() {
    try {
      lastSession = await BN.sources.api.client.getUserStatus();
      lastConnection = "connected";
      lastErrorMessage = "";
    } catch (error) {
      lastSession = null;
      lastConnection = "fallback";
      lastErrorMessage = serializeError(error);
      BN.native.controller.revealForFallback("next-userstatus-failed");
    }

    return buildPayload();
  }

  function respond(requestId, payload, errorMessage = "") {
    window.postMessage(
      {
        channel: responseChannel,
        requestId,
        ok: !errorMessage,
        payload,
        error: errorMessage,
      },
      window.location.origin,
    );
  }

  function publishPayload(payload = buildPayload()) {
    window.postMessage(
      {
        channel: eventChannel,
        payload,
      },
      window.location.origin,
    );
  }

  async function handleBridgeRequest(event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const detail = event.data || {};
    if (detail.channel !== requestChannel) {
      return;
    }

    const { action, requestId } = detail;

    if (!requestId || !currentSettings) {
      return;
    }

    try {
      if (action === "bootstrap" || action === "refresh-session") {
        respond(requestId, await refreshSession());
        return;
      }

      if (action === "toggle-native") {
        BN.native.controller.toggleNativeVisibility();
        respond(requestId, buildPayload());
        return;
      }

      respond(requestId, buildPayload(), `Unsupported Next action: ${action}`);
    } catch (error) {
      BN.native.controller.revealForFallback("next-host-error");
      respond(requestId, buildPayload(), serializeError(error));
    }
  }

  function installBridge() {
    if (bridgeInstalled) {
      return;
    }

    bridgeInstalled = true;
    window.addEventListener("message", handleBridgeRequest);
  }

  async function syncCurrentRoute(settings) {
    currentSettings = settings;

    if (
      settings.uiMode !== BN.shared.settings.UI_MODES.NEXT ||
      !BN.native.controller.nextCanOwnCurrentRoute()
    ) {
      BN.native.controller.showNativeBlackbaud();
      setRootVisible(false);
      publishPayload();
      return;
    }

    BN.native.controller.installEscapeHatch();
    BN.native.controller.installVisibilityStyles();
    BN.native.controller.hideNativeBlackbaud();
    ensureFonts();
    ensureRoot();
    setRootVisible(true);
    installBridge();
    syncRootState();
    publishPayload();

    try {
      await loadBundle();
      publishPayload();
    } catch (error) {
      lastConnection = "fallback";
      lastErrorMessage = serializeError(error);
      BN.native.controller.revealForFallback("next-bundle-failed");
      syncRootState();
      publishPayload();
    }
  }

  function scheduleRouteSync(settings) {
    window.setTimeout(() => {
      syncCurrentRoute(settings).catch((error) => {
        lastConnection = "fallback";
        lastErrorMessage = serializeError(error);
        BN.native.controller.revealForFallback("next-route-sync-failed");
        publishPayload();
      });
    }, 0);
  }

  function installRouteWatcher(settings) {
    if (routeWatcherInstalled) {
      return;
    }

    routeWatcherInstalled = true;
    window.addEventListener("hashchange", () => scheduleRouteSync(settings));
    window.addEventListener("popstate", () => scheduleRouteSync(settings));
  }

  async function mount(settings) {
    if (settings.uiMode !== BN.shared.settings.UI_MODES.NEXT) {
      return;
    }

    installRouteWatcher(settings);
    await syncCurrentRoute(settings);
  }

  BN.define("next.host", {
    mount,
  });
})();
