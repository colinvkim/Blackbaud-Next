(async () => {
  if (!window.location.href.includes("myschoolapp.com")) {
    return;
  }

  const { copyRosterTools, downloadFullAvatar } = await chrome.storage.sync.get(
    {
      copyRosterTools: true,
      downloadFullAvatar: true,
    },
  );

  if (!copyRosterTools && !downloadFullAvatar) {
    return;
  }

  const copyRosterButtonId = "blackbaud-next-copy-roster-btn";
  const copyRosterEmailsButtonId = "blackbaud-next-copy-roster-emails-btn";

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

  async function copyRosterDataToClipboard(button, type) {
    const originalText =
      type === "email" ? "Copy Roster Emails" : "Copy Full Roster";
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
      const values = Array.isArray(roster)
        ? roster
            .map((entry) =>
              type === "email"
                ? entry?.email
                : entry?.name ||
                  entry?.formatted_name ||
                  [entry?.firstName, entry?.lastName].filter(Boolean).join(" "),
            )
            .filter(Boolean)
        : [];

      if (!values.length) {
        throw new Error(type === "email" ? "No emails" : "No names");
      }

      await navigator.clipboard.writeText(values.join(", "));
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

    if (
      document.getElementById(copyRosterButtonId) ||
      document.getElementById(copyRosterEmailsButtonId)
    ) {
      return;
    }

    const termPicker = document.getElementById("roster-term-picker");
    if (!termPicker || !termPicker.parentElement) {
      return;
    }

    const namesButton = document.createElement("button");
    namesButton.id = copyRosterButtonId;
    namesButton.type = "button";
    namesButton.className = "btn btn-default";
    namesButton.textContent = "Copy Full Roster";
    namesButton.style.marginLeft = "8px";

    namesButton.addEventListener("click", () => {
      copyRosterDataToClipboard(namesButton, "name");
    });

    const emailsButton = document.createElement("button");
    emailsButton.id = copyRosterEmailsButtonId;
    emailsButton.type = "button";
    emailsButton.className = "btn btn-default";
    emailsButton.textContent = "Copy Roster Emails";
    emailsButton.style.marginLeft = "8px";

    emailsButton.addEventListener("click", () => {
      copyRosterDataToClipboard(emailsButton, "email");
    });

    termPicker.insertAdjacentElement("afterend", namesButton);
    namesButton.insertAdjacentElement("afterend", emailsButton);
  }

  function isDirectoryPage() {
    return /^#directory\/\d+/i.test(window.location.hash || "");
  }

  function getAvatarCandidates(scope = document) {
    const selector = "img[src*='/user/large_user_']";
    return [...scope.querySelectorAll(selector)].filter((image) => !!image.src);
  }

  function getFullAvatarUrl(image) {
    if (!image?.src) {
      return null;
    }

    try {
      const full = new URL(image.src, window.location.href);
      full.searchParams.delete("resize");
      return full.toString();
    } catch {
      return image.src.replace(/\?resize=[^&]+/, "");
    }
  }

  function getRectDistanceScore(source, target) {
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + source.height / 2;
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    return Math.hypot(targetX - sourceX, targetY - sourceY);
  }

  function getBestAvatarUrl(optionsButton) {
    let current = optionsButton;
    while (current && current !== document.body && current !== document.documentElement) {
      const local = getAvatarCandidates(current);
      if (local.length === 1) {
        return getFullAvatarUrl(local[0]);
      }

      current = current.parentElement;
    }

    const global = getAvatarCandidates();
    if (!global.length) {
      return null;
    }

    const buttonRect = optionsButton.getBoundingClientRect();
    const nearest = global.sort((a, b) => {
      const distanceA = getRectDistanceScore(buttonRect, a.getBoundingClientRect());
      const distanceB = getRectDistanceScore(buttonRect, b.getBoundingClientRect());
      return distanceA - distanceB;
    })[0];

    return getFullAvatarUrl(nearest);
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
        const fullUrl = getBestAvatarUrl(optionsButton);
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
    if (downloadFullAvatar) {
      injectButton();
    }

    if (copyRosterTools) {
      injectRosterCopyButton();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  if (downloadFullAvatar) {
    injectButton();
  }

  if (copyRosterTools) {
    injectRosterCopyButton();
  }
})();
