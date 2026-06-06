(function () {
  const BN = globalThis.BlackbaudNext;

  function apply() {
    if (!BN.shared.routes.isMyschoolApp()) {
      return;
    }

    BN.shared.dom.injectStyle(
      "blackbaud-next-wide-layout-style",
      `
.container {
  width: 100% !important;
}

.nav,
ul.topnav,
ul.clearfix:has(li) {
  width: 100% !important;
  display: flex !important;
  justify-content: center !important;
}
`,
    );
  }

  BN.define("legacyPatches.wideLayout", {
    apply,
  });
})();
