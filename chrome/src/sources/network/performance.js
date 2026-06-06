(function () {
  const BN = globalThis.BlackbaudNext;

  function findRecentResourceMatch(pattern) {
    const entries = performance.getEntriesByType("resource");

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const name = entries[index]?.name || "";
      const match = name.match(pattern);
      if (match) {
        return match;
      }
    }

    return null;
  }

  BN.define("sources.network.performance", {
    findRecentResourceMatch,
  });
})();
