(function () {
  const BN = globalThis.BlackbaudNext;

  const copyRosterButtonId = "blackbaud-next-copy-roster-btn";
  const copyRosterEmailsButtonId = "blackbaud-next-copy-roster-emails-btn";

  function getIdFromRecentRosterRequest(pattern) {
    const match = BN.sources.network.performance.findRecentResourceMatch(pattern);
    return match?.[1] || null;
  }

  function getSectionIdFromUrl() {
    return (
      getIdFromRecentRosterRequest(/\/api\/datadirect\/sectionrosterget\/(\d+)\//i) ||
      BN.shared.routes.getNumericHashSegment()
    );
  }

  function getAthleticTeamIdFromUrl() {
    return (
      getIdFromRecentRosterRequest(
        /\/api\/datadirect\/athleticrosterget\/\?[^#]*teamId=(\d+)/i,
      ) || BN.shared.routes.getNumericHashSegment()
    );
  }

  async function fetchRoster() {
    const isAthleticTeamPage = /#athleticteam/i.test(window.location.hash || "");
    if (isAthleticTeamPage) {
      const teamId = getAthleticTeamIdFromUrl();
      if (!teamId) {
        return null;
      }

      return BN.sources.api.client.getAthleticRoster(teamId);
    }

    const sectionId = getSectionIdFromUrl();
    if (!sectionId) {
      return null;
    }

    return BN.sources.api.client.getSectionRoster(sectionId);
  }

  async function copyRosterDataToClipboard(button, type) {
    const originalText =
      type === "email" ? "Copy Roster Emails" : "Copy Full Roster";

    try {
      const roster = await fetchRoster();
      if (!roster) {
        button.textContent = "Roster Not Found";
        return;
      }

      const values = BN.data.normalize.roster.rosterValues(roster, type);
      if (!values.length) {
        throw new Error(type === "email" ? "No emails" : "No names");
      }

      await BN.shared.clipboard.writeText(values.join(", "));
      button.textContent = "Copied to Clipboard";
    } catch {
      button.textContent = "Copy Failed";
    } finally {
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    }
  }

  function injectRosterCopyButtons() {
    if (!BN.shared.routes.isRosterPage()) {
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

    const namesButton = BN.shared.dom.createButton({
      id: copyRosterButtonId,
      text: "Copy Full Roster",
    });
    namesButton.style.marginLeft = "8px";
    namesButton.addEventListener("click", () => {
      copyRosterDataToClipboard(namesButton, "name");
    });

    const emailsButton = BN.shared.dom.createButton({
      id: copyRosterEmailsButtonId,
      text: "Copy Roster Emails",
    });
    emailsButton.style.marginLeft = "8px";
    emailsButton.addEventListener("click", () => {
      copyRosterDataToClipboard(emailsButton, "email");
    });

    termPicker.insertAdjacentElement("afterend", namesButton);
    namesButton.insertAdjacentElement("afterend", emailsButton);
  }

  BN.define("legacyPatches.rosterTools", {
    injectRosterCopyButtons,
  });
})();
