(function () {
  const BN = globalThis.BlackbaudNext;

  function displayNameForRosterEntry(entry) {
    return (
      entry?.name ||
      entry?.formatted_name ||
      [entry?.firstName, entry?.lastName].filter(Boolean).join(" ")
    );
  }

  function normalizeRosterEntry(entry) {
    return {
      email: entry?.email || "",
      name: displayNameForRosterEntry(entry) || "",
      raw: entry,
    };
  }

  function normalizeRoster(rawRoster) {
    if (!Array.isArray(rawRoster)) {
      return [];
    }

    return rawRoster.map(normalizeRosterEntry);
  }

  function rosterValues(rawRoster, type) {
    return normalizeRoster(rawRoster)
      .map((entry) => (type === "email" ? entry.email : entry.name))
      .filter(Boolean);
  }

  BN.define("data.normalize.roster", {
    displayNameForRosterEntry,
    normalizeRoster,
    normalizeRosterEntry,
    rosterValues,
  });
})();
