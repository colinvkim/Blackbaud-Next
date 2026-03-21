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

// Put the entire code into an IIFE so await is available LOL
(async () => {
  const { fixFavicon, oldAssignmentCenter, wideUI } =
    await chrome.storage.sync.get({
      fixFavicon: true,
      oldAssignmentCenter: false,
      wideUI: false,
    });

  // Create wide user interface (alpha)
  if (window.location.href.includes("myschoolapp.com") && wideUI) {
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

  // Fix BB having a blank favicon for some routes
  if (window.location.href.includes("myschoolapp.com") && fixFavicon) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href = chrome.runtime.getURL("assets/blackbaud.png");
    document.head.appendChild(link);
  }

  // Redirect new assignment center to old one and try to make old button go to new one
  if (oldAssignmentCenter) {
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
