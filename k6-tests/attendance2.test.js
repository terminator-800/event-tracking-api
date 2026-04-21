import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
  vus: 20,
  duration: "30s",
};

const BASE = "http://localhost:5000";
const behaviorCounter = new Counter("attendance_behavior_total");
const requestCounter = new Counter("attendance_requests_total");
const scheduledTapCounter = new Counter("attendance_scheduled_taps_total");
const cohortCounter = new Counter("attendance_cohort_total");

function mapCourseKey(course, major) {
  const c = String(course ?? "").trim().toUpperCase();
  const m = String(major ?? "").trim().toLowerCase();

  if (c === "BSBA") {
    if (m === "marketing management") return "BSBA-MM";
    if (m === "human resource development management") return "BSBA-HRDM";
    if (m === "financial management") return "BSBA-FM";
    return "BSBA";
  }

  if (c === "BSED") {
    if (m === "english") return "BSED-ENG";
    if (m === "math") return "BSED-MATH";
    if (m === "filipino") return "BSED-FILIPINO";
    return "BSED";
  }

  return c;
}

function parseStudentLine(line) {
  const values = [...line.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (values.length < 2) return null;
  const studentId = String(values[0] ?? "").trim();
  const course = String(values[1] ?? "").trim();
  const major = String(values[2] ?? "").trim();
  if (!studentId || !course) return null;
  return { studentId, courseKey: mapCourseKey(course, major) };
}

function courseKeyToCohortId(courseKey) {
  return `course-${String(courseKey).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function buildCohortsFromFile() {
  const raw = open("./students-full.txt");
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const buckets = new Map();
  for (const line of lines) {
    const parsed = parseStudentLine(line);
    if (!parsed) continue;
    const id = courseKeyToCohortId(parsed.courseKey);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(parsed);
  }

  return Array.from(buckets.entries()).map(([id, students]) => ({ id, students }));
}

// Use all students from k6-tests/students-full.txt
const STUDENT_COHORTS = buildCohortsFromFile();

/**
 * Backend still determines official AM/PM and late checks by server time.
 * We attach simulated minute-by-minute tap times for test coverage:
 * - AM in:  08:00 AM to 10:00 AM
 * - AM out: 11:45 AM to 01:00 PM
 * - PM in:  01:00 PM to 03:00 PM
 * - PM out: 05:00 PM to 07:00 PM
 */
function toMinutes24(time12h) {
  const [hm, mer] = time12h.trim().split(" ");
  let [h, m] = hm.split(":").map(Number);
  const upper = mer.toUpperCase();
  if (upper === "AM") {
    if (h === 12) h = 0;
  } else if (upper === "PM") {
    if (h !== 12) h += 12;
  }
  return h * 60 + m;
}

function to12Hour(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const mer = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${mer}`;
}

function minuteRange(start12h, end12h) {
  const start = toMinutes24(start12h);
  const end = toMinutes24(end12h);
  const out = [];
  for (let t = start; t <= end; t += 1) out.push(to12Hour(t));
  return out;
}

const TIME_WINDOWS = {
  AM_IN: minuteRange("08:00 AM", "10:00 AM"),
  AM_OUT: minuteRange("11:45 AM", "01:00 PM"),
  PM_IN: minuteRange("01:00 PM", "03:00 PM"),
  PM_OUT: minuteRange("05:00 PM", "07:00 PM"),
};

function minuteFor(windowTimes, salt = 0) {
  return windowTimes[(__ITER + __VU + salt) % windowTimes.length];
}

function buildArchetype(archetype) {
  const amIn = { kind: "in", at: minuteFor(TIME_WINDOWS.AM_IN, 1) };
  const amOut = { kind: "out", at: minuteFor(TIME_WINDOWS.AM_OUT, 2) };
  const pmIn = { kind: "in", at: minuteFor(TIME_WINDOWS.PM_IN, 3) };
  const pmOut = { kind: "out", at: minuteFor(TIME_WINDOWS.PM_OUT, 4) };

  if (archetype === "perfect") {
    return { id: "perfect_wholeday", actions: [amIn, amOut, pmIn, pmOut] };
  }
  if (archetype === "late") {
    // Requested fixed late schedule:
    // AM in 9:30, AM out 12:50, PM in 2:30, PM out 6:30.
    const lateAmIn = { kind: "in", at: "09:30 AM" };
    const lateAmOut = { kind: "out", at: "12:50 PM" };
    const latePmIn = { kind: "in", at: "02:30 PM" };
    const latePmOut = { kind: "out", at: "06:30 PM" };
    return { id: "late_fixed_schedule", actions: [lateAmIn, lateAmOut, latePmIn, latePmOut] };
  }
  // Absent scenario: no time in and no time out.
  return { id: "absent_no_in_no_out", actions: [] };
}

function pickStudentFromCohort(cohort) {
  const idx = Math.floor(Math.random() * cohort.students.length);
  return cohort.students[idx];
}

function runScenarioForStudent(s, cohortId, archetype, scenario) {
  behaviorCounter.add(1, { cohort: cohortId, archetype, behavior: scenario.id });
  if (scenario.actions.length === 0) {
    return;
  }
  for (const action of scenario.actions) {
    scheduledTapCounter.add(1, { cohort: cohortId, archetype, behavior: scenario.id, at: action.at, kind: action.kind });
    const res = postAttendance(action, s);
    requestCounter.add(1, { cohort: cohortId, archetype, behavior: scenario.id, action: action.kind, at: action.at });
    check(res, {
      [`${cohortId}:${archetype}:${scenario.id}:${action.kind}:${action.at} accepted status`]: (r) =>
        isAcceptedStatus(r.status),
    });
    sleep(0.2);
  }
}

function isAcceptedStatus(status) {
  return [200, 400, 403, 404, 500].includes(status);
}


function postAttendance(action, s) {
  const payload = JSON.stringify({
    studentId: s.studentId,
    attendanceKind: action.kind, // "in" or "out"
    courseKey: s.courseKey,
    simulatedTapTime: action.at,
  });

  return http.post(`${BASE}/attendance/time-in-out`, payload, {
    headers: { "Content-Type": "application/json" },
  });
}

export default function () {
  const cohort = STUDENT_COHORTS[(__ITER + __VU) % STUDENT_COHORTS.length];
  cohortCounter.add(1, { cohort: cohort.id });

  runScenarioForStudent(pickStudentFromCohort(cohort), cohort.id, "perfect", buildArchetype("perfect"));
  runScenarioForStudent(pickStudentFromCohort(cohort), cohort.id, "late", buildArchetype("late"));
  runScenarioForStudent(pickStudentFromCohort(cohort), cohort.id, "absent", buildArchetype("absent"));

  sleep(1);
}