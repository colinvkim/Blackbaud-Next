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

// Put the entire code into an IIFE so await is available LOL
(async () => {
  const loadBetweenPages = await chrome.storage.sync.get({
    loadBetweenPages: true,
  });
  const fixFavicon = await chrome.storage.sync.get({ fixFavicon: true });
  const oldAssignmentCenter = await chrome.storage.sync.get({
    oldAssignmentCenter: false,
  });
  const wideUI = await chrome.storage.sync.get({ wideUI: false });

  if (window.location.href.includes("myschoolapp.com") && wideUI.wideUI) {
    const style = document.createElement("style");
    style.textContent = `
    .container {
    width: 100%;
}

.nav, ul.topnav, ul.clearfix:has(li) {
    width: 100% !important;
    display: flex !important;
    justify-content: center !important;
}`;
    document.head.appendChild(style);
  }

  if (
    window.location.href.includes("myschoolapp.com") &&
    loadBetweenPages.loadBetweenPages &&
    window.location.href !=
      encodeURI(`https://${window.location.hostname}/app?svcid=edu`) &&
    window.location.href !=
      encodeURI(`https://${window.location.hostname}/app?svcid=edu#login`)
  ) {
    const style = document.createElement("style");

    const loadingOverlay = document.createElement("div");
    const loadingSpinner = document.createElement("div");
    const loadingText = document.createElement("h2");
    loadingOverlay.className = "loading-overlay";
    loadingSpinner.className = "loading-spinner";
    loadingText.className = "loading-text";
    loadingText.textContent = "Loading...";

    loadingOverlay.appendChild(loadingSpinner);
    loadingOverlay.appendChild(loadingText);

    style.textContent = `
.loading-overlay {
  position: fixed;
  inset: 0; /* full screen */
  opacity: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(8px); /* blur background */
  z-index: 999999; /* above everything */
  pointer-events: none;
  transition: opacity 0.5s ease;
}

.loading-overlay.active-overlay {
    opacity: 1;
    pointer-events: auto;
}

.loading-spinner {
  width: 64px;
  height: 64px;
  border: 4px solid rgba(255, 200, 0, 0.3);
  border-top: 4px solid #facc15; /* yellow */
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.loading-text {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
`;

    document.head.appendChild(style);
    document.body.appendChild(loadingOverlay);

    function blackbaudSucks() {
      const blackbaudVibeCodedSlop = document.querySelector(
        ".progress.progress-striped.active.skylo",
      );
      const theyAreSoInconsistentBro = document.querySelector(
        '[role="progressbar"]',
      );

      if (blackbaudVibeCodedSlop || theyAreSoInconsistentBro) {
        if (theyAreSoInconsistentBro) {
          theyAreSoInconsistentBro.style.display = "none";
        }
        loadingOverlay.classList.add("active-overlay");
      } else {
        loadingOverlay.classList.remove("active-overlay");
      }
    }

    const observer = new MutationObserver(() => {
      blackbaudSucks();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    blackbaudSucks();
  }

  if (
    window.location.href.includes("myschoolapp.com") &&
    fixFavicon.fixFavicon
  ) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href =
      "https://sky.blackbaudcdn.net/skyuxapps/host-assets/assets/favicon-32x32-v1.523659243878a29f2bb883cf72730997.png";
    document.head.appendChild(link);
  }

  if (oldAssignmentCenter.oldAssignmentCenter) {
    if (window.location.href.includes("lms-assignment/assignment-center")) {
      const hostname = window.location.hostname;
      window.location.href = `https://${hostname}/app/student?svcid=edu#studentmyday/assignment-center`;
    }

    (async () => {
      if (window.location.href.includes("myschoolapp.com")) {
        const assignmentCenterBtn = await waitForElement(
          "#assignment-center-btn",
        );
        if (assignmentCenterBtn) {
          const hostname = window.location.hostname;
          assignmentCenterBtn.removeAttribute("href");
          assignmentCenterBtn.addEventListener("click", function () {
            window.location.href = `https://${hostname}/app/student?svcid=edu#studentmyday/assignment-center`;
          });
        }
      }
    })();
  }
})();
