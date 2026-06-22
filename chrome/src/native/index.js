(function () {
  const BN = globalThis.BlackbaudNext;

  function install(settings) {
    if (settings.uiMode === BN.shared.settings.UI_MODES.NEXT) {
      BN.native.controller.installEscapeHatch();
      BN.native.controller.installVisibilityStyles();
    }
  }

  BN.define("native.index", {
    install,
  });
})();
