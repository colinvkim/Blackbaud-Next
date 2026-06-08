(function () {
  const BN = globalThis.BlackbaudNext;

  async function enableOldAssignmentCenter() {
    const routes = BN.shared.routes;

    if (!routes.isMyschoolApp()) {
      return;
    }

    if (routes.isNewAssignmentCenterRoute()) {
      window.location.href = routes.getLegacyAssignmentCenterUrl();
      return;
    }

    const assignmentCenterButton =
      document.querySelector("#assignment-center-btn") ||
      (await BN.shared.dom.waitForElement("#assignment-center-btn", 1400));

    if (!assignmentCenterButton) {
      return;
    }

    assignmentCenterButton.removeAttribute("href");

    if (assignmentCenterButton.dataset.blackbaudNextOldAssignmentCenter === "1") {
      return;
    }

    assignmentCenterButton.dataset.blackbaudNextOldAssignmentCenter = "1";
    assignmentCenterButton.addEventListener("click", () => {
      window.location.href = routes.getLegacyAssignmentCenterUrl();
    });
  }

  async function reloadBrokenAssignmentCenter() {
    const routes = BN.shared.routes;

    if (!routes.isNewAssignmentCenterRoute()) {
      return;
    }

    const loadingScreenSymptom = await BN.shared.dom.waitForElement(
      ".sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking",
    );

    if (!loadingScreenSymptom) {
      return;
    }

    setTimeout(() => {
      const stillThere = document.querySelector(
        ".sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking",
      );

      if (stillThere) {
        window.location.reload();
      }
    }, 4000);
  }

  BN.define("nativeEnhancements.assignmentCenter", {
    enableOldAssignmentCenter,
    reloadBrokenAssignmentCenter,
  });
})();
