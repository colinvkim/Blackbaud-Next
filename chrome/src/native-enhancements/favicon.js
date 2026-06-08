(function () {
  const BN = globalThis.BlackbaudNext;

  function apply() {
    if (!BN.shared.routes.isMyschoolApp()) {
      return;
    }

    const existing = document.querySelector("link[data-blackbaud-next-favicon='1']");
    if (existing) {
      return;
    }

    const link = document.createElement("link");
    link.dataset.blackbaudNextFavicon = "1";
    link.rel = "icon";
    link.type = "image/png";
    link.href = browser.runtime.getURL("assets/blackbaud.png");
    document.head.appendChild(link);
  }

  BN.define("nativeEnhancements.favicon", {
    apply,
  });
})();
