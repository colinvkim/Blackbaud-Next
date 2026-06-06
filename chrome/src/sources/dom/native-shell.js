(function () {
  const BN = globalThis.BlackbaudNext;

  function getShellKind() {
    if (document.querySelector("app-root")) {
      return "sky";
    }

    if (document.querySelector("#app, #site-main")) {
      return "legacy";
    }

    return "unknown";
  }

  BN.define("sources.dom.nativeShell", {
    getShellKind,
  });
})();
