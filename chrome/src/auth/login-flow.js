(function () {
  const BN = globalThis.BlackbaudNext;

  const hostnameKey = "blackbaud-next-bb-lms-last-hostname";
  const supportedGoogleAccountSelectors = [
    "[data-email*='polytechnic.org']",
    "[data-email*='chandlerschool.org']",
    "[data-email*='flintridgeprep.org']",
  ];

  function findSupportedGoogleAccount() {
    for (const selector of supportedGoogleAccountSelectors) {
      const account = document.querySelector(selector);
      if (account) {
        return account;
      }
    }

    return null;
  }

  async function handleSigninError() {
    const routes = BN.shared.routes;
    const stored = await browser.storage.sync.get(hostnameKey);
    const storedHostname = stored[hostnameKey];
    const isValidHostname =
      typeof storedHostname === "string" &&
      storedHostname.length > 0 &&
      storedHostname.endsWith(".myschoolapp.com");

    window.location.href = isValidHostname
      ? routes.getBlackbaudSigninUrl(storedHostname)
      : "https://app.blackbaud.com/signin/";
  }

  async function clickBlackbaudGoogleSignin(settings) {
    const { waitForElement } = BN.shared.dom;
    const overlay = BN.auth.loadingOverlay;

    overlay.setOverlayPersistence(true);
    overlay.show(settings);

    const initiateAuth = await waitForElement(
      "app-spa-auth-google-signin-button button, #google-continue-button",
    );

    initiateAuth?.click();
  }

  async function autoClickLogin(settings) {
    const routes = BN.shared.routes;

    if (routes.isBlackbaudSigninError()) {
      await handleSigninError();
      return;
    }

    if (routes.isBlackbaudSignin()) {
      await clickBlackbaudGoogleSignin(settings);
    }
  }

  async function optimizeLegacyLoginPage() {
    const routes = BN.shared.routes;
    const { waitForElement } = BN.shared.dom;

    if (document.documentElement.dataset.blackbaudNextLoginPatched === "1") {
      return;
    }

    if (!routes.isLegacyLoginPage()) {
      return;
    }

    const nextButton =
      document.querySelector("#nextBtn") || (await waitForElement("#nextBtn", 1200));

    if (!nextButton) {
      return;
    }

    const schoolHostname = routes.getSchoolHostname();
    const dashboard = routes.getStudentDashboardUrl(schoolHostname);
    await browser.storage.sync.set({ [hostnameKey]: schoolHostname });

    document.documentElement.dataset.blackbaudNextLoginPatched = "1";
    document
      .querySelectorAll('script[type="text/javascript"]')
      .forEach((script) => script.remove());
    document.querySelector("div.textfield")?.remove();
    document.querySelector("div.remember")?.remove();
    document.querySelector("iframe")?.remove();

    nextButton.value = "Sign in with Google";
    nextButton.style.width = "100%";

    if (nextButton.dataset.blackbaudNextBound === "1") {
      return;
    }

    nextButton.dataset.blackbaudNextBound = "1";
    nextButton.addEventListener("click", () => {
      window.location.href = `https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent(dashboard)}`;
    });
  }

  async function handleGoogleOAuth(settings) {
    const routes = BN.shared.routes;
    const { waitForElement } = BN.shared.dom;
    const overlay = BN.auth.loadingOverlay;

    if (!routes.isGoogleBlackbaudOAuth()) {
      return;
    }

    const supportedAccount = findSupportedGoogleAccount();
    if (supportedAccount) {
      overlay.setOverlayPersistence(true);
      overlay.show(settings);
      supportedAccount.click();
      return;
    }

    const accountOptions = await waitForElement("[data-email]", 1200);
    if (!accountOptions) {
      return;
    }

    const supportedAccountAfterLoad = findSupportedGoogleAccount();
    if (supportedAccountAfterLoad) {
      overlay.setOverlayPersistence(true);
      overlay.show(settings);
      supportedAccountAfterLoad.click();
      return;
    }

    overlay.setOverlayPersistence(false);
    overlay.hide();
  }

  async function run(settings) {
    const { featureEnabled } = BN.shared.settings;

    BN.auth.loadingOverlay.restoreIfNeeded(settings);

    if (featureEnabled(settings, "optimizeLoginPage")) {
      await optimizeLegacyLoginPage();
      window.addEventListener("hashchange", optimizeLegacyLoginPage);
    }

    if (featureEnabled(settings, "automaticLogin")) {
      await autoClickLogin(settings);
      await handleGoogleOAuth(settings);
    }
  }

  BN.define("auth.loginFlow", {
    run,
  });
})();
