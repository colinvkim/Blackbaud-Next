(function () {
  const BN = globalThis.BlackbaudNext;

  function runImmediatePatches(settings) {
    const { featureEnabled } = BN.shared.settings;

    if (featureEnabled(settings, "fixFavicon")) {
      BN.nativeEnhancements.favicon.apply();
    }

    if (featureEnabled(settings, "oldAssignmentCenter")) {
      BN.nativeEnhancements.assignmentCenter.enableOldAssignmentCenter();
    }

    if (featureEnabled(settings, "fixInvalidPages")) {
      BN.nativeEnhancements.assignmentCenter.reloadBrokenAssignmentCenter();
    }
  }

  function runObservedPatches(settings) {
    const { featureEnabled } = BN.shared.settings;

    if (featureEnabled(settings, "downloadFullAvatar")) {
      BN.nativeEnhancements.avatarDownload.injectDownloadButtons();
    }

    if (featureEnabled(settings, "rosterTools")) {
      BN.nativeEnhancements.rosterTools.injectRosterCopyButtons();
    }
  }

  function installObservers(settings) {
    if (
      !BN.shared.settings.featureEnabled(settings, "downloadFullAvatar") &&
      !BN.shared.settings.featureEnabled(settings, "rosterTools")
    ) {
      return;
    }

    BN.shared.dom.observeMutations(() => runObservedPatches(settings));
  }

  async function run(settings) {
    if (!BN.shared.routes.isMyschoolApp()) {
      return;
    }

    runImmediatePatches(settings);
    runObservedPatches(settings);
    installObservers(settings);
  }

  BN.define("nativeEnhancements.index", {
    run,
  });
})();
