(function () {
  const BN = globalThis.BlackbaudNext;

  function runImmediatePatches(settings) {
    const { featureEnabled } = BN.shared.settings;

    if (featureEnabled(settings, "wideLayout")) {
      BN.legacyPatches.wideLayout.apply();
    }

    if (featureEnabled(settings, "fixFavicon")) {
      BN.legacyPatches.favicon.apply();
    }

    if (featureEnabled(settings, "oldAssignmentCenter")) {
      BN.legacyPatches.assignmentCenter.enableOldAssignmentCenter();
    }

    if (featureEnabled(settings, "fixInvalidPages")) {
      BN.legacyPatches.assignmentCenter.reloadBrokenAssignmentCenter();
    }
  }

  function runObservedPatches(settings) {
    const { featureEnabled } = BN.shared.settings;

    if (featureEnabled(settings, "downloadFullAvatar")) {
      BN.legacyPatches.avatarDownload.injectDownloadButtons();
    }

    if (featureEnabled(settings, "rosterTools")) {
      BN.legacyPatches.rosterTools.injectRosterCopyButtons();
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

  BN.define("legacyPatches.index", {
    run,
  });
})();
