(() => {
  if (!window.location.href.includes("myschoolapp.com")) {
    return;
  }

  const copyRosterButtonId = "blackbaud-next-copy-roster-btn";

  function isRosterPage() {
    return !!document.getElementById("roster-term-picker");
  }

  function getSectionIdFromUrl() {
    const apiPattern = /\/api\/datadirect\/sectionrosterget\/(\d+)\//i;

    // Most reliable: reuse the section id from an already-loaded roster API call.
    const entries = performance.getEntriesByType("resource");
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i]?.name || "";
      const apiMatch = name.match(apiPattern);
      if (apiMatch) {
        return apiMatch[1];
      }
    }

    // Route-agnostic fallback: first numeric hash segment (e.g. #advisorypage/28071815/advisees).
    const hashParts = (window.location.hash || "")
      .replace(/^#/, "")
      .split("/")
      .filter(Boolean);
    const numericHashPart = hashParts.find((part) => /^\d+$/.test(part));
    if (numericHashPart) {
      return numericHashPart;
    }

    // Last fallback: inspect roster picker data attributes for a numeric id.
    const termPicker = document.getElementById("roster-term-picker");
    if (termPicker?.dataset) {
      const datasetValue = Object.values(termPicker.dataset).find((value) =>
        /^\d+$/.test(value),
      );
      if (datasetValue) {
        return datasetValue;
      }
    }

    return null;
  }

  async function copyRosterToClipboard(button) {
    const originalText = "Copy Whole Roster";
    const sectionId = getSectionIdFromUrl();
    if (!sectionId) {
      button.textContent = "Roster Not Found";
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
      return;
    }

    try {
      const response = await fetch(
        `/api/datadirect/sectionrosterget/${sectionId}/?format=json`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Failed roster request");
      }

      const roster = await response.json();
      const names = Array.isArray(roster)
        ? roster.map((entry) => entry?.name).filter(Boolean)
        : [];

      if (!names.length) {
        throw new Error("No names");
      }

      await navigator.clipboard.writeText(names.join(", "));
      button.textContent = "Copied to Clipboard";
    } catch {
      button.textContent = "Copy Failed";
    }

    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
  }

  function injectRosterCopyButton() {
    if (!isRosterPage()) {
      return;
    }

    if (document.getElementById(copyRosterButtonId)) {
      return;
    }

    const termPicker = document.getElementById("roster-term-picker");
    if (!termPicker || !termPicker.parentElement) {
      return;
    }

    const button = document.createElement("button");
    button.id = copyRosterButtonId;
    button.type = "button";
    button.className = "btn btn-default";
    button.textContent = "Copy Whole Roster";
    button.style.marginLeft = "8px";

    button.addEventListener("click", () => {
      copyRosterToClipboard(button);
    });

    termPicker.insertAdjacentElement("afterend", button);
  }

  function isDirectoryPage() {
    return /^#directory\/\d+/i.test(window.location.hash || "");
  }

  function getBestAvatarUrl(scope) {
    const selector = "img[src*='/user/large_user_']";
    const local = scope ? [...scope.querySelectorAll(selector)] : [];
    const global = local.length
      ? local
      : [...document.querySelectorAll(selector)];

    if (!global.length) {
      return null;
    }

    const best = global.sort((a, b) => {
      const aa = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return bb.width * bb.height - aa.width * aa.height;
    })[0];

    try {
      const full = new URL(best.src, window.location.href);
      full.searchParams.delete("resize");
      return full.toString();
    } catch {
      return best.src.replace(/\?resize=[^&]+/, "");
    }
  }

  function injectButton() {
    if (!isDirectoryPage()) {
      return;
    }

    const optionButtons = document.querySelectorAll(".user-options-button");
    optionButtons.forEach((optionsButton) => {
      if (optionsButton.dataset.blackbaudNextDownloadBound === "1") {
        return;
      }

      optionsButton.dataset.blackbaudNextDownloadBound = "1";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-default";
      button.textContent = "Download Full Avatar";
      button.style.marginTop = "8px";
      button.style.marginLeft = "0";
      button.style.display = "block";

      button.addEventListener("click", () => {
        const scope =
          optionsButton.closest("section, article, div") ||
          document.body ||
          document.documentElement;
        const fullUrl = getBestAvatarUrl(scope);
        if (!fullUrl) {
          return;
        }

        window.open(fullUrl, "_blank");
      });

      const anchor =
        optionsButton.closest(".btn-group, .dropdown, .user-options") ||
        optionsButton.parentElement ||
        optionsButton;

      anchor.insertAdjacentElement("afterend", button);
    });
  }

  const observer = new MutationObserver(() => {
    injectButton();
    injectRosterCopyButton();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  injectButton();
  injectRosterCopyButton();
})();
