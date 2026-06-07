(function () {
  const BN = globalThis.BlackbaudNext;
  const dom = BN.shared.dom;

  const nativeHiddenClass = "blackbaud-next-native-hidden";
  const styleId = "blackbaud-next-native-visibility-style";
  const nativeShellSelectors = ["#app", "#site-main", "app-root"];

  function installVisibilityStyles() {
    dom.injectStyle(
      styleId,
      `
html.${nativeHiddenClass} #app,
html.${nativeHiddenClass} #site-main,
html.${nativeHiddenClass} app-root {
  display: none !important;
}

#blackbaud-next-orbit-root[data-blackbaud-next-orbit-expanded="1"] {
  min-height: 100vh;
}
`,
    );
  }

  function syncOrbitRootState() {
    const orbitRoot = document.getElementById("blackbaud-next-orbit-root");
    if (!orbitRoot) {
      return;
    }

    orbitRoot.dataset.blackbaudNextOrbitExpanded = isNativeHidden() ? "1" : "0";
  }

  function getNativeShells() {
    return nativeShellSelectors.flatMap((selector) => [
      ...document.querySelectorAll(selector),
    ]);
  }

  function hideNativeBlackbaud() {
    installVisibilityStyles();
    document.documentElement.classList.add(nativeHiddenClass);
    syncOrbitRootState();
  }

  function showNativeBlackbaud() {
    document.documentElement.classList.remove(nativeHiddenClass);
    syncOrbitRootState();
  }

  function isNativeHidden() {
    return document.documentElement.classList.contains(nativeHiddenClass);
  }

  function toggleNativeVisibility() {
    if (isNativeHidden()) {
      showNativeBlackbaud();
      return;
    }

    hideNativeBlackbaud();
  }

  function installEscapeHatch() {
    if (document.documentElement.dataset.blackbaudNextEscapeHatch === "1") {
      return;
    }

    document.documentElement.dataset.blackbaudNextEscapeHatch = "1";
    window.addEventListener("keydown", (event) => {
      if (event.altKey && event.shiftKey && event.code === "KeyB") {
        toggleNativeVisibility();
      }
    });
  }

  function revealForFallback(reason) {
    showNativeBlackbaud();
    document.documentElement.dataset.blackbaudNextFallbackReason = reason || "unknown";
  }

  function orbitCanOwnCurrentRoute() {
    return BN.shared.routes.isAuthenticatedLmsPage();
  }

  BN.define("native.controller", {
    getNativeShells,
    hideNativeBlackbaud,
    installEscapeHatch,
    installVisibilityStyles,
    isNativeHidden,
    orbitCanOwnCurrentRoute,
    revealForFallback,
    showNativeBlackbaud,
    toggleNativeVisibility,
  });
})();
