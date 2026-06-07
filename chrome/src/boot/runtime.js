(function () {
  const BN = globalThis.BlackbaudNext;

  async function run() {
    const settings = await BN.shared.settings.getSettings();
    const modes = BN.shared.settings.UI_MODES;

    await BN.auth.index.run(settings);
    BN.native.index.install(settings);

    if (settings.uiMode === modes.ORIGINAL) {
      BN.auth.loadingOverlay.hide();
      BN.native.controller.showNativeBlackbaud();
      return;
    }

    if (settings.uiMode === modes.ENHANCED) {
      await BN.legacyPatches.index.run(settings);
      return;
    }

    if (settings.uiMode === modes.ORBIT) {
      await BN.orbit.host.mount(settings);
    }
  }

  BN.define("boot.runtime", {
    run,
  });
})();
