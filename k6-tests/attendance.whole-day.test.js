import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
  vus: 20,
  duration: "15m",
};

const BASE = "http://localhost:5000";
const behaviorCounter = new Counter("attendance_behavior_total");
const requestCounter = new Counter("attendance_requests_total");
const scheduledTapCounter = new Counter("attendance_scheduled_taps_total");
const cohortCounter = new Counter("attendance_cohort_total");

// use real student IDs that exist in your DB
const STUDENT_COHORTS = [
  {
    id: "cit-bsit",
    students: [
      { studentId: "202100641", courseKey: "BSIT" },
      { studentId: "2022006503", courseKey: "BSIT" },
      { studentId: "2021002091", courseKey: "BSIT" },
      { studentId: "2022003713", courseKey: "BSIT" },
    ],
  },
  {
    id: "ceas-beed",
    students: [
      { studentId: "202202361", courseKey: "BEED" },
      { studentId: "202519640", courseKey: "BEED" },
      { studentId: "2020001133", courseKey: "BEED" },
      { studentId: "2020001259", courseKey: "BEED" },
      { studentId: "2020001261", courseKey: "BEED" },
    ],
  },
  {
    id: "ceas-bsed-eng",
    students: [
      { studentId: "2021003336", courseKey: "BSED-ENG" },
      { studentId: "2021003406", courseKey: "BSED-ENG" },
    ],
  },
  {
    id: "ceas-bsed-math",
    students: [
      { studentId: "2021003223", courseKey: "BSED-MATH" },
      { studentId: "2022003499", courseKey: "BSED-MATH" },
      { studentId: "2022003683", courseKey: "BSED-MATH" },
      { studentId: "2022003709", courseKey: "BSED-MATH" },
    ],
  },
  {
    id: "ceas-bsed-filipino",
    students: [
      { studentId: "2025018576", courseKey: "BSED-FILIPINO" },
      { studentId: "2022003530", courseKey: "BSED-FILIPINO" },
      { studentId: "2022003567", courseKey: "BSED-FILIPINO" },
      { studentId: "2022003657", courseKey: "BSED-FILIPINO" },
      { studentId: "2022003667", courseKey: "BSED-FILIPINO" },
    ],
  },
  {
    id: "ccje-bscrim",
    students: [
      { studentId: "2021002341", courseKey: "BSCRIM" },
      { studentId: "2022003941", courseKey: "BSCRIM" },
      { studentId: "2022004123", courseKey: "BSCRIM" },
      { studentId: "2022004339", courseKey: "BSCRIM" },
    ],
  },
  {
    id: "cba-bsba-mm",
    students: [
      { studentId: "202100487", courseKey: "BSBA-MM" },
      { studentId: "2022003550", courseKey: "BSBA-MM" },
      { studentId: "2022003600", courseKey: "BSBA-MM" },
      { studentId: "2022003693", courseKey: "BSBA-MM" },
      { studentId: "2022003849", courseKey: "BSBA-MM" },
    ],
  },
  {
    id: "cba-bsba-hrdm",
    students: [
      { studentId: "2022009279", courseKey: "BSBA-HRDM" },
      { studentId: "2021002835", courseKey: "BSBA-HRDM" },
      { studentId: "2021003433", courseKey: "BSBA-HRDM" },
      { studentId: "2022003596", courseKey: "BSBA-HRDM" },
      { studentId: "2022003935", courseKey: "BSBA-HRDM" },
    ],
  },
  {
    id: "cba-bsba-fm",
    students: [
      { studentId: "2022004958", courseKey: "BSBA-FM" },
      { studentId: "2022003538", courseKey: "BSBA-FM" },
      { studentId: "2022003569", courseKey: "BSBA-FM" },
      { studentId: "2022003728", courseKey: "BSBA-FM" },
      { studentId: "2022003793", courseKey: "BSBA-FM" },
    ],
  },
  {
    id: "chm-bshm",
    students: [
      { studentId: "202100995", courseKey: "BSHM" },
      { studentId: "2022006259", courseKey: "BSHM" },
      { studentId: "2023011849", courseKey: "BSHM" },
      { studentId: "2023011576", courseKey: "BSHM" },
    ],
  },
];

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