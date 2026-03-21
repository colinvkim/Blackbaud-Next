(async () => {
  const overlayPersistKey = "blackbaud-next-auto-login-overlay-persist";
  const hostnameKey = "blackbaud-next-bb-lms-last-hostname";

  // Store prefs
  const { loginFix, automaticLogin, loadBetweenPages } =
    await chrome.storage.sync.get({
      loginFix: true,
      automaticLogin: true,
      loadBetweenPages: true,
    });

  function setOverlayPersistence(shouldPersist) {
    if (shouldPersist) {
      sessionStorage.setItem(overlayPersistKey, "1");
    } else {
      sessionStorage.removeItem(overlayPersistKey);
    }
  }

  function hideAutoLoginOverlay() {
    document.getElementById("blackbaud-next-auto-login-overlay")?.remove();
    document.getElementById("blackbaud-next-auto-login-style")?.remove();
  }

  function showAutoLoginOverlay() {
    if (!automaticLogin || !loadBetweenPages) {
      return;
    }

    if (document.getElementById("blackbaud-next-auto-login-overlay")) {
      return;
    }
    // Create loading overlay and styles
    const style = document.createElement("style");
    const loadingOverlay = document.createElement("div");
    const loadingSpinner = document.createElement("div");
    const loadingText = document.createElement("h2");

    style.id = "blackbaud-next-auto-login-style";
    loadingOverlay.id = "blackbaud-next-auto-login-overlay";
    loadingOverlay.className = "loading-overlay active-overlay";
    loadingSpinner.className = "loading-spinner";
    loadingText.className = "loading-text";
    loadingText.textContent = "Signing you in...";

    loadingOverlay.appendChild(loadingSpinner);
    loadingOverlay.appendChild(loadingText);

    style.textContent = `
.loading-overlay {
  position: fixed;
  inset: 0;
  background: #fff;
  opacity: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(8px);
  z-index: 999999;
  pointer-events: none;
  transition: opacity 0.35s ease;
}

.loading-overlay.active-overlay {
  opacity: 1;
  pointer-events: auto;
}

.loading-spinner {
  width: 64px;
  height: 64px;
  border: 4px solid rgba(255, 200, 0, 0.3);
  border-top: 4px solid #facc15;
  border-radius: 50%;
  animation: blackbaud-next-spin 1s linear infinite;
  margin-bottom: 16px;
}

.loading-text {
  font-size: 1.25rem !important;
  font-weight: 600 !important;
  font-family: "Inter", Arial, sans-serif !important;
  color: #112b55 !important;
}

@keyframes blackbaud-next-spin {
  to {
    transform: rotate(360deg);
  }
}
`;

    if (document.head) {
      document.head.appendChild(style);
    }

    (document.body || document.documentElement).appendChild(loadingOverlay);
  }

  // Loading overlay function for detecting whether it is a good site for the overlay
  function shouldPersistOverlayOnCurrentPage() {
    return (
      window.location.href.includes("app.blackbaud.com/signin") ||
      (window.location.href.includes("accounts.google.com") &&
        window.location.href.includes("blackbaud"))
    );
  }

  if (automaticLogin && loadBetweenPages) {
    const persistedOverlay =
      sessionStorage.getItem(overlayPersistKey) === "1" &&
      shouldPersistOverlayOnCurrentPage();
    if (persistedOverlay) {
      showAutoLoginOverlay();
    }
  }

  // Same function as in qol.js, so please update accordingly
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

  // Click Sign in with Google button automatically and redirect to correct page if at signin/error
  async function autoClickLogin() {
    if (window.location.href.includes("app.blackbaud.com/signin/error")) {
      const stored = await chrome.storage.sync.get(hostnameKey);
      const hostname = stored[hostnameKey];
      const isValidHostname =
        typeof hostname === "string" &&
        hostname.length > 0 &&
        hostname.endsWith(".myschoolapp.com");

      if (!isValidHostname) {
        window.location.href = "https://app.blackbaud.com/signin/";
        return;
      }

      const dashboard = encodeURIComponent(
        `https://${hostname}/app/student?svcid=edu`,
      );
      window.location.href = `https://app.blackbaud.com/signin/?redirectUrl=${dashboard}`;
      return;
    }

    if (window.location.href.includes("app.blackbaud.com/signin")) {
      setOverlayPersistence(true);
      showAutoLoginOverlay();
      const initiateAuth = await waitForElement(
        "app-spa-auth-google-signin-button button, #google-continue-button",
      );
      if (initiateAuth) {
        initiateAuth.click();
      }
    }
  }

  // Make the initial login page look better
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
    chrome.storage.sync.set({ [hostnameKey]: hostname });

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

      const findSupportedAccount = () => {
        for (const selector of selectors) {
          const account = document.querySelector(selector);
          if (account) {
            return account;
          }
        }

        return null;
      };

      const supportedAccount = findSupportedAccount();
      if (supportedAccount) {
        setOverlayPersistence(true);
        showAutoLoginOverlay();
        supportedAccount.click();
        return;
      }

      const accountOptions = await waitForElement("[data-email]", 1200);
      if (!accountOptions) {
        return;
      }

      const supportedAccountAfterLoad = findSupportedAccount();
      if (supportedAccountAfterLoad) {
        setOverlayPersistence(true);
        showAutoLoginOverlay();
        supportedAccountAfterLoad.click();
        return;
      }

      setOverlayPersistence(false);
      hideAutoLoginOverlay();

      console.log("The user isn't signed into an eligible account");
    }
  }

  if (automaticLogin) {
    autoClickLogin();
    handleGoogleOAuth();
  }
})();
