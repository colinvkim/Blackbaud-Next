(function () {
  const BN = globalThis.BlackbaudNext;

  const rootId = "blackbaud-next-orbit-root";
  const appMountId = "blackbaud-next-orbit-app";
  const scriptId = "blackbaud-next-orbit-script";
  const stylesheetId = "blackbaud-next-orbit-stylesheet";
  const requestChannel = "blackbaud-next-orbit:request";
  const responseChannel = "blackbaud-next-orbit:response";

  let currentSettings = null;
  let bridgeInstalled = false;
  let bundlePromise = null;
  let lastSession = null;
  let lastConnection = "checking";
  let lastErrorMessage = "";

  function extensionUrl(path) {
    return browser.runtime.getURL(path);
  }

  function ensureRoot() {
    let root = document.getElementById(rootId);

    if (!root) {
      root = document.createElement("div");
      root.id = rootId;
      root.setAttribute("data-blackbaud-next-orbit-host", "1");
      (document.body || document.documentElement).appendChild(root);
    }

    const shadow = root.shadowRoot || root.attachShadow({ mode: "open" });

    let stylesheet = shadow.getElementById(stylesheetId);
    if (!stylesheet) {
      stylesheet = document.createElement("link");
      stylesheet.id = stylesheetId;
      stylesheet.rel = "stylesheet";
      stylesheet.href = extensionUrl("dist/orbit/orbit.css");
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

  function syncRootState(nativeHidden = BN.native.controller.isNativeHidden()) {
    const root = document.getElementById(rootId);
    if (!root) {
      return;
    }

    root.dataset.blackbaudNextOrbitExpanded = nativeHidden ? "1" : "0";
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
      script.src = extensionUrl("dist/orbit/orbit.js");
      script.async = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => {
        reject(new Error("Orbit bundle failed to load."));
      });
      (document.head || document.documentElement).appendChild(script);
    });

    return bundlePromise;
  }

  function serializeError(error) {
    return error instanceof Error ? error.message : "Unknown Orbit host error.";
  }

  function buildPayload() {
    const nativeHidden = BN.native.controller.isNativeHidden();
    syncRootState(nativeHidden);

    return {
      connection: lastConnection,
      errorMessage: lastErrorMessage,
      nativeHidden,
      route: {
        href: window.location.href,
        hash: window.location.hash || "",
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
      BN.native.controller.revealForFallback("orbit-userstatus-failed");
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

      respond(requestId, buildPayload(), `Unsupported Orbit action: ${action}`);
    } catch (error) {
      BN.native.controller.revealForFallback("orbit-host-error");
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

  async function mount(settings) {
    if (settings.uiMode !== BN.shared.settings.UI_MODES.ORBIT) {
      return;
    }

    if (!BN.native.controller.orbitCanOwnCurrentRoute()) {
      return;
    }

    currentSettings = settings;
    BN.native.controller.installEscapeHatch();
    BN.native.controller.installVisibilityStyles();
    ensureRoot();
    installBridge();
    syncRootState();

    try {
      await loadBundle();
    } catch (error) {
      lastConnection = "fallback";
      lastErrorMessage = serializeError(error);
      BN.native.controller.revealForFallback("orbit-bundle-failed");
      syncRootState();
    }
  }

  BN.define("orbit.host", {
    mount,
  });
})();
