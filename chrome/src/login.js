(async function () {
  const [{ loginFix }, { automaticLogin }] = await Promise.all([
    chrome.storage.sync.get({ loginFix: true }),
    chrome.storage.sync.get({ automaticLogin: true }),
  ]);

  async function waitForElement(selector, timeout = 4000) {
    return new Promise((resolve) => {
      const existingElement = document.querySelector(selector);
      if (existingElement) {
        return resolve(existingElement);
      }

      let observer;
      const timer = setTimeout(() => {
        if (observer) {
          observer.disconnect();
        }
        resolve(null);
      }, timeout);

      observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  async function autoClickLogin() {
    if (window.location.href.includes("app.blackbaud.com/signin")) {
      const initiateAuth = await waitForElement(
        "app-spa-auth-google-signin-button button",
      );
      if (initiateAuth) {
        initiateAuth.click();
      }
    }
  }

  async function loginPage() {
    if (document.documentElement.dataset.blackbaudNextLoginPatched === "1") {
      return;
    }

    const currentUrl = window.location.href;
    if (
      !currentUrl.includes("myschoolapp.com") ||
      !currentUrl.toLowerCase().includes("login")
    ) {
      return;
    }

    const nextButton =
      document.querySelector("#nextBtn") ||
      (await waitForElement("#nextBtn", 1200));

    if (!nextButton) {
      return;
    }

    const hostname = window.location.hostname;
    const dashboard = encodeURI(`https://${hostname}/app/student?svcid=edu`);

    document.documentElement.dataset.blackbaudNextLoginPatched = "1";

    document
      .querySelectorAll('script[type="text/javascript"]')
      .forEach((script) => script.remove());
    document.querySelector("div.textfield")?.remove();
    document.querySelector("div.remember")?.remove();
    document.querySelector("iframe")?.remove();
    nextButton.value = "Sign in with Google";
    nextButton.style.width = "100%";

    if (nextButton.dataset.blackbaudNextBound !== "1") {
      nextButton.dataset.blackbaudNextBound = "1";
      nextButton.addEventListener("click", function () {
        console.log(`Redirecting to ${dashboard}`);
        window.location.href = `https://app.blackbaud.com/signin/?redirectUrl=${dashboard}`;
      });
    }
  }

  if (loginFix) {
    loginPage();
    // Handle hash changes (common)
    window.addEventListener("hashchange", loginPage);
  }

  // Google OAuth account selection
  async function handleGoogleOAuth() {
    if (
      window.location.href.includes("accounts.google.com") &&
      window.location.href.includes("blackbaud")
    ) {
      const selectors = [
        "[data-email*='polytechnic.org']",
        "[data-email*='chandlerschool.org']",
        "[data-email*='flintridgeprep.org']",
      ];

      for (const selector of selectors) {
        const account = document.querySelector(selector);
        if (account) {
          account.click();
          return;
        }
      }

      const accountOptions = await waitForElement("[data-email]", 1200);
      if (!accountOptions) {
        return;
      }

      for (const selector of selectors) {
        const account = document.querySelector(selector);
        if (account) {
          account.click();
          return;
        }
      }

      console.log("The user isn't signed into an eligible account");
    }
  }

  if (automaticLogin) {
    autoClickLogin();
    handleGoogleOAuth();
  }
})();
