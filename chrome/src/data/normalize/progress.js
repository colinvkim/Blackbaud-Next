(function () {
  const BN = globalThis.BlackbaudNext;

  const assignmentKeys = [
    "assignments",
    "assignmentGrades",
    "classes",
    "data",
    "Data",
    "grades",
    "items",
    "Result",
    "Results",
    "value",
    "Value",
  ];

  function arrayFrom(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (!value || typeof value !== "object") {
      return [];
    }

    for (const key of assignmentKeys) {
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
    if (value === null) {
      return "";
    }

    return String(value).trim();
  }

  function firstNumber(record, keys) {
    for (const key of keys) {
      const value = record?.[key];
      if (value === undefined || value === null || value === "") {
        continue;
      }

      const numericValue =
        typeof value === "string" ? Number(value.replace(/[%,$]/g, "")) : Number(value);
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }

    return null;
  }

  function firstBoolean(record, keys) {
    const value = firstValue(record, keys);
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }

    if (typeof value === "number") {
      return value === 1;
    }

    return false;
  }

  function sumValues(records, keys) {
    return records.reduce((total, record) => total + (firstNumber(record, keys) || 0), 0);
  }

  function averageValues(values) {
    const numericValues = values.filter((value) => typeof value === "number");
    if (!numericValues.length) {
      return null;
    }

    return (
      Math.round(
        (numericValues.reduce((total, value) => total + value, 0) / numericValues.length) *
          10,
      ) / 10
    );
  }

  function normalizeAssignment(record, index) {
    const score = firstNumber(record, [
      "GradebookGrade",
      "Score",
      "PointsEarned",
      "EarnedPoints",
      "Points",
      "RawScore",
    ]);
    const maxPoints = firstNumber(record, [
      "MaxPoints",
      "TotalPoints",
      "PossiblePoints",
      "PointsPossible",
      "MaxScore",
    ]);
    const rawGrade = firstString(record, ["GradebookGrade", "Score", "Grade"]);
    const displayGrade =
      firstString(record, [
        "GradebookGradeDisplay",
        "GradeDisplay",
        "DisplayGrade",
        "LetterGrade",
        "PercentGrade",
      ]) ||
      (score !== null ? String(score) : rawGrade);

    return {
      id:
        firstString(record, ["AssignmentId", "assignmentId", "Id", "id"]) ||
        `assignment-${index + 1}`,
      title:
        firstString(record, [
          "ShortDescription",
          "AbbrDescription",
          "AssignmentDescription",
          "Description",
          "LongDescription",
          "Title",
          "Name",
        ]) || `Assignment ${index + 1}`,
      type: firstString(record, [
        "AssignmentType",
        "AssignmentTypeDescription",
        "AssignmentTypeId",
        "Type",
      ]),
      assignedDate: firstString(record, [
        "DateAssigned",
        "AssignmentDate",
        "AssignedDate",
        "InsertDate",
      ]),
      dueDate: firstString(record, ["DateDue", "DueDate", "Due", "AssignmentDueDate"]),
      displayGrade,
      score,
      maxPoints,
      status: firstString(record, ["Status", "AssignmentStatus", "GradeStatus"]),
      missing: firstBoolean(record, ["Missing", "MissingInd", "Incomplete", "IncompleteInd"]),
      late: firstBoolean(record, ["Late", "LateInd"]),
    };
  }

  function getCourseKey(record, index) {
    return (
      firstString(record, ["LeadSectionId", "SectionId", "sectionId", "CourseId", "OfferingId"]) ||
      firstString(record, ["CourseTitle", "CourseName", "ClassName", "SectionName", "GroupName"]) ||
      `course-${index + 1}`
    );
  }

  function getCourseTitle(record, fallback) {
    return (
      firstString(record, [
        "CourseTitle",
        "CourseName",
        "ClassName",
        "SectionName",
        "GroupName",
        "Section",
      ]) || fallback
    );
  }

  function getCourseGrade(record) {
    return firstString(record, [
      "CurrentGrade",
      "CumulativeGrade",
      "Grade",
      "GradeDisplay",
      "MarkingPeriodGrade",
      "YearGrade",
    ]);
  }

  function getAssignmentId(record) {
    return firstString(record, ["AssignmentId", "assignmentId", "Id", "id"]);
  }

  function getSectionLink(metaRecord, gradeRecord) {
    const sectionLinks = Array.isArray(metaRecord?.SectionLinks)
      ? metaRecord.SectionLinks
      : [];

    if (!sectionLinks.length) {
      return {};
    }

    const sectionId = firstString(gradeRecord, [
      "LeadSectionId",
      "leadSectionId",
      "SectionId",
      "sectionId",
    ]);

    return (
      sectionLinks.find(
        (sectionLink) =>
          firstString(sectionLink, [
            "LeadSectionId",
            "leadSectionId",
            "SectionId",
            "sectionId",
          ]) === sectionId,
      ) || sectionLinks[0]
    );
  }

  function buildAssignmentMetadataIndex(assignments) {
    return arrayFrom(assignments).reduce((index, assignment) => {
      const assignmentId = getAssignmentId(assignment);
      if (assignmentId) {
        index.set(assignmentId, assignment);
      }

      return index;
    }, new Map());
  }

  function normalizeClassCourse(record, index) {
    const dueToday = firstNumber(record, ["assignmentduetoday", "AssignmentDueToday"]) || 0;
    const assignedToday =
      firstNumber(record, ["assignmentassignedtoday", "AssignmentAssignedToday"]) || 0;
    const active = firstNumber(record, ["assignmentactivetoday", "AssignmentActiveToday"]) || 0;
    const upcoming = firstNumber(record, ["UpcomingCount", "upcomingCount"]) || 0;
    const overdue = firstNumber(record, ["OverdueCount", "overdueCount"]) || 0;
    const cumulativeDisplay = firstString(record, [
      "CumulativeDisplay",
      "cumgrade",
      "gradebookcumgpa",
    ]);

    return {
      id:
        firstString(record, ["leadsectionid", "LeadSectionId", "sectionid", "SectionId"]) ||
        `course-${index + 1}`,
      title:
        firstString(record, [
          "sectionidentifier",
          "SectionIdentifier",
          "coursedescription",
          "CourseDescription",
        ]) || `Course ${index + 1}`,
      sectionId: firstString(record, ["sectionid", "SectionId", "leadsectionid"]),
      leadSectionId: firstString(record, ["leadsectionid", "LeadSectionId"]),
      term: firstString(record, ["currentterm", "CurrentTerm"]),
      grade: cumulativeDisplay,
      cumulativeDisplay,
      room: firstString(record, ["room", "Room"]),
      schoolLevel: firstString(record, ["schoollevel", "SchoolLevel"]),
      teacherEmail: firstString(record, ["groupowneremail", "GroupOwnerEmail"]),
      teacherName: firstString(record, ["groupownername", "GroupOwnerName"]),
      canViewAssignments: firstBoolean(record, ["canviewassignments", "CanViewAssignments"]),
      assignmentStats: {
        active,
        assignedToday,
        dueToday,
        overdue,
        upcoming,
      },
      assignments: [],
    };
  }

  function normalizeAttendance(records) {
    return arrayFrom(records).map((record) => ({
      category: firstString(record, ["category_description", "CategoryDescription"]),
      count: firstNumber(record, ["excuse_count", "ExcuseCount"]) || 0,
    }));
  }

  function normalizePerformance(records) {
    return arrayFrom(records).map((record) => ({
      description: firstString(record, [
        "performance_description",
        "PerformanceDescription",
      ]),
      type: firstString(record, ["performance_type", "PerformanceType"]),
    }));
  }

  function normalizeClassProgress(raw) {
    const classRecords = arrayFrom(raw?.classes);
    const courses = classRecords.map(normalizeClassCourse);
    const courseGrades = courses.map((course) => firstNumber(course, ["cumulativeDisplay"]));
    const activeAssignmentCount = sumValues(classRecords, [
      "assignmentactivetoday",
      "AssignmentActiveToday",
    ]);
    const assignedTodayCount = sumValues(classRecords, [
      "assignmentassignedtoday",
      "AssignmentAssignedToday",
    ]);
    const dueTodayCount = sumValues(classRecords, [
      "assignmentduetoday",
      "AssignmentDueToday",
    ]);
    const overdueCount = sumValues(classRecords, ["OverdueCount", "overdueCount"]);
    const upcomingCount = sumValues(classRecords, ["UpcomingCount", "upcomingCount"]);

    return {
      state: courses.length > 0 ? "loaded" : "empty",
      attendance: normalizeAttendance(raw?.attendance),
      fetchedAt: new Date().toISOString(),
      gradeLevel: firstString(raw?.currentGradeLevel, ["GradeLevel", "LevelDesc"]),
      metadataErrorMessage: raw?.metadataErrorMessage || "",
      performance: normalizePerformance(raw?.performance),
      schoolYearLabel: firstString(raw?.currentGradeLevel, ["SchoolYearLabel"]),
      source: raw?.source || "",
      userId: raw?.userId ? String(raw.userId) : "",
      summary: {
        activeAssignmentCount,
        assignedTodayCount,
        averageScore: averageValues(courseGrades),
        assignmentCount: activeAssignmentCount,
        courseCount: courses.length,
        dueTodayCount,
        gradedAssignmentCount: courses.filter((course) => course.cumulativeDisplay).length,
        overdueCount,
        upcomingCount,
      },
      courses,
    };
  }

  function normalizeAssignmentProgress(raw) {
    const records = arrayFrom(raw?.assignmentGrades || raw?.assignments || raw);
    const assignmentMetadata = buildAssignmentMetadataIndex(raw?.assignments || []);
    const coursesByKey = new Map();
    let gradedAssignmentCount = 0;
    let scoreTotal = 0;
    let scoreCount = 0;

    records.forEach((record, index) => {
      const metaRecord = assignmentMetadata.get(getAssignmentId(record)) || {};
      const mergedRecord = {
        ...getSectionLink(metaRecord, record),
        ...metaRecord,
        ...record,
      };
      const courseKey = getCourseKey(mergedRecord, index);
      const assignment = normalizeAssignment(mergedRecord, index);
      const sectionId = firstString(mergedRecord, [
        "SectionId",
        "sectionId",
        "LeadSectionId",
        "leadSectionId",
      ]);
      const existingCourse = coursesByKey.get(courseKey);

      if (assignment.displayGrade) {
        gradedAssignmentCount += 1;
      }

      if (
        typeof assignment.score === "number" &&
        typeof assignment.maxPoints === "number" &&
        assignment.maxPoints > 0
      ) {
        scoreTotal += assignment.score / assignment.maxPoints;
        scoreCount += 1;
      }

      if (existingCourse) {
        existingCourse.assignments.push(assignment);
        return;
      }

      coursesByKey.set(courseKey, {
        id: courseKey,
        title: getCourseTitle(mergedRecord, `Course ${coursesByKey.size + 1}`),
        sectionId,
        term: firstString(mergedRecord, ["Term", "TermName", "MarkingPeriod", "DurationName"]),
        grade: getCourseGrade(mergedRecord),
        assignments: [assignment],
      });
    });

    const courses = Array.from(coursesByKey.values());
    const assignmentCount = records.length;
    const averageScore =
      scoreCount > 0 ? Math.round((scoreTotal / scoreCount) * 1000) / 10 : null;

    return {
      state: courses.length > 0 ? "loaded" : "empty",
      attendance: [],
      fetchedAt: new Date().toISOString(),
      gradeLevel: "",
      metadataErrorMessage: raw?.metadataErrorMessage || "",
      performance: [],
      schoolYearLabel: "",
      source: raw?.source || "",
      userId: raw?.userId ? String(raw.userId) : "",
      summary: {
        activeAssignmentCount: assignmentCount,
        assignedTodayCount: 0,
        averageScore,
        assignmentCount,
        courseCount: courses.length,
        dueTodayCount: 0,
        gradedAssignmentCount,
        overdueCount: 0,
        upcomingCount: 0,
      },
      courses,
    };
  }

  function normalizeProgress(raw) {
    if (raw?.classes) {
      return normalizeClassProgress(raw);
    }

    return normalizeAssignmentProgress(raw);
  }

  BN.define("data.normalize.progress", {
    normalizeProgress,
  });
})();
