(async function () {
  const loginFix = await chrome.storage.sync.get({ loginFix: true });
  const automaticLogin = await chrome.storage.sync.get({
    automaticLogin: true,
  });

  async function waitForElement(selector, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Timed out when waiting for" + selector));
      }, timeout);

      if (document.querySelector(selector)) {
        clearTimeout(timer);
        return resolve(document.querySelector(selector));
      }

      const observer = new MutationObserver((mutations) => {
        if (document.querySelector(selector)) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(document.querySelector(selector));
        }
      });

      observer.observe(document.body, {
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
      initiateAuth.click();
    }
  }

  async function loginPage() {
    const currentUrl = window.location.href;
    if (
      currentUrl.includes("myschoolapp.com") &&
      currentUrl.includes("login")
    ) {
      const blackbaudGarbage = await waitForElement("iframe");
      const loginInput = await waitForElement("div.textfield");
      const rememberCheckbox = await waitForElement("div.remember");
      const nextButton = await waitForElement("#nextBtn");

      const hostname = window.location.hostname;
      const dashboard = encodeURI(`https://${hostname}/app/student?svcid=edu`);

      document
        .querySelectorAll('script[type="text/javascript"]')
        .forEach((script) => script.remove());
      blackbaudGarbage?.remove();
      loginInput?.remove();
      rememberCheckbox?.remove();
      nextButton.value = "Sign in with Google";
      nextButton.style.width = "100%";

      nextButton?.addEventListener("click", function () {
        console.log(`Redirecting to ${dashboard}`);
        window.location.href = `https://app.blackbaud.com/signin/?redirectUrl=${dashboard}`;
      });
    }
  }

  if (loginFix.loginFix) {
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
      // Wait for account options to load
      const accountOptions = await waitForElement("[data-email]");

      const selectors = [
        "[data-email*='polytechnic.org']",
        "[data-email*='chandlerschool.org']",
        "[data-email*='flintridgeprep.org']",
      ];

      let polytechnicAccount = null;

      for (const selector of selectors) {
        polytechnicAccount = document.querySelector(selector);
        if (polytechnicAccount) break;
      }

      if (polytechnicAccount) {
        polytechnicAccount.click();
      } else {
        console.log("The user isn't signed into an eligible account");
      }
    }
  }

  if (automaticLogin.automaticLogin) {
    autoClickLogin();
    handleGoogleOAuth();
  }
})();
