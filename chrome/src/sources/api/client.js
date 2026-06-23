(function () {
  const BN = globalThis.BlackbaudNext;

  let apiRootPath = null;

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
      let errorMessage = `Blackbaud API request failed with HTTP ${response.status}`;

      try {
        const errorBody = await response.clone().json();
        errorMessage =
          errorBody?.Error ||
          errorBody?.Message ||
          errorBody?.raw_message ||
          errorMessage;
      } catch {
        try {
          const errorBody = await response.text();
          errorMessage = errorBody || errorMessage;
        } catch {
          // Keep status-only message.
        }
      }

      throw new Error(errorMessage);
    }

    return response.json();
  }

  function readApiRootPathFromScripts() {
    const scripts = document.querySelectorAll("script");
    const apiRootPattern = /["']ApiRootPath["']\s*:\s*["']([^"']+)["']/i;

    for (const script of scripts) {
      const match = (script.textContent || "").match(apiRootPattern);
      if (match?.[1]) {
        return match[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
      }
    }

    return "";
  }

  function getApiRootPath() {
    if (apiRootPath) {
      return apiRootPath;
    }

    apiRootPath = readApiRootPathFromScripts() || "/api/";
    return apiRootPath;
  }

  function buildApiUrl(endpoint, params = {}) {
    const rootUrl = new URL(getApiRootPath(), window.location.origin);
    const [endpointPath, endpointQuery = ""] = endpoint
      .replace(/^\/?api\/?/i, "")
      .split("?");
    const rootPath = rootUrl.pathname.endsWith("/")
      ? rootUrl.pathname
      : `${rootUrl.pathname}/`;
    const url = new URL(`${rootPath}${endpointPath.replace(/^\/+/, "")}`, window.location.origin);

    rootUrl.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    new URLSearchParams(endpointQuery).forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    return `${url.pathname}${url.search}`;
  }

  function fetchApiJson(endpoint, options = {}) {
    const { params = {}, ...fetchOptions } = options;
    return fetchJson(buildApiUrl(endpoint, params), fetchOptions);
  }

  function buildQueryUrl(path, params = {}) {
    const url = new URL(path, window.location.origin);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    return `${url.pathname}${url.search}`;
  }

  function fetchQueryJson(path, params = {}) {
    return fetchJson(buildQueryUrl(path, params));
  }

  function arrayFrom(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (!value || typeof value !== "object") {
      return [];
    }

    for (const key of [
      "assignments",
      "assignmentGrades",
      "data",
      "Data",
      "grades",
      "items",
      "Result",
      "Results",
      "value",
      "Value",
    ]) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }

    return [];
  }

  function firstValue(record, keys) {
    for (const key of keys) {
      const value = record?.[key];
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }

    return null;
  }

  function firstString(record, keys) {
    const value = firstValue(record, keys);
    return value === null ? "" : String(value).trim();
  }

  function getCurrentUserId(context) {
    const userInfo = context?.UserInfo || {};
    const masterUserInfo = context?.MasterUserInfo || {};
    return (
      userInfo.UserId ||
      userInfo.UserID ||
      userInfo.Id ||
      userInfo.id ||
      masterUserInfo.UserId ||
      masterUserInfo.UserID ||
      masterUserInfo.Id ||
      masterUserInfo.id ||
      ""
    );
  }

  function getDefaultPersonaId(context) {
    const userInfo = context?.UserInfo || {};
    const masterUserInfo = context?.MasterUserInfo || {};
    return (
      userInfo.DefaultPersonaId ||
      userInfo.defaultPersonaId ||
      masterUserInfo.DefaultPersonaId ||
      masterUserInfo.defaultPersonaId ||
      ""
    );
  }

  function getCurrentGradeLevel(gradeLevels) {
    const grades = arrayFrom(gradeLevels);
    return (
      grades.find((grade) => grade.CurrentInd === true || grade.CurrentInd === 1) ||
      grades[0] ||
      null
    );
  }

  function buildDurationSectionList(classes) {
    const sectionsByDuration = new Map();

    arrayFrom(classes).forEach((course) => {
      const durationId = firstString(course, ["DurationId", "durationId"]);
      const leadSectionId = firstString(course, ["leadsectionid", "LeadSectionId"]);

      if (!durationId || !leadSectionId) {
        return;
      }

      const sectionList = sectionsByDuration.get(durationId) || [];
      sectionList.push({
        LeadSectionId: Number(leadSectionId),
      });
      sectionsByDuration.set(durationId, sectionList);
    });

    return JSON.stringify(
      Array.from(sectionsByDuration.entries()).map(([durationId, leadSectionList]) => ({
        DurationId: Number(durationId),
        LeadSectionList: leadSectionList,
      })),
    );
  }

  async function getUserStatus() {
    return fetchJson("/api/webapp/userstatus");
  }

  async function getWebAppContext() {
    return fetchJson("/api/webapp/context?format=json");
  }

  async function getAssignmentGrades(userId) {
    return fetchApiJson("academics/AssignmentGrade", {
      params: {
        userId,
      },
    });
  }

  async function getStudentGradeLevels() {
    return fetchJson("/api/datadirect/StudentGradeLevelList/");
  }

  async function getStudentGroupTerms({ personaId, schoolYearLabel, userId }) {
    return fetchQueryJson("/api/DataDirect/StudentGroupTermList/", {
      personaId,
      schoolYearLabel,
      studentUserId: userId,
    });
  }

  async function getStudentClasses({
    durationList,
    markingPeriodId = "",
    memberLevel,
    personaId,
    schoolYearLabel,
    userId,
  }) {
    return fetchQueryJson("/api/datadirect/ParentStudentUserClassesGet", {
      durationList,
      markingPeriodId,
      memberLevel,
      persona: personaId,
      schoolYearLabel,
      userId,
    });
  }

  async function getStudentAttendance({ personaId, schoolYearLabel, userId }) {
    return fetchQueryJson("/api/datadirect/ParentStudentUserAttendance/", {
      personaId,
      schoolYearLabel,
      userId,
    });
  }

  async function getStudentPerformance({ personaId, schoolYearLabel, userId }) {
    return fetchQueryJson("/api/datadirect/ParentStudentUserPerformance/", {
      personaId,
      schoolYearLabel,
      userId,
    });
  }

  async function getGradeBookMyDayMarkingPeriods({ classes, personaId, userId }) {
    const durationSectionList = buildDurationSectionList(classes);

    if (!durationSectionList || durationSectionList === "[]") {
      return [];
    }

    return fetchQueryJson("/api/gradebook/GradeBookMyDayMarkingPeriods", {
      durationSectionList,
      personaId,
      userId,
    });
  }

  async function getAssignmentsForClass(leadSectionId) {
    return fetchApiJson("academics/assignment", {
      params: {
        leadSectionId,
      },
    });
  }

  async function getAssignmentsForGradeSections(assignmentGrades) {
    const leadSectionIds = Array.from(
      new Set(
        arrayFrom(assignmentGrades)
          .map((record) =>
            firstString(record, ["LeadSectionId", "leadSectionId", "SectionId", "sectionId"]),
          )
          .filter(Boolean),
      ),
    );

    if (!leadSectionIds.length) {
      return {
        assignments: [],
        errorMessage: "",
      };
    }

    const results = await Promise.allSettled(
      leadSectionIds.map((leadSectionId) => getAssignmentsForClass(leadSectionId)),
    );
    const assignments = [];
    const rejectedResults = [];

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        assignments.push(...arrayFrom(result.value));
        return;
      }

      rejectedResults.push(result);
    });

    return {
      assignments,
      errorMessage: rejectedResults.length
        ? `${rejectedResults.length} assignment metadata request failed.`
        : "",
    };
  }

  async function getProgress() {
    const context = await getWebAppContext();
    const userId = getCurrentUserId(context);
    const personaId = getDefaultPersonaId(context);

    if (!userId) {
      throw new Error("Current Blackbaud user id unavailable.");
    }

    if (!personaId) {
      throw new Error("Current Blackbaud persona id unavailable.");
    }

    const gradeLevels = await getStudentGradeLevels();
    const currentGradeLevel = getCurrentGradeLevel(gradeLevels);

    if (!currentGradeLevel) {
      throw new Error("Current Blackbaud grade level unavailable.");
    }

    const schoolYearLabel = firstString(currentGradeLevel, ["SchoolYearLabel"]);
    const durationList = firstString(currentGradeLevel, ["DurationId"]);
    const memberLevel = firstString(currentGradeLevel, ["LevelNum", "GradeLevel"]);

    const [termsResult, attendanceResult, performanceResult, classesResult] =
      await Promise.allSettled([
        getStudentGroupTerms({ personaId, schoolYearLabel, userId }),
        getStudentAttendance({ personaId, schoolYearLabel, userId }),
        getStudentPerformance({ personaId, schoolYearLabel, userId }),
        getStudentClasses({
          durationList,
          memberLevel,
          personaId,
          schoolYearLabel,
          userId,
        }),
      ]);

    if (classesResult.status === "rejected") {
      throw classesResult.reason;
    }

    const optionalErrors = [];
    const classes = classesResult.value;
    const markingPeriodsResult = await Promise.allSettled([
      getGradeBookMyDayMarkingPeriods({ classes, personaId, userId }),
    ]);

    for (const result of [
      termsResult,
      attendanceResult,
      performanceResult,
      markingPeriodsResult[0],
    ]) {
      if (result.status === "rejected") {
        optionalErrors.push(result.reason);
      }
    }

    return BN.data.normalize.progress.normalizeProgress({
      attendance: attendanceResult.status === "fulfilled" ? attendanceResult.value : [],
      classes,
      context,
      currentGradeLevel,
      gradeLevels,
      markingPeriods:
        markingPeriodsResult[0].status === "fulfilled" ? markingPeriodsResult[0].value : [],
      metadataErrorMessage: optionalErrors.length
        ? `${optionalErrors.length} optional progress request failed.`
        : "",
      performance: performanceResult.status === "fulfilled" ? performanceResult.value : [],
      source:
        "/api/datadirect/StudentGradeLevelList,/api/DataDirect/StudentGroupTermList,/api/datadirect/ParentStudentUserClassesGet,/api/datadirect/ParentStudentUserAttendance,/api/datadirect/ParentStudentUserPerformance,/api/gradebook/GradeBookMyDayMarkingPeriods",
      terms: termsResult.status === "fulfilled" ? termsResult.value : [],
      userId,
    });
  }

  async function getSectionRoster(sectionId) {
    return fetchJson(`/api/datadirect/sectionrosterget/${sectionId}/?format=json`);
  }

  async function getAthleticRoster(teamId) {
    return fetchJson(`/api/datadirect/athleticrosterget/?format=json&teamId=${teamId}`);
  }

  BN.define("sources.api.client", {
    fetchApiJson,
    fetchJson,
    getAssignmentGrades,
    getAssignmentsForClass,
    getAthleticRoster,
    getGradeBookMyDayMarkingPeriods,
    getProgress,
    getSectionRoster,
    getStudentAttendance,
    getStudentClasses,
    getStudentGradeLevels,
    getStudentGroupTerms,
    getStudentPerformance,
    getUserStatus,
    getWebAppContext,
  });
})();
