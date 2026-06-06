(function () {
  const BN = globalThis.BlackbaudNext;

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        accept: "application/json, text/plain, */*",
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Blackbaud API request failed with HTTP ${response.status}`);
    }

    return response.json();
  }

  async function getUserStatus() {
    return fetchJson("/api/webapp/userstatus");
  }

  async function getSectionRoster(sectionId) {
    return fetchJson(`/api/datadirect/sectionrosterget/${sectionId}/?format=json`);
  }

  async function getAthleticRoster(teamId) {
    return fetchJson(`/api/datadirect/athleticrosterget/?format=json&teamId=${teamId}`);
  }

  BN.define("sources.api.client", {
    fetchJson,
    getAthleticRoster,
    getSectionRoster,
    getUserStatus,
  });
})();
