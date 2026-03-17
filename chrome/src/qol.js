(() => {
  if (!window.location.href.includes("myschoolapp.com")) {
    return;
  }

  const copyRosterButtonId = "blackbaud-next-copy-roster-btn";

  function isRosterPage() {
    return !!document.getElementById("roster-term-picker");
  }

  function getIdFromRecentRosterRequest(pattern) {
    const entries = performance.getEntriesByType("resource");
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i]?.name || "";
      const apiMatch = name.match(pattern);
      if (apiMatch) {
        return apiMatch[1];
      }
    }

    return null;
  }

  function getNumericHashSegment() {
    const hashParts = (window.location.hash || "")
      .replace(/^#/, "")
      .split("/")
      .filter(Boolean);

    return hashParts.find((part) => /^\d+$/.test(part)) || null;
  }

  function getSectionIdFromUrl() {
    const fromSectionApi = getIdFromRecentRosterRequest(
      /\/api\/datadirect\/sectionrosterget\/(\d+)\//i,
    );
    if (fromSectionApi) {
      return fromSectionApi;
    }

    const numericHashPart = getNumericHashSegment();
    if (numericHashPart) {
      return numericHashPart;
    }

    return null;
  }

  function getAthleticTeamIdFromUrl() {
    const fromAthleticApi = getIdFromRecentRosterRequest(
      /\/api\/datadirect\/athleticrosterget\/\?[^#]*teamId=(\d+)/i,
    );
    if (fromAthleticApi) {
      return fromAthleticApi;
    }

    const numericHashPart = getNumericHashSegment();
    if (numericHashPart) {
      return numericHashPart;
    }

    return null;
  }

  function getRosterApiUrl() {
    const isAthleticTeamPage = /#athleticteam/i.test(
      window.location.hash || "",
    );
    if (isAthleticTeamPage) {
      const teamId = getAthleticTeamIdFromUrl();
      return teamId
        ? `/api/datadirect/athleticrosterget/?format=json&teamId=${teamId}`
        : null;
    }

    const sectionId = getSectionIdFromUrl();
    return sectionId
      ? `/api/datadirect/sectionrosterget/${sectionId}/?format=json`
      : null;
  }

  async function copyRosterToClipboard(button) {
    const originalText = "Copy Whole Roster";
    const rosterApiUrl = getRosterApiUrl();
    if (!rosterApiUrl) {
      button.textContent = "Roster Not Found";
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
      return;
    }

    try {
      const response = await fetch(rosterApiUrl, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed roster request");
      }

      const roster = await response.json();
      const names = Array.isArray(roster)
        ? roster
            .map(
              (entry) =>
                entry?.name ||
                entry?.formatted_name ||
                [entry?.firstName, entry?.lastName].filter(Boolean).join(" "),
            )
            .filter(Boolean)
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
