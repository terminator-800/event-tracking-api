// eslint-disable-next-line @typescript-eslint/no-require-imports
const XlsxPopulate: any = require("xlsx-populate");

import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/db";
import {
  getExportSettings,
  getExportKeyForClient,
} from "./export-security.service";
import {
  selectStudentsForEventDetail,
  EventStudentRow,
} from "../../repositories/attendance-page.repository";

// ── Colours (NMCI brand) ──────────────────────────────────────────────────────
const GREEN = "07713C";
const HEADER_TEXT = "FFFFFF";
const ALT_ROW = "F1FAF4";

// ── Helpers ──────────────────────────────────────────────────────────────────

function styleHeader(cell: any) {
  cell.style("bold", true);
  cell.style("fill", { type: "solid", color: GREEN });
  cell.style("fontColor", HEADER_TEXT);
  cell.style("horizontalAlignment", "center");
  cell.style("wrapText", false);
}

function styleAltRow(sheet: any, rowIdx: number, colCount: number) {
  if (rowIdx % 2 === 0) return;
  for (let c = 1; c <= colCount; c++) {
    try {
      sheet.cell(rowIdx, c).style("fill", { type: "solid", color: ALT_ROW });
    } catch { /* skip if cell doesn't support styling */ }
  }
}

function sanitizeFilePart(str: string, maxLen = 30): string {
  return str
    .replace(/[^a-zA-Z0-9\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, maxLen);
}

function buildEventFilename(
  eventName: string,
  deptName: string | null,
  deptCode: string | null,
  date: string,
): string {
  const namePart = sanitizeFilePart(eventName, 35);
  const deptPart = deptCode
    ? sanitizeFilePart(deptCode, 15)
    : deptName
      ? sanitizeFilePart(deptName.replace(/college of /i, "").trim(), 20)
      : "Dept";
  const datePart = String(date).split("T")[0];
  return `${namePart}_${deptPart}_${datePart}.xlsx`;
}

// ── DB queries ────────────────────────────────────────────────────────────────

interface EventDbRow extends RowDataPacket {
  id: number;
  name: string;
  date: string;
  venue: string;
  status: string;
  duration: string;
  fine_amount: number;
  is_all_departments: number;
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
  created_by_username: string;
  academic_period_id: number | null;
  audience_notes?: string | null;
}

async function getEventById(eventId: number): Promise<EventDbRow | null> {
  const [rows] = await pool.execute<EventDbRow[]>(
    `SELECT e.*, u.username AS created_by_username
     FROM events e
     LEFT JOIN users u ON u.id = e.created_by
     WHERE e.id = ? LIMIT 1`,
    [eventId],
  );
  return rows[0] ?? null;
}

async function getEventPayments(eventId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       s.student_id,
       COALESCE(
         TRIM(CONCAT(COALESCE(s.first_name,''),' ',COALESCE(s.middle_name,''),' ',COALESCE(s.last_name,''))),
         s.full_name,
         ''
       ) AS student_name,
       f.reason       AS fine_reason,
       f.amount       AS fine_amount,
       f.paid_amount,
       f.status       AS fine_status,
       pay.receipt_no,
       pay.amount_paid,
       pay.payment_method,
       pay.remarks,
       pay.paid_at
     FROM fines f
     JOIN students s ON s.id = f.student_id
     LEFT JOIN payments pay ON pay.fine_id = f.id
     WHERE f.event_id = ?
     ORDER BY student_name, f.reason`,
    [eventId],
  );
  return rows;
}

interface DeptInfo {
  deptName: string | null;
  deptCode: string | null;
  deptId: number | null;
}

async function getEventDepartmentInfo(eventId: number): Promise<DeptInfo> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.id, d.name, d.code
     FROM events e
     LEFT JOIN users u ON u.id = e.created_by
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE e.id = ? LIMIT 1`,
    [eventId],
  );
  if (rows.length === 0 || !rows[0].name) {
    return { deptName: null, deptCode: null, deptId: null };
  }
  return {
    deptName: String(rows[0].name).trim() || null,
    deptCode: String(rows[0].code || "").trim() || null,
    deptId: rows[0].id ? Number(rows[0].id) : null,
  };
}

// ── Audit log ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  action: "export" | "import" | "import_rejected";
  event_id?: number | null;
  event_name?: string | null;
  user_id: number;
  username: string;
  file_name?: string | null;
  password_protected?: boolean;
  import_status?: string | null;
  notes?: string | null;
}

export async function logExportAudit(entry: AuditEntry): Promise<void> {
  await pool.execute(
    `INSERT INTO export_audit_log
       (action, event_id, event_name, user_id, username, file_name, protected, import_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.action,
      entry.event_id ?? null,
      entry.event_name ?? null,
      entry.user_id,
      entry.username,
      entry.file_name ?? null,
      entry.password_protected ? 1 : 0,
      entry.import_status ?? null,
      entry.notes ?? null,
    ],
  );
}

export async function getExportAuditLog(limit = 50): Promise<RowDataPacket[]> {
  limit = Math.max(1, Math.min(Number(limit), 200));

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      id,
      action,
      event_id,
      event_name,
      username,
      file_name,
      protected,
      import_status,
      notes,
      created_at
    FROM export_audit_log
    ORDER BY created_at DESC
    LIMIT ${limit}
    `
  );

  return rows;
}

// ── Excel generation ─────────────────────────────────────────────────────────

export interface GenerateExcelOptions {
  eventId: number;
  userId: number;
  username: string;
  /** When null the query uses institution-wide scope (admin/csg_president) */
  departmentScope: number | null;
}

export interface GenerateExcelResult {
  buffer: Buffer;
  filename: string;
}

export async function generateEventExcel(
  opts: GenerateExcelOptions,
): Promise<GenerateExcelResult> {
  const { eventId, userId, username, departmentScope } = opts;

  const event = await getEventById(eventId);
  if (!event) throw new Error("Event not found.");

  const deptInfo = await getEventDepartmentInfo(eventId);
  const students = await selectStudentsForEventDetail(eventId, departmentScope);
  const payments = await getEventPayments(eventId);

  const exportSettings = await getExportSettings();
  const exportPassword = exportSettings.is_enabled ? await getExportKeyForClient() : null;
  const fingerprint = exportSettings.is_enabled ? exportSettings.export_fingerprint : null;

  const eventDate = String(event.date).split("T")[0];
  const wb = await XlsxPopulate.fromBlankAsync();

  // ── Sheet 1: Event Info ──────────────────────────────────────────────────
  const infoSheet = wb.sheet(0);
  infoSheet.name("Event Info");

  const infoRows: [string, string | number][] = [
    ["Field", "Value"],
    ["Event Name", event.name],
    ["Date", eventDate],
    ["Venue", event.venue],
    ["Department", deptInfo.deptName ?? "—"],
    ["Department Code", deptInfo.deptCode ?? "—"],
    ["Status", event.status],
    ["Duration", event.duration],
    ["Fine Per Absence (PHP)", Number(event.fine_amount ?? 0)],
    ["All Departments", Number(event.is_all_departments) === 1 ? "Yes" : "No"],
    ["AM Time In", event.am_time_in ?? "—"],
    ["AM Time Out", event.am_time_out ?? "—"],
    ["PM Time In", event.pm_time_in ?? "—"],
    ["PM Time Out", event.pm_time_out ?? "—"],
    ["Description", (event.audience_notes as string | undefined | null) ?? "—"],
    ["Created By", event.created_by_username],
    ["Exported By", username],
    ["Exported At", new Date().toLocaleString("en-PH")],
    ["Password Protected", exportPassword ? "Yes" : "No"],
    ["Total Students", students.length],
    ["Total Payment Records", payments.length],
  ];

  infoRows.forEach(([key, val], i) => {
    infoSheet.cell(i + 1, 1).value(key);
    infoSheet.cell(i + 1, 2).value(val);
    if (i === 0) {
      styleHeader(infoSheet.cell(1, 1));
      styleHeader(infoSheet.cell(1, 2));
    }
  });
  infoSheet.column(1).width(28);
  infoSheet.column(2).width(40);

  // ── Sheet 2: Attendance ──────────────────────────────────────────────────
  const attSheet = wb.addSheet("Attendance");
  const attHeaders = [
    "Student ID",
    "Full Name",
    "Department",
    "Course",
    "Major",
    "Year Level",
    "Attendance",
    "AM Time In",
    "AM Time Out",
    "PM Time In",
    "PM Time Out",
    "Fine (PHP)",
  ];
  const attWidths = [14, 28, 24, 12, 14, 12, 12, 14, 14, 14, 14, 12];

  attHeaders.forEach((h, ci) => styleHeader(attSheet.cell(1, ci + 1).value(h)));
  attWidths.forEach((w, ci) => attSheet.column(ci + 1).width(w));

  let attendedCount = 0;
  students.forEach((s: EventStudentRow, si) => {
    const ri = si + 2;
    const attended =
      s.am_time_in != null ||
      s.am_time_out != null ||
      s.pm_time_in != null ||
      s.pm_time_out != null;
    if (attended) attendedCount++;
    const ylNum = s.year_level != null && Number.isFinite(Number(s.year_level)) ? Number(s.year_level) : "";

    attSheet.cell(ri, 1).value(s.student_id ?? "");
    attSheet.cell(ri, 2).value(s.full_name ?? "");
    attSheet.cell(ri, 3).value(s.department_name ?? "");
    attSheet.cell(ri, 4).value(s.course_code ?? "");
    attSheet.cell(ri, 5).value(s.major ?? "");
    attSheet.cell(ri, 6).value(ylNum);
    attSheet.cell(ri, 7).value(attended ? "Attended" : "Absent");
    attSheet.cell(ri, 8).value(s.am_time_in ?? "");
    attSheet.cell(ri, 9).value(s.am_time_out ?? "");
    attSheet.cell(ri, 10).value(s.pm_time_in ?? "");
    attSheet.cell(ri, 11).value(s.pm_time_out ?? "");
    attSheet.cell(ri, 12).value(Number(s.fine_total ?? 0));
    styleAltRow(attSheet, ri, 12);
  });

  // ── Sheet 3: Attendance Summary ──────────────────────────────────────────
  const absentCount = students.length - attendedCount;
  const attendanceRate =
    students.length > 0
      ? ((attendedCount / students.length) * 100).toFixed(1)
      : "0.0";
  const totalFinesAmt = payments.reduce(
    (sum, p) => sum + Number(p.fine_amount ?? 0),
    0,
  );
  const totalPaid = payments.reduce(
    (sum, p) => sum + Number(p.paid_amount ?? 0),
    0,
  );

  const summSheet = wb.addSheet("Attendance Summary");
  const summRows: [string, string | number][] = [
    ["Field", "Value"],
    ["Total Students", students.length],
    ["Attended", attendedCount],
    ["Absent", absentCount],
    ["Attendance Rate", `${attendanceRate}%`],
    ["Total Fines Generated (PHP)", totalFinesAmt],
    ["Total Paid (PHP)", totalPaid],
    ["Total Unpaid (PHP)", Math.max(0, totalFinesAmt - totalPaid)],
  ];
  summRows.forEach(([k, v], i) => {
    summSheet.cell(i + 1, 1).value(k);
    summSheet.cell(i + 1, 2).value(v);
    if (i === 0) {
      styleHeader(summSheet.cell(1, 1));
      styleHeader(summSheet.cell(1, 2));
    }
  });
  summSheet.column(1).width(30);
  summSheet.column(2).width(20);

  // ── Sheet 4: Payments ────────────────────────────────────────────────────
  const paySheet = wb.addSheet("Payments");
  const payHeaders = [
    "Student ID",
    "Student Name",
    "Fine Reason",
    "Fine Amount",
    "Amount Paid",
    "Balance",
    "Fine Status",
    "Receipt No",
    "Payment Method",
    "Remarks",
    "Paid At",
  ];
  const payWidths = [14, 26, 20, 13, 13, 12, 12, 16, 18, 22, 20];

  payHeaders.forEach((h, ci) => styleHeader(paySheet.cell(1, ci + 1).value(h)));
  payWidths.forEach((w, ci) => paySheet.column(ci + 1).width(w));

  if (payments.length === 0) {
    paySheet.cell(2, 1).value("No payment records for this event.");
  } else {
    payments.forEach((p, pi) => {
      const ri = pi + 2;
      const fineAmt = Number(p.fine_amount ?? 0);
      const paidAmt = Number(p.paid_amount ?? 0);
      paySheet.cell(ri, 1).value(String(p.student_id ?? ""));
      paySheet.cell(ri, 2).value(String(p.student_name ?? ""));
      paySheet.cell(ri, 3).value(String(p.fine_reason ?? ""));
      paySheet.cell(ri, 4).value(fineAmt);
      paySheet.cell(ri, 5).value(Number(p.amount_paid ?? 0));
      paySheet.cell(ri, 6).value(Math.max(0, fineAmt - paidAmt));
      paySheet.cell(ri, 7).value(String(p.fine_status ?? ""));
      paySheet.cell(ri, 8).value(String(p.receipt_no ?? ""));
      paySheet.cell(ri, 9).value(String(p.payment_method ?? ""));
      paySheet.cell(ri, 10).value(String(p.remarks ?? ""));
      paySheet.cell(ri, 11).value(
        p.paid_at ? new Date(p.paid_at as string).toLocaleString("en-PH") : "",
      );
      styleAltRow(paySheet, ri, 11);
    });
  }

  // ── Sheet 5: _System (hidden metadata for import validation) ─────────────
  const sysSheet = wb.addSheet("_System");
  try {
    sysSheet.hidden(true);
  } catch { /* ignore if not supported */ }

  const sysRows: [string, string][] = [
    ["Key", "Value"],
    ["SYSTEM", "NMCI-EVENT-TRACKING"],
    ["VERSION", "2"],
    ["EVENT_ID", String(event.id)],
    ["EVENT_NAME", event.name],
    ["EVENT_DATE", eventDate],
    ["DEPARTMENT_NAME", deptInfo.deptName ?? ""],
    ["DEPARTMENT_CODE", deptInfo.deptCode ?? ""],
    ["EXPORT_DATE", new Date().toISOString()],
    ["EXPORT_FINGERPRINT", fingerprint ?? ""],
    ["EXPORTED_BY", username],
  ];
  sysRows.forEach(([k, v], i) => {
    sysSheet.cell(i + 1, 1).value(k);
    sysSheet.cell(i + 1, 2).value(v);
  });

  const filename = buildEventFilename(
    event.name,
    deptInfo.deptName,
    deptInfo.deptCode,
    eventDate,
  );

  await logExportAudit({
    action: "export",
    event_id: event.id,
    event_name: event.name,
    user_id: userId,
    username,
    file_name: filename,
    password_protected: !!exportPassword,
  });

  const outputOpts: Record<string, unknown> = {};
  if (exportPassword) outputOpts.password = exportPassword;
  const buffer = (await wb.outputAsync(outputOpts)) as Buffer;
  return { buffer, filename };
}

// ── All-events Excel ─────────────────────────────────────────────────────────

interface AllEventsRow extends RowDataPacket {
  id: number;
  name: string;
  date: string;
  venue: string;
  status: string;
  duration: string;
  fine_amount: number;
}

export async function generateAllEventsExcel(opts: {
  userId: number;
  username: string;
  role: string;
  departmentScope: number | null;
}): Promise<Buffer> {
  const { userId, username, role, departmentScope } = opts;

  let eventsQuery = `SELECT e.id, e.name, DATE_FORMAT(e.date,'%Y-%m-%d') AS date, e.venue, e.status, e.duration, e.fine_amount
                     FROM events e WHERE 1=1`;
  const eventsParams: (string | number)[] = [];

  if (role === "csg_president") {
    eventsQuery += " AND e.created_by = ?";
    eventsParams.push(userId);
  } else if (role !== "admin" && role !== "super_admin" && departmentScope != null) {
    eventsQuery += ` AND (e.is_all_departments = 1 OR EXISTS (
      SELECT 1 FROM event_audiences ea WHERE ea.event_id = e.id AND ea.department_id = ?
    )) AND e.created_by = ?`;
    eventsParams.push(departmentScope, userId);
  }

  eventsQuery += " ORDER BY e.date DESC";
  const [eventRows] = await pool.execute<AllEventsRow[]>(eventsQuery, eventsParams);

  const exportSettings = await getExportSettings();
  const exportPassword = exportSettings.is_enabled ? await getExportKeyForClient() : null;
  const fingerprint = exportSettings.is_enabled ? exportSettings.export_fingerprint : null;

  const wb = await XlsxPopulate.fromBlankAsync();

  const summSheet = wb.sheet(0);
  summSheet.name("Events Summary");
  const summHeaders = ["Event ID", "Event Name", "Date", "Venue", "Status", "Duration", "Fine/Absence (PHP)"];
  const summWidths = [10, 36, 14, 28, 12, 14, 18];
  summHeaders.forEach((h, ci) => styleHeader(summSheet.cell(1, ci + 1).value(h)));
  summWidths.forEach((w, ci) => summSheet.column(ci + 1).width(w));

  eventRows.forEach((ev, ei) => {
    const ri = ei + 2;
    summSheet.cell(ri, 1).value(ev.id);
    summSheet.cell(ri, 2).value(ev.name);
    summSheet.cell(ri, 3).value(ev.date);
    summSheet.cell(ri, 4).value(ev.venue);
    summSheet.cell(ri, 5).value(ev.status);
    summSheet.cell(ri, 6).value(ev.duration);
    summSheet.cell(ri, 7).value(Number(ev.fine_amount ?? 0));
    styleAltRow(summSheet, ri, 7);
  });

  const allAttSheet = wb.addSheet("All Attendance");
  const allAttHeaders = ["Event ID", "Event Name", "Event Date", "Student ID", "Full Name", "Department", "Course", "Year Level", "Attendance", "Fine (PHP)"];
  const allAttWidths = [10, 28, 12, 14, 26, 22, 12, 12, 12, 12];
  allAttHeaders.forEach((h, ci) => styleHeader(allAttSheet.cell(1, ci + 1).value(h)));
  allAttWidths.forEach((w, ci) => allAttSheet.column(ci + 1).width(w));

  let allRow = 2;
  for (const ev of eventRows) {
    const students = await selectStudentsForEventDetail(ev.id, departmentScope);
    for (const s of students) {
      const attended = s.am_time_in != null || s.am_time_out != null || s.pm_time_in != null || s.pm_time_out != null;
      const ylNum = s.year_level != null && Number.isFinite(Number(s.year_level)) ? Number(s.year_level) : "";
      allAttSheet.cell(allRow, 1).value(ev.id);
      allAttSheet.cell(allRow, 2).value(ev.name);
      allAttSheet.cell(allRow, 3).value(ev.date);
      allAttSheet.cell(allRow, 4).value(s.student_id ?? "");
      allAttSheet.cell(allRow, 5).value(s.full_name ?? "");
      allAttSheet.cell(allRow, 6).value(s.department_name ?? "");
      allAttSheet.cell(allRow, 7).value(s.course_code ?? "");
      allAttSheet.cell(allRow, 8).value(ylNum);
      allAttSheet.cell(allRow, 9).value(attended ? "Attended" : "Absent");
      allAttSheet.cell(allRow, 10).value(Number(s.fine_total ?? 0));
      styleAltRow(allAttSheet, allRow, 10);
      allRow++;
    }
  }

  const sysSheet = wb.addSheet("_System");
  try {
    sysSheet.hidden(true);
  } catch { /* ignore */ }
  const allSysRows: [string, string][] = [
    ["Key", "Value"],
    ["SYSTEM", "NMCI-EVENT-TRACKING"],
    ["VERSION", "2"],
    ["EXPORT_TYPE", "ALL_EVENTS"],
    ["EXPORT_DATE", new Date().toISOString()],
    ["EXPORT_FINGERPRINT", fingerprint ?? ""],
    ["EXPORTED_BY", username],
    ["EVENT_COUNT", String(eventRows.length)],
  ];
  allSysRows.forEach(([k, v], i) => {
    sysSheet.cell(i + 1, 1).value(k);
    sysSheet.cell(i + 1, 2).value(v);
  });

  await logExportAudit({
    action: "export",
    user_id: userId,
    username,
    file_name: `all-events-${new Date().toISOString().slice(0, 10)}.xlsx`,
    password_protected: !!exportPassword,
    notes: `${eventRows.length} event(s) exported`,
  });

  const outputOpts: Record<string, unknown> = {};
  if (exportPassword) outputOpts.password = exportPassword;
  return (await wb.outputAsync(outputOpts)) as Buffer;
}

// ── Helper: read _System sheet as a key→value Map ────────────────────────────

function readSysSheet(sysSheet: any): Map<string, string> {
  const data = new Map<string, string>();
  if (!sysSheet) return data;
  try {
    const usedRange = sysSheet.usedRange();
    if (!usedRange) return data;
    const lastRow = usedRange.endCell().rowNumber();
    for (let r = 2; r <= lastRow; r++) {
      const key = String(sysSheet.cell(r, 1).value() ?? "").trim();
      const val = String(sysSheet.cell(r, 2).value() ?? "").trim();
      if (key) data.set(key, val);
    }
  } catch { /* ignore */ }
  return data;
}

// ── Excel import + validation ─────────────────────────────────────────────────

export interface ImportPreview {
  valid: boolean;
  message: string;
  eventId?: number | null;
  eventName?: string;
  eventDate?: string;
  department?: string;
  studentCount?: number;
  attendanceCount?: number;
  paymentCount?: number;
  exportedBy?: string;
  exportDate?: string;
  fingerprintMatch?: boolean;
  isDuplicate?: boolean;
  duplicateEventId?: number | null;
  existingEventName?: string | null;
}

export async function previewImportExcel(
  buffer: Buffer,
  userId: number,
  username: string,
): Promise<ImportPreview> {
  const exportSettings = await getExportSettings();
  const exportPassword = exportSettings.is_enabled ? await getExportKeyForClient() : null;

  let wb: any;
  try {
    const openOpts: Record<string, unknown> = {};
    if (exportPassword) openOpts.password = exportPassword;
    wb = await XlsxPopulate.fromDataAsync(buffer, openOpts);
  } catch {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_password",
      notes: "File could not be opened — wrong password or corrupted file.",
    });
    return {
      valid: false,
      message:
        "This export file is invalid or was not generated using the current System Export Password.",
    };
  }

  const sysSheet = wb.sheet("_System");
  if (!sysSheet) {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_file",
    });
    return {
      valid: false,
      message:
        "Invalid file: missing system metadata sheet. This file was not generated by the NMCI system.",
    };
  }

  const sysData = readSysSheet(sysSheet);
  const readSys = (key: string) => sysData.get(key) ?? "";

  if (readSys("SYSTEM") !== "NMCI-EVENT-TRACKING") {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_file",
    });
    return {
      valid: false,
      message:
        "Invalid file: this file was not generated by the NMCI Event Tracking system.",
    };
  }

  // Reject all-events exports — only single-event files can be imported
  if (readSys("EXPORT_TYPE") === "ALL_EVENTS") {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_file",
      notes: "Attempted to import an all-events export file.",
    });
    return {
      valid: false,
      message:
        "This file is an all-events export and cannot be imported. Please export a single event.",
    };
  }

  const fileFingerprint = readSys("EXPORT_FINGERPRINT");
  let fingerprintMatch = false;
  if (fileFingerprint && exportSettings.export_fingerprint) {
    fingerprintMatch = fileFingerprint === exportSettings.export_fingerprint;
    if (!fingerprintMatch) {
      await logExportAudit({
        action: "import_rejected",
        user_id: userId,
        username,
        import_status: "invalid_password",
      });
      return {
        valid: false,
        message:
          "This export file is invalid or was not generated using the current System Export Password.",
      };
    }
  }

  const eventIdStr = readSys("EVENT_ID");
  const eventName = readSys("EVENT_NAME");
  const eventDate = readSys("EVENT_DATE");
  const deptName = readSys("DEPARTMENT_NAME");
  const exportDate = readSys("EXPORT_DATE");
  const exportedBy = readSys("EXPORTED_BY");

  // Count students in Attendance sheet
  const attSheet = wb.sheet("Attendance");
  let studentCount = 0;
  let attendanceCount = 0;
  if (attSheet) {
    try {
      const usedRange = attSheet.usedRange();
      if (usedRange) {
        const lastRow = usedRange.endCell().rowNumber();
        studentCount = Math.max(0, lastRow - 1);
        for (let r = 2; r <= lastRow; r++) {
          const attVal = String(attSheet.cell(r, 7).value() ?? "").trim();
          if (attVal === "Attended") attendanceCount++;
        }
      }
    } catch { /* ignore */ }
  }

  const paySheet = wb.sheet("Payments");
  let paymentCount = 0;
  if (paySheet) {
    try {
      const usedRange = paySheet.usedRange();
      if (usedRange) {
        const firstCellVal = String(paySheet.cell(2, 1).value() ?? "").trim();
        if (!firstCellVal.startsWith("No payment")) {
          paymentCount = Math.max(0, usedRange.endCell().rowNumber() - 1);
        }
      }
    } catch { /* ignore */ }
  }

  // Duplicate event detection
  let isDuplicate = false;
  let duplicateEventId: number | null = null;
  let existingEventName: string | null = null;
  if (eventName && eventDate) {
    const [dupRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name FROM events WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND DATE(date) = ? LIMIT 1`,
      [eventName, eventDate],
    );
    if (dupRows.length > 0) {
      isDuplicate = true;
      duplicateEventId = dupRows[0].id as number;
      existingEventName = String(dupRows[0].name ?? "");
    }
  }

  await logExportAudit({
    action: "import",
    event_id: eventIdStr ? Number(eventIdStr) : null,
    event_name: eventName || null,
    user_id: userId,
    username,
    import_status: "preview",
    password_protected: !!exportPassword,
    notes: `Preview: ${studentCount} students, ${attendanceCount} attended, ${paymentCount} payment records${isDuplicate ? " — DUPLICATE DETECTED" : ""}`,
  });

  return {
    valid: true,
    message: "File verified successfully.",
    eventId: eventIdStr ? Number(eventIdStr) : null,
    eventName,
    eventDate,
    department: deptName || undefined,
    studentCount,
    attendanceCount,
    paymentCount,
    exportedBy,
    exportDate,
    fingerprintMatch: !!fingerprintMatch,
    isDuplicate,
    duplicateEventId,
    existingEventName,
  };
}

// ── Full event import ─────────────────────────────────────────────────────────

export interface ImportResult {
  success: boolean;
  message: string;
  attendanceCreated: number;
  attendanceSkipped: number;
}

/** Legacy import — kept for backward compatibility with existing route */
export async function importEventExcel(
  buffer: Buffer,
  userId: number,
  username: string,
): Promise<ImportResult> {
  const preview = await previewImportExcel(buffer, userId, username);
  if (!preview.valid) {
    return {
      success: false,
      message: preview.message,
      attendanceCreated: 0,
      attendanceSkipped: 0,
    };
  }

  const exportPassword = await getExportKeyForClient();
  const openOpts: Record<string, unknown> = {};
  if (exportPassword) openOpts.password = exportPassword;
  const wb = await XlsxPopulate.fromDataAsync(buffer, openOpts);

  const attSheet = wb.sheet("Attendance");
  if (!attSheet) {
    return {
      success: false,
      message: "Attendance sheet not found in file.",
      attendanceCreated: 0,
      attendanceSkipped: 0,
    };
  }

  const eventId = preview.eventId;
  if (!eventId) {
    return {
      success: false,
      message: "Event ID not found in file metadata.",
      attendanceCreated: 0,
      attendanceSkipped: 0,
    };
  }

  const [evCheck] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (evCheck.length === 0) {
    return {
      success: false,
      message: `Event (ID: ${eventId}) does not exist in this system.`,
      attendanceCreated: 0,
      attendanceSkipped: 0,
    };
  }

  const usedRange = attSheet.usedRange();
  if (!usedRange) {
    return {
      success: true,
      message: "No attendance records in file.",
      attendanceCreated: 0,
      attendanceSkipped: 0,
    };
  }
  const lastRow = usedRange.endCell().rowNumber();

  let created = 0;
  let skipped = 0;

  for (let ri = 2; ri <= lastRow; ri++) {
    const studentIdVal = String(attSheet.cell(ri, 1).value() ?? "").trim();
    if (!studentIdVal) continue;

    const [stRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM students WHERE student_id = ? LIMIT 1`,
      [studentIdVal],
    );
    if (stRows.length === 0) {
      skipped++;
      continue;
    }
    const studentPk = stRows[0].id as number;

    const [attRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM attendance WHERE student_id = ? AND event_id = ? LIMIT 1`,
      [studentPk, eventId],
    );
    if (attRows.length > 0) {
      skipped++;
      continue;
    }

    const amIn = String(attSheet.cell(ri, 8).value() ?? "").trim() || null;
    const amOut = String(attSheet.cell(ri, 9).value() ?? "").trim() || null;
    const pmIn = String(attSheet.cell(ri, 10).value() ?? "").trim() || null;
    const pmOut = String(attSheet.cell(ri, 11).value() ?? "").trim() || null;

    if (!amIn && !amOut && !pmIn && !pmOut) {
      skipped++;
      continue;
    }

    await pool.execute<ResultSetHeader>(
      `INSERT INTO attendance (student_id, event_id, am_time_in, am_time_out, pm_time_in, pm_time_out)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE am_time_in = VALUES(am_time_in), am_time_out = VALUES(am_time_out),
                               pm_time_in = VALUES(pm_time_in), pm_time_out = VALUES(pm_time_out)`,
      [studentPk, eventId, amIn, amOut, pmIn, pmOut],
    );
    created++;
  }

  return {
    success: true,
    message: `Import completed. ${created} attendance record(s) created, ${skipped} skipped.`,
    attendanceCreated: created,
    attendanceSkipped: skipped,
  };
}

// ── Full Import: create event + students + attendance + fines + payments ──────

export interface ImportFullResult {
  success: boolean;
  message: string;
  skipped?: boolean;
  isDuplicate?: boolean;
  duplicateEventId?: number | null;
  eventId?: number | null;
  eventName?: string | null;
  department?: string | null;
  eventCreated?: boolean;
  studentsImported?: number;
  studentsFound?: number;
  attendanceCreated?: number;
  attendanceSkipped?: number;
  finesCreated?: number;
  paymentsCreated?: number;
  failedRecords?: number;
  errors?: string[];
}

export async function importEventFull(
  buffer: Buffer,
  userId: number,
  username: string,
  duplicateAction: "check" | "skip" | "replace" | "copy",
): Promise<ImportFullResult> {
  // ── Step 1: Open file ────────────────────────────────────────────────────
  const exportSettings = await getExportSettings();
  const exportPassword = exportSettings.is_enabled
    ? await getExportKeyForClient()
    : null;

  let wb: any;
  try {
    const openOpts: Record<string, unknown> = {};
    if (exportPassword) openOpts.password = exportPassword;
    wb = await XlsxPopulate.fromDataAsync(buffer, openOpts);
  } catch {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_password",
      notes: "File could not be opened.",
    });
    return {
      success: false,
      message:
        "This export file is invalid or was not generated using the current System Export Password.",
    };
  }

  // ── Step 2: Validate _System ─────────────────────────────────────────────
  const sysSheet = wb.sheet("_System");
  if (!sysSheet) {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_file",
    });
    return {
      success: false,
      message:
        "Invalid file: missing system metadata. This file was not generated by the NMCI system.",
    };
  }

  const sysData = readSysSheet(sysSheet);
  const readSys = (key: string) => sysData.get(key) ?? "";

  if (readSys("SYSTEM") !== "NMCI-EVENT-TRACKING") {
    await logExportAudit({
      action: "import_rejected",
      user_id: userId,
      username,
      import_status: "invalid_file",
    });
    return {
      success: false,
      message:
        "Invalid file: this file was not generated by the NMCI Event Tracking system.",
    };
  }

  if (readSys("EXPORT_TYPE") === "ALL_EVENTS") {
    return {
      success: false,
      message:
        "This file is an all-events export and cannot be imported. Please export a single event.",
    };
  }

  // Fingerprint check
  const fileFingerprint = readSys("EXPORT_FINGERPRINT");
  if (fileFingerprint && exportSettings.export_fingerprint) {
    if (fileFingerprint !== exportSettings.export_fingerprint) {
      await logExportAudit({
        action: "import_rejected",
        user_id: userId,
        username,
        import_status: "invalid_password",
      });
      return {
        success: false,
        message:
          "This export file is invalid or was not generated using the current System Export Password.",
      };
    }
  }

  const eventName = readSys("EVENT_NAME");
  const eventDate = readSys("EVENT_DATE");
  const deptName = readSys("DEPARTMENT_NAME");
  const deptCode = readSys("DEPARTMENT_CODE");

  // ── Step 3: Duplicate detection ──────────────────────────────────────────
  let isDuplicate = false;
  let duplicateEventId: number | null = null;

  if (eventName && eventDate) {
    const [dupRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM events WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND DATE(date) = ? LIMIT 1`,
      [eventName, eventDate],
    );
    if (dupRows.length > 0) {
      isDuplicate = true;
      duplicateEventId = dupRows[0].id as number;
    }
  }

  if (isDuplicate) {
    if (duplicateAction === "check") {
      return {
        success: false,
        isDuplicate: true,
        duplicateEventId,
        eventName,
        message: "Duplicate event detected. Please choose an action.",
      };
    }
    if (duplicateAction === "skip") {
      return {
        success: true,
        skipped: true,
        isDuplicate: true,
        duplicateEventId,
        eventName,
        message: "Import skipped — event already exists in the system.",
      };
    }
    if (duplicateAction === "replace") {
      await pool.execute(`DELETE FROM events WHERE id = ?`, [duplicateEventId]);
    }
    // 'copy' → fall through; event name will be modified below
  }

  // ── Step 4: Read Event Info sheet ────────────────────────────────────────
  const infoSheet = wb.sheet("Event Info");
  const readInfo = (fieldName: string): string => {
    if (!infoSheet) return "";
    try {
      const usedRange = infoSheet.usedRange();
      if (!usedRange) return "";
      const lastRow = usedRange.endCell().rowNumber();
      for (let r = 2; r <= lastRow; r++) {
        const key = String(infoSheet.cell(r, 1).value() ?? "")
          .trim()
          .toLowerCase();
        if (key === fieldName.toLowerCase()) {
          return String(infoSheet.cell(r, 2).value() ?? "").trim();
        }
      }
    } catch { /* ignore */ }
    return "";
  };

  const importedEventName =
    duplicateAction === "copy" ? `${eventName} (Copy)` : eventName;
  const venue = readInfo("Venue") || "N/A";
  const status = readInfo("Status") || "Completed";
  const duration = readInfo("Duration") || "Whole Day";
  const fineAmountVal = Number(readInfo("Fine Per Absence (PHP)")) || 0;
  const isAllDepts = readInfo("All Departments") === "Yes" ? 1 : 0;

  const parseTimeField = (val: string): string | null => {
    const v = val.trim();
    return v && v !== "—" ? v : null;
  };

  const amTimeIn = parseTimeField(readInfo("AM Time In"));
  const amTimeOut = parseTimeField(readInfo("AM Time Out"));
  const pmTimeIn = parseTimeField(readInfo("PM Time In"));
  const pmTimeOut = parseTimeField(readInfo("PM Time Out"));
  const audienceNotes = parseTimeField(readInfo("Description"));

  // ── Step 5: Get active academic period ───────────────────────────────────
  const [periodRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM academic_periods WHERE is_active = 1 LIMIT 1`,
  );
  const academicPeriodId =
    periodRows.length > 0 ? (periodRows[0].id as number) : null;

  // ── Step 6: Create event ─────────────────────────────────────────────────
  let newEventId: number;
  try {
    const [evResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO events
         (name, date, venue, status, duration, fine_amount, is_all_departments,
          am_time_in, am_time_out, pm_time_in, pm_time_out,
          created_by, academic_period_id, audience_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        importedEventName,
        eventDate,
        venue,
        status,
        duration,
        fineAmountVal,
        isAllDepts,
        amTimeIn,
        amTimeOut,
        pmTimeIn,
        pmTimeOut,
        userId,
        academicPeriodId,
        audienceNotes,
      ],
    );
    newEventId = evResult.insertId;
  } catch (err) {
    return {
      success: false,
      message: `Failed to create event: ${String(err)}`,
    };
  }

  // ── Step 7: Create event_audience ────────────────────────────────────────
  const deptNameToSearch =
    deptName || readInfo("Department") || readInfo("Department Name") || "";
  const deptCodeToSearch =
    deptCode || readInfo("Department Code") || "";

  let deptId: number | null = null;
  if (deptNameToSearch && deptNameToSearch !== "—") {
    const [deptRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM departments WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
      [deptNameToSearch],
    );
    if (deptRows.length > 0) {
      deptId = deptRows[0].id as number;
    } else if (deptCodeToSearch && deptCodeToSearch !== "—") {
      const [deptByCode] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM departments WHERE LOWER(TRIM(code)) = LOWER(TRIM(?)) LIMIT 1`,
        [deptCodeToSearch],
      );
      if (deptByCode.length > 0) deptId = deptByCode[0].id as number;
    }
  }

  if (deptId != null) {
    try {
      await pool.execute(
        `INSERT INTO event_audiences (event_id, department_id) VALUES (?, ?)`,
        [newEventId, deptId],
      );
    } catch { /* ignore if audience already exists */ }
  }

  // ── Step 8: Import students and attendance ───────────────────────────────
  const attSheet = wb.sheet("Attendance");
  let studentsImported = 0;
  let studentsFound = 0;
  let attendanceCreated = 0;
  let attendanceSkipped = 0;
  let failedRecords = 0;
  const errors: string[] = [];

  if (attSheet) {
    try {
      const usedRange = attSheet.usedRange();
      if (usedRange) {
        const lastRow = usedRange.endCell().rowNumber();
        for (let ri = 2; ri <= lastRow; ri++) {
          const studentIdVal = String(
            attSheet.cell(ri, 1).value() ?? "",
          ).trim();
          const fullName = String(attSheet.cell(ri, 2).value() ?? "").trim();
          const yearLevelStr = String(
            attSheet.cell(ri, 6).value() ?? "",
          ).trim();
          const attendanceVal = String(
            attSheet.cell(ri, 7).value() ?? "",
          ).trim();
          const amIn =
            String(attSheet.cell(ri, 8).value() ?? "").trim() || null;
          const amOut =
            String(attSheet.cell(ri, 9).value() ?? "").trim() || null;
          const pmIn =
            String(attSheet.cell(ri, 10).value() ?? "").trim() || null;
          const pmOut =
            String(attSheet.cell(ri, 11).value() ?? "").trim() || null;

          if (!studentIdVal) continue;

          // Find or create student
          let studentPk: number;
          const [stRows] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM students WHERE student_id = ? LIMIT 1`,
            [studentIdVal],
          );

          if (stRows.length > 0) {
            studentPk = stRows[0].id as number;
            studentsFound++;
          } else {
            const nameParts = fullName.trim().split(/\s+/);
            const firstName = nameParts[0] || "";
            const lastName =
              nameParts.length > 1
                ? nameParts[nameParts.length - 1]
                : "";
            const middleName =
              nameParts.length > 2
                ? nameParts.slice(1, -1).join(" ")
                : "";
            const yearLevel = Number(yearLevelStr) || null;

            try {
              const [newSt] = await pool.execute<ResultSetHeader>(
                `INSERT INTO students (student_id, full_name, first_name, middle_name, last_name, year_level)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  studentIdVal,
                  fullName,
                  firstName,
                  middleName,
                  lastName,
                  yearLevel,
                ],
              );
              studentPk = newSt.insertId;
              studentsImported++;
            } catch (e) {
              failedRecords++;
              errors.push(
                `Could not create student ${studentIdVal} (${fullName}): ${String(e)}`,
              );
              continue;
            }
          }

          // Create attendance record (only for attended students with time data)
          const attended = attendanceVal === "Attended";
          if (attended && (amIn || amOut || pmIn || pmOut)) {
            try {
              await pool.execute<ResultSetHeader>(
                `INSERT IGNORE INTO attendance
                   (student_id, event_id, am_time_in, am_time_out, pm_time_in, pm_time_out)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [studentPk, newEventId, amIn, amOut, pmIn, pmOut],
              );
              attendanceCreated++;
            } catch {
              attendanceSkipped++;
            }
          } else {
            attendanceSkipped++;
          }
        }
      }
    } catch (err) {
      errors.push(`Error reading Attendance sheet: ${String(err)}`);
    }
  }

  // ── Step 9: Import fines and payments ────────────────────────────────────
  const paySheet = wb.sheet("Payments");
  let finesCreated = 0;
  let paymentsCreated = 0;

  if (paySheet) {
    try {
      const usedRange = paySheet.usedRange();
      if (usedRange) {
        const firstCellVal = String(
          paySheet.cell(2, 1).value() ?? "",
        ).trim();
        if (!firstCellVal.startsWith("No payment")) {
          const lastRow = usedRange.endCell().rowNumber();
          for (let ri = 2; ri <= lastRow; ri++) {
            const studentIdVal = String(
              paySheet.cell(ri, 1).value() ?? "",
            ).trim();
            const fineReason = String(
              paySheet.cell(ri, 3).value() ?? "",
            ).trim();
            const fineAmt = Number(paySheet.cell(ri, 4).value() ?? 0);
            const amtPaid = Number(paySheet.cell(ri, 5).value() ?? 0);
            const fineStatus =
              String(paySheet.cell(ri, 7).value() ?? "").trim() || "Unpaid";
            const receiptNo =
              String(paySheet.cell(ri, 8).value() ?? "").trim() || null;
            const paymentMethod =
              String(paySheet.cell(ri, 9).value() ?? "").trim() || null;
            const remarks =
              String(paySheet.cell(ri, 10).value() ?? "").trim() || null;
            const paidAtRaw = String(
              paySheet.cell(ri, 11).value() ?? "",
            ).trim();

            if (!studentIdVal || !fineReason) continue;

            const [stRows] = await pool.execute<RowDataPacket[]>(
              `SELECT id FROM students WHERE student_id = ? LIMIT 1`,
              [studentIdVal],
            );
            if (stRows.length === 0) continue;
            const studentPk = stRows[0].id as number;

            try {
              const [fineResult] = await pool.execute<ResultSetHeader>(
                `INSERT INTO fines (student_id, event_id, reason, amount, paid_amount, status)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  studentPk,
                  newEventId,
                  fineReason,
                  fineAmt,
                  amtPaid,
                  fineStatus,
                ],
              );
              const fineId = fineResult.insertId;
              finesCreated++;

              if (amtPaid > 0 && receiptNo) {
                const paidAt = paidAtRaw
                  ? new Date(paidAtRaw)
                  : null;
                const paidAtVal =
                  paidAt && !isNaN(paidAt.getTime()) ? paidAt : null;

                try {
                  await pool.execute(
                    `INSERT IGNORE INTO payments
                       (fine_id, amount_paid, receipt_no, payment_method, remarks, paid_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                      fineId,
                      amtPaid,
                      receiptNo,
                      paymentMethod,
                      remarks,
                      paidAtVal,
                    ],
                  );
                  paymentsCreated++;
                } catch { /* skip duplicate payment */ }
              }
            } catch (e) {
              errors.push(
                `Could not create fine for ${studentIdVal}: ${String(e)}`,
              );
            }
          }
        }
      }
    } catch (err) {
      errors.push(`Error reading Payments sheet: ${String(err)}`);
    }
  }

  // ── Audit log ────────────────────────────────────────────────────────────
  await logExportAudit({
    action: "import",
    event_id: newEventId,
    event_name: importedEventName,
    user_id: userId,
    username,
    import_status: "success",
    password_protected: !!exportPassword,
    notes: `Created event #${newEventId}. Students new: ${studentsImported}, found: ${studentsFound}. Attendance: ${attendanceCreated}. Fines: ${finesCreated}. Payments: ${paymentsCreated}. Failed: ${failedRecords}.`,
  });

  return {
    success: true,
    message: "Event imported successfully.",
    eventId: newEventId,
    eventName: importedEventName,
    department: deptName || null,
    eventCreated: true,
    studentsImported,
    studentsFound,
    attendanceCreated,
    attendanceSkipped,
    finesCreated,
    paymentsCreated,
    failedRecords,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  };
}
