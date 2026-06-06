(function () {
  const BN = globalThis.BlackbaudNext;

  function currentUrl() {
    return new URL(window.location.href);
  }

  function hostname() {
    return window.location.hostname;
  }

  function isMyschoolApp() {
    return hostname().endsWith(".myschoolapp.com");
  }

  function isBlackbaudHost() {
    return hostname().endsWith(".blackbaud.com");
  }

  function isGoogleHost() {
    return hostname() === "accounts.google.com";
  }

  function isBlackbaudSignin() {
    const url = currentUrl();
    return isBlackbaudHost() && url.pathname.includes("/signin");
  }

  function isBlackbaudSigninError() {
    const url = currentUrl();
    return isBlackbaudSignin() && url.pathname.includes("/signin/error");
  }

  function isGoogleBlackbaudOAuth() {
    return isGoogleHost() && currentUrl().href.includes("blackbaud");
  }

  function isLegacyLoginPage() {
    return isMyschoolApp() && currentUrl().href.toLowerCase().includes("login");
  }

  function isAuthenticatedLmsPage() {
    return isMyschoolApp() && !isLegacyLoginPage();
  }

  function getSchoolHostname() {
    return isMyschoolApp() ? hostname() : "";
  }

  function getStudentDashboardUrl(schoolHostname = getSchoolHostname()) {
    if (!schoolHostname) {
      return "";
    }

    return `https://${schoolHostname}/app/student?svcid=edu`;
  }

  function getBlackbaudSigninUrl(schoolHostname = getSchoolHostname()) {
    const dashboard = getStudentDashboardUrl(schoolHostname);
    if (!dashboard) {
      return "https://app.blackbaud.com/signin/";
    }

    return `https://app.blackbaud.com/signin/?redirectUrl=${encodeURIComponent(dashboard)}`;
  }

  function isNewAssignmentCenterRoute() {
    return currentUrl().href.includes("lms-assignment/assignment-center");
  }

  function getLegacyAssignmentCenterUrl(schoolHostname = getSchoolHostname()) {
    return `${getStudentDashboardUrl(schoolHostname)}#studentmyday/assignment-center`;
  }

  function isRosterPage() {
    return isMyschoolApp() && Boolean(document.getElementById("roster-term-picker"));
  }

  function isDirectoryPage() {
    return isMyschoolApp() && /^#directory\/\d+/i.test(window.location.hash || "");
  }

  function getNumericHashSegment() {
    const hashParts = (window.location.hash || "")
      .replace(/^#/, "")
      .split("/")
      .filter(Boolean);

    return hashParts.find((part) => /^\d+$/.test(part)) || null;
  }

  BN.define("shared.routes", {
    currentUrl,
    getBlackbaudSigninUrl,
    getLegacyAssignmentCenterUrl,
    getNumericHashSegment,
    getSchoolHostname,
    getStudentDashboardUrl,
    hostname,
    isAuthenticatedLmsPage,
    isBlackbaudHost,
    isBlackbaudSignin,
    isBlackbaudSigninError,
    isDirectoryPage,
    isGoogleBlackbaudOAuth,
    isGoogleHost,
    isLegacyLoginPage,
    isMyschoolApp,
    isNewAssignmentCenterRoute,
    isRosterPage,
  });
})();
