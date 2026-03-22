// This is a duplicate of the same function in login.js, so please update this one if ur gonna change login.js too
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

function applyWideUI() {
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

function applyFaviconFix() {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = chrome.runtime.getURL("assets/blackbaud.png");
  document.head.appendChild(link);
}

async function enableOldAssignmentCenter() {
  if (window.location.href.includes("lms-assignment/assignment-center")) {
    const hostname = window.location.hostname;
    window.location.href = `https://${hostname}/app/student?svcid=edu#studentmyday/assignment-center`;
  }

  const assignmentCenterBtn = await waitForElement("#assignment-center-btn");
  if (assignmentCenterBtn) {
    const hostname = window.location.hostname;
    assignmentCenterBtn.removeAttribute("href");
    assignmentCenterBtn.addEventListener("click", function () {
      window.location.href = `https://${hostname}/app/student?svcid=edu#studentmyday/assignment-center`;
    });
  }
}

async function reloadBrokenAssignmentCenter() {
  if (!window.location.href.includes("lms-assignment/assignment-center")) {
    return;
  }

  const loadingScreenSymptom = await waitForElement(
    ".sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking",
  );

  if (loadingScreenSymptom) {
    setTimeout(() => {
      const stillThere = document.querySelector(
        ".sky-wait-mask.sky-wait-mask-loading-fixed.sky-wait-mask-loading-blocking",
      );
      if (stillThere) {
        window.location.reload();
      }
    }, 4000);
  }
}

// Put the entire code into an IIFE so await is available LOL
(async () => {
  const { fixFavicon, oldAssignmentCenter, wideUI, fixBrokenAssignmentCenter } =
    await chrome.storage.sync.get({
      fixFavicon: true,
      oldAssignmentCenter: false,
      wideUI: false,
      fixBrokenAssignmentCenter: true,
    });

  if (wideUI) {
    applyWideUI();
  }

  if (fixFavicon) {
    applyFaviconFix();
  }

  if (oldAssignmentCenter) {
    enableOldAssignmentCenter();
  }

  if (fixBrokenAssignmentCenter) {
    reloadBrokenAssignmentCenter();
  }
})();
