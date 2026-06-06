(function () {
  const BN = globalThis.BlackbaudNext;
  const dom = BN.shared.dom;

  const overlayPersistKey = "blackbaud-next-auto-login-overlay-persist";
  const overlayId = "blackbaud-next-auto-login-overlay";
  const styleId = "blackbaud-next-auto-login-style";

  function shouldPersistOverlayOnCurrentPage() {
    const routes = BN.shared.routes;
    return routes.isBlackbaudSignin() || routes.isGoogleBlackbaudOAuth();
  }

  function setOverlayPersistence(shouldPersist) {
    if (shouldPersist) {
      sessionStorage.setItem(overlayPersistKey, "1");
      return;
    }

    sessionStorage.removeItem(overlayPersistKey);
  }

  function hide() {
    dom.removeElementById(overlayId);
    dom.removeElementById(styleId);
  }

  function show(settings) {
    const featureEnabled = BN.shared.settings.featureEnabled;
    if (
      !featureEnabled(settings, "automaticLogin") ||
      !featureEnabled(settings, "loadingOverlay")
    ) {
      return;
    }

    if (document.getElementById(overlayId)) {
      return;
    }

    dom.injectStyle(
      styleId,
      `
.blackbaud-next-loading-overlay {
  position: fixed;
  inset: 0;
  background: #fff;
  opacity: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 999999;
  pointer-events: auto;
}

.blackbaud-next-loading-spinner {
  width: 64px;
  height: 64px;
  border: 4px solid rgba(255, 200, 0, 0.3);
  border-top: 4px solid #facc15;
  border-radius: 50%;
  animation: blackbaud-next-spin 1s linear infinite;
  margin-bottom: 16px;
}

.blackbaud-next-loading-text {
  color: #112b55 !important;
  font-family: Arial, sans-serif !important;
  font-size: 20px !important;
  font-weight: 600 !important;
}

@keyframes blackbaud-next-spin {
  to {
    transform: rotate(360deg);
  }
}
`,
    );

    const loadingOverlay = document.createElement("div");
    const loadingSpinner = document.createElement("div");
    const loadingText = document.createElement("h2");

    loadingOverlay.id = overlayId;
    loadingOverlay.className = "blackbaud-next-loading-overlay";
    loadingSpinner.className = "blackbaud-next-loading-spinner";
    loadingText.className = "blackbaud-next-loading-text";
    loadingText.textContent = "Signing you in...";

    loadingOverlay.append(loadingSpinner, loadingText);
    (document.body || document.documentElement).appendChild(loadingOverlay);
  }

  function restoreIfNeeded(settings) {
    const shouldRestore =
      sessionStorage.getItem(overlayPersistKey) === "1" &&
      shouldPersistOverlayOnCurrentPage();

    if (shouldRestore) {
      show(settings);
    }
  }

  BN.define("auth.loadingOverlay", {
    hide,
    restoreIfNeeded,
    setOverlayPersistence,
    show,
  });
})();
