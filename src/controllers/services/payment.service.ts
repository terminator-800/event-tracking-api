import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";
import { SQL_STUDENT_FULL_NAME, SQL_STUDENT_YEAR_LEVEL } from "../../utils/studentDisplaySql";
import { Role } from "../../types/express";
import { clampMoney, computeFineStatus } from "../../utils/paymentStatus";

type SessionKind = "whole" | "am" | "pm";

function isPaymentAdminUnfiltered(role: Role): boolean {
  return role === "admin";
}

/** Governors + CSG president only see fines / events they created (same as Manage Event / Attendance). */
function paymentCreatorUserId(role: Role, userId: number | null | undefined): number | null {
  if (isPaymentAdminUnfiltered(role)) return null;
  const id = userId != null && Number.isFinite(Number(userId)) ? Number(userId) : null;
  return id;
}

interface PaymentStudentRow extends RowDataPacket {
  student_pk: number;
  student_id: string;
  student_name: string;
  course_code: string | null;
  major: string | null;
  year_level: number | null;
  total_events: string | number;
  total_fine: string | number;
  paid_amount: string | number;
  waived_amount: string | number;
}

interface PaymentEventRow extends RowDataPacket {
  fine_id: number;
  event_id: number;
  student_pk: number;
  event_name: string;
  event_date: string;
  duration: string;
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
  amount: string | number;
}

interface OpenFineRow extends RowDataPacket {
  id: number;
  amount: string | number;
  paid_amount: string | number;
  status: string;
}

interface BalanceFineRow extends RowDataPacket {
  id: number;
  amount: string | number;
  paid_amount: string | number;
  status: string;
}

function normalizeDurationToSessionKind(duration: string): SessionKind {
  const d = String(duration ?? "").trim().toLowerCase();
  if (d === "am only") return "am";
  if (d === "pm only") return "pm";
  return "whole";
}

function toYearLabel(value: number | null): string {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "—";
}

export class PaymentService {
  private async assertStudentAccess(
    publicStudentId: string,
    role: Role,
    departmentId: number | null,
    userId: number | null,
    conn?: PoolConnection,
  ): Promise<number | null> {
    const executor = conn ?? pool;
    const creatorId = paymentCreatorUserId(role, userId);

    if (isPaymentAdminUnfiltered(role)) {
      const [rows] = await executor.execute<RowDataPacket[]>(
        `
        SELECT s.id AS student_pk
        FROM students s
        WHERE s.student_id = ?
        LIMIT 1
        `,
        [publicStudentId],
      );
      return rows[0] ? Number((rows[0] as { student_pk: number }).student_pk) : null;
    }

    if (creatorId == null) return null;

    if (role === "csg_president") {
      const [rows] = await executor.execute<RowDataPacket[]>(
        `
        SELECT s.id AS student_pk
        FROM students s
        WHERE s.student_id = ?
          AND EXISTS (
            SELECT 1 FROM fines f
            INNER JOIN events e ON e.id = f.event_id AND e.status = 'Completed'
            WHERE f.student_id = s.id AND e.created_by = ?
          )
        LIMIT 1
        `,
        [publicStudentId, creatorId],
      );
      return rows[0] ? Number((rows[0] as { student_pk: number }).student_pk) : null;
    }

    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT s.id AS student_pk, p.department_id AS department_id
      FROM students s
      INNER JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      INNER JOIN programs p ON p.id = en.program_id
      WHERE s.student_id = ?
        AND p.department_id = ?
        AND EXISTS (
          SELECT 1 FROM fines f
          INNER JOIN events e ON e.id = f.event_id AND e.status = 'Completed'
          WHERE f.student_id = s.id AND e.created_by = ?
        )
      LIMIT 1
      `,
      [publicStudentId, Number(departmentId), creatorId],
    );
    if (!rows[0]) return null;
    const dep = Number((rows[0] as { department_id: number }).department_id);
    if (!departmentId || dep !== Number(departmentId)) return null;
    return Number((rows[0] as { student_pk: number }).student_pk);
  }

  private async assertFineAccess(
    fineId: number,
    role: Role,
    departmentId: number | null,
    userId: number | null,
    conn?: PoolConnection,
  ): Promise<{ fineId: number; studentPk: number; publicStudentId: string } | null> {
    const executor = conn ?? pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT f.id AS fine_id, f.student_id AS student_pk, s.student_id AS public_student_id,
             p.department_id AS department_id, ev.created_by AS event_created_by
      FROM fines f
      INNER JOIN events ev ON ev.id = f.event_id
      INNER JOIN students s ON s.id = f.student_id
      INNER JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      INNER JOIN programs p ON p.id = en.program_id
      WHERE f.id = ?
      LIMIT 1
      `,
      [fineId],
    );
    if (!rows[0]) return null;
    const creatorId = paymentCreatorUserId(role, userId);
    if (creatorId != null) {
      const evCreator = Number((rows[0] as { event_created_by: number }).event_created_by);
      if (!Number.isFinite(evCreator) || evCreator !== creatorId) return null;
    }
    const publicStudentId = String((rows[0] as { public_student_id: string }).public_student_id ?? "").trim();
    if (!publicStudentId) return null;
    const payload = {
      fineId: Number(rows[0].fine_id),
      studentPk: Number((rows[0] as { student_pk: number }).student_pk),
      publicStudentId,
    };
    if (role === "csg_president" || isPaymentAdminUnfiltered(role)) {
      return payload;
    }
    const dep = Number(rows[0].department_id);
    if (!departmentId || dep !== Number(departmentId)) return null;
    return payload;
  }

  private async getStudentTotals(studentPk: number, creatorUserId: number | null, conn?: PoolConnection) {
    const executor = conn ?? pool;
    const creatorSql =
      creatorUserId != null ? " AND e.created_by = ? " : "";
    const params =
      creatorUserId != null ? [studentPk, creatorUserId] : [studentPk];
    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT
        COALESCE(SUM(f.amount), 0) AS total_fine,
        COALESCE(SUM(f.paid_amount), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN f.status = 'Waived' THEN GREATEST(f.amount - f.paid_amount, 0) ELSE 0 END), 0) AS waived_amount
      FROM fines f
      INNER JOIN events e ON e.id = f.event_id
      WHERE f.student_id = ?
        AND e.status = 'Completed'
        ${creatorSql}
      `,
      params,
    );
    const row = rows[0] ?? {};
    const totalFine = clampMoney(Number(row.total_fine) || 0);
    const paidAmount = clampMoney(Number(row.paid_amount) || 0);
    const waivedAmount = clampMoney(Number(row.waived_amount) || 0);
    const remaining = clampMoney(totalFine - paidAmount - waivedAmount);
    return { totalFine, paidAmount, waivedAmount, remaining };
  }

  private formatPaymentStudentDto(row: PaymentStudentRow, events: any[]) {
    return {
      studentId: String(row.student_id),
      studentName: String(row.student_name),
      course: row.course_code ? String(row.course_code) : "—",
      major:
        row.major != null && String(row.major).trim() !== ""
          ? String(row.major).trim()
          : null,
      year: toYearLabel(row.year_level != null ? Number(row.year_level) : null),
      totalEvents: Math.max(0, Number(row.total_events) || 0),
      totalFine: clampMoney(Number(row.total_fine) || 0),
      paidAmount: clampMoney(Number(row.paid_amount) || 0),
      waivedAmount: clampMoney(Number(row.waived_amount) || 0),
      events,
    };
  }

  private async loadEventsByStudentPks(
    studentPkList: number[],
    role: Role,
    departmentId: number | null,
    creatorId: number | null,
    executor: typeof pool | PoolConnection = pool,
  ): Promise<Map<number, any[]>> {
    const eventsByStudent = new Map<number, any[]>();
    if (studentPkList.length === 0) return eventsByStudent;

    const needsDeptScope = !isPaymentAdminUnfiltered(role) && role !== "csg_president";
    const placeholders = studentPkList.map(() => "?").join(",");
    const eventCreatorSql = creatorId != null ? " AND e.created_by = ? " : "";
    const eventParams = [...studentPkList];
    if (creatorId != null) eventParams.push(creatorId);

    const [eventRows] = await executor.execute<PaymentEventRow[]>(
      `
      SELECT
        MIN(f.id) AS fine_id,
        e.id AS event_id,
        f.student_id AS student_pk,
        e.name AS event_name,
        DATE_FORMAT(e.date, '%Y-%m-%d') AS event_date,
        e.duration AS duration,
        a.am_time_in,
        a.am_time_out,
        a.pm_time_in,
        a.pm_time_out,
        COALESCE(SUM(GREATEST(f.amount - f.paid_amount, 0)), 0) AS amount
      FROM fines f
      INNER JOIN events e ON e.id = f.event_id AND e.status = 'Completed'
      LEFT JOIN attendance a ON a.event_id = e.id AND a.student_id = f.student_id
      WHERE f.student_id IN (${placeholders})
        ${eventCreatorSql}
      GROUP BY
        e.id,
        f.student_id,
        e.name,
        e.date,
        e.duration,
        a.am_time_in,
        a.am_time_out,
        a.pm_time_in,
        a.pm_time_out
      ORDER BY e.date DESC, e.id DESC
      `,
      eventParams,
    );
    for (const row of eventRows) {
      const studentPk = Number(row.student_pk);
      const existing = eventsByStudent.get(studentPk) ?? [];
      existing.push({
        id: `E-${row.event_id}`,
        fineId: Number(row.fine_id),
        name: String(row.event_name ?? "Untitled Event"),
        date: String(row.event_date ?? ""),
        sessionKind: normalizeDurationToSessionKind(String(row.duration ?? "")),
        amIn: row.am_time_in ?? null,
        amOut: row.am_time_out ?? null,
        pmIn: row.pm_time_in ?? null,
        pmOut: row.pm_time_out ?? null,
        fine: clampMoney(Number(row.amount) || 0),
      });
      eventsByStudent.set(studentPk, existing);
    }

    const eCreatorWhere = creatorId != null ? " AND e.created_by = ? " : "";
    const zeroFineParams: (number | string)[] = [...studentPkList];
    if (needsDeptScope) zeroFineParams.push(Number(departmentId));
    if (creatorId != null) zeroFineParams.push(creatorId);
    const deptAndZero = needsDeptScope ? " AND p.department_id = ? " : "";

    const [zeroFineRows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT
        s.id AS student_pk,
        e.id AS event_id,
        e.name AS event_name,
        DATE_FORMAT(e.date, '%Y-%m-%d') AS event_date,
        e.duration AS duration,
        MAX(a.am_time_in) AS am_time_in,
        MAX(a.am_time_out) AS am_time_out,
        MAX(a.pm_time_in) AS pm_time_in,
        MAX(a.pm_time_out) AS pm_time_out
      FROM students s
      INNER JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      INNER JOIN programs p ON p.id = en.program_id
      INNER JOIN events e ON e.status = 'Completed'
      LEFT JOIN attendance a ON a.event_id = e.id AND a.student_id = s.id
      WHERE s.id IN (${placeholders})
        ${deptAndZero}
        ${eCreatorWhere}
        AND NOT EXISTS (
          SELECT 1 FROM fines f
          WHERE f.student_id = s.id AND f.event_id = e.id
        )
        AND (
          (
            e.is_all_departments = 1
            AND (
              NOT EXISTS (
                SELECT 1 FROM event_audiences ea0
                WHERE ea0.event_id = e.id AND ea0.year_level IS NOT NULL
              )
              OR EXISTS (
                SELECT 1 FROM event_audiences ea1
                WHERE ea1.event_id = e.id
                  AND (ea1.year_level IS NULL OR ea1.year_level = en.year_level)
              )
            )
          )
          OR EXISTS (
            SELECT 1 FROM event_audiences ea2
            WHERE ea2.event_id = e.id
              AND (ea2.department_id IS NULL OR ea2.department_id = p.department_id)
              AND (ea2.program_id IS NULL OR ea2.program_id = en.program_id)
              AND (ea2.year_level IS NULL OR ea2.year_level = en.year_level)
          )
        )
      GROUP BY s.id, e.id, e.name, e.date, e.duration
      ORDER BY e.date DESC, e.id DESC
      `,
      zeroFineParams,
    );

    for (const row of zeroFineRows) {
      const studentPk = Number(row.student_pk);
      const existing = eventsByStudent.get(studentPk) ?? [];
      existing.push({
        id: `E-${row.event_id}`,
        fineId: null,
        name: String(row.event_name ?? "Untitled Event"),
        date: String(row.event_date ?? ""),
        sessionKind: normalizeDurationToSessionKind(String(row.duration ?? "")),
        amIn: row.am_time_in ?? null,
        amOut: row.am_time_out ?? null,
        pmIn: row.pm_time_in ?? null,
        pmOut: row.pm_time_out ?? null,
        fine: 0,
      });
      eventsByStudent.set(studentPk, existing);
    }

    for (const arr of eventsByStudent.values()) {
      arr.sort((a, b) => {
        const db = String(b.date ?? "");
        const da = String(a.date ?? "");
        if (db !== da) return db.localeCompare(da);
        return String(b.id ?? "").localeCompare(String(a.id ?? ""));
      });
    }

    return eventsByStudent;
  }

  async getPaymentStudentByPublicId(
    role: Role,
    departmentId: number | null,
    userId: number | null,
    publicStudentId: string,
  ) {
    const studentPk = await this.assertStudentAccess(publicStudentId, role, departmentId, userId);
    if (!studentPk) return null;

    const creatorId = paymentCreatorUserId(role, userId);
    const needsDeptScope = !isPaymentAdminUnfiltered(role) && role !== "csg_president";
    const feCreatorSql = creatorId != null ? " AND fe.created_by = ? " : "";
    const evCreatorSql = creatorId != null ? " AND ev.created_by = ? " : "";
    const params: (number | string)[] = [];
    if (creatorId != null) {
      params.push(creatorId);
      params.push(creatorId);
    }
    params.push(studentPk);
    if (needsDeptScope) params.push(Number(departmentId));

    const [studentRows] = await pool.execute<PaymentStudentRow[]>(
      `
      SELECT
        s.id AS student_pk,
        s.student_id AS student_id,
        ${SQL_STUDENT_FULL_NAME} AS student_name,
        p.course_code AS course_code,
        p.major AS major,
        ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
        (
          SELECT COUNT(DISTINCT ev.id)
          FROM events ev
          WHERE ev.status = 'Completed'
            ${evCreatorSql}
            AND (
              (
                ev.is_all_departments = 1
                AND (
                  NOT EXISTS (
                    SELECT 1
                    FROM event_audiences ea0
                    WHERE ea0.event_id = ev.id
                      AND ea0.year_level IS NOT NULL
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM event_audiences ea1
                    WHERE ea1.event_id = ev.id
                      AND (ea1.year_level IS NULL OR ea1.year_level = en.year_level)
                  )
                )
              )
              OR EXISTS (
                SELECT 1
                FROM event_audiences ea2
                WHERE ea2.event_id = ev.id
                  AND (ea2.department_id IS NULL OR ea2.department_id = p.department_id)
                  AND (ea2.program_id IS NULL OR ea2.program_id = en.program_id)
                  AND (ea2.year_level IS NULL OR ea2.year_level = en.year_level)
              )
            )
        ) AS total_events,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.amount ELSE 0 END), 0) AS total_fine,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.paid_amount ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL AND f.status = 'Waived' THEN GREATEST(f.amount - f.paid_amount, 0) ELSE 0 END), 0) AS waived_amount
      FROM students s
      LEFT JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      LEFT JOIN programs p ON p.id = en.program_id
      LEFT JOIN fines f ON f.student_id = s.id
      LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
        ${feCreatorSql}
      WHERE s.id = ?
        ${needsDeptScope ? " AND p.department_id = ? " : ""}
      GROUP BY s.id, s.student_id, s.full_name, s.first_name, s.middle_name, s.last_name, s.year_level, p.course_code, p.major, en.program_id, en.year_level
      LIMIT 1
      `,
      params,
    );

    const row = studentRows[0];
    if (!row) return null;

    const eventsByStudent = await this.loadEventsByStudentPks(
      [studentPk],
      role,
      departmentId,
      creatorId,
    );
    return this.formatPaymentStudentDto(row, eventsByStudent.get(studentPk) ?? []);
  }

  async listPaymentStudents(role: Role, departmentId: number | null, userId: number | null) {
    const params: (number | string)[] = [];
    const isAdmin = isPaymentAdminUnfiltered(role);
    const creatorId = paymentCreatorUserId(role, userId);
    const needsDeptScope = !isAdmin && role !== "csg_president";
    const scopedClause = needsDeptScope ? "WHERE p.department_id = ?" : "";

    const feCreatorSql = creatorId != null ? " AND fe.created_by = ? " : "";
    const evCreatorSql = creatorId != null ? " AND ev.created_by = ? " : "";

    if (creatorId != null) {
      params.push(creatorId);
      params.push(creatorId);
    }
    if (needsDeptScope) params.push(Number(departmentId));

    const [studentRows] = await pool.execute<PaymentStudentRow[]>(
      `
      SELECT
        s.id AS student_pk,
        s.student_id AS student_id,
        ${SQL_STUDENT_FULL_NAME} AS student_name,
        p.course_code AS course_code,
        p.major AS major,
        ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
        (
          SELECT COUNT(DISTINCT ev.id)
          FROM events ev
          WHERE ev.status = 'Completed'
            ${evCreatorSql}
            AND (
              (
                ev.is_all_departments = 1
                AND (
                  NOT EXISTS (
                    SELECT 1
                    FROM event_audiences ea0
                    WHERE ea0.event_id = ev.id
                      AND ea0.year_level IS NOT NULL
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM event_audiences ea1
                    WHERE ea1.event_id = ev.id
                      AND (ea1.year_level IS NULL OR ea1.year_level = en.year_level)
                  )
                )
              )
              OR EXISTS (
                SELECT 1
                FROM event_audiences ea2
                WHERE ea2.event_id = ev.id
                  AND (ea2.department_id IS NULL OR ea2.department_id = p.department_id)
                  AND (ea2.program_id IS NULL OR ea2.program_id = en.program_id)
                  AND (ea2.year_level IS NULL OR ea2.year_level = en.year_level)
              )
            )
        ) AS total_events,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.amount ELSE 0 END), 0) AS total_fine,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.paid_amount ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL AND f.status = 'Waived' THEN GREATEST(f.amount - f.paid_amount, 0) ELSE 0 END), 0) AS waived_amount
      FROM students s
      LEFT JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      LEFT JOIN programs p ON p.id = en.program_id
      LEFT JOIN fines f ON f.student_id = s.id
      LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
        ${feCreatorSql}
      ${scopedClause}
      GROUP BY s.id, s.student_id, s.full_name, s.first_name, s.middle_name, s.last_name, s.year_level, p.course_code, p.major, en.program_id, en.year_level
      ORDER BY student_name ASC
      `,
      params.length ? params : undefined,
    );

    const students = studentRows.map((row) => this.formatPaymentStudentDto(row, []));

    return { students };
  }

  async recordPayment(args: {
    encodedByUserId: number;
    role: Role;
    departmentId: number | null;
    publicStudentId: string;
    amountPaid: number;
    paymentMethod?: "Cash" | "GCash" | "Bank Transfer" | "Other";
    remarks?: string;
  }) {
    const amount = clampMoney(args.amountPaid);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false as const, status: 400, message: "Amount paid must be greater than zero." };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const creatorForTotals = paymentCreatorUserId(args.role, args.encodedByUserId);
      const studentPk = await this.assertStudentAccess(
        args.publicStudentId,
        args.role,
        args.departmentId,
        args.encodedByUserId,
        conn,
      );
      if (!studentPk) {
        await conn.rollback();
        return { ok: false as const, status: 404, message: "Student not found or access denied." };
      }

      const totalsBefore = await this.getStudentTotals(studentPk, creatorForTotals, conn);
      if (amount > totalsBefore.remaining) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Amount cannot be greater than remaining balance." };
      }

      const openFineCreatorSql =
        creatorForTotals != null ? " AND e.created_by = ? " : "";
      const openFineParams =
        creatorForTotals != null ? [studentPk, creatorForTotals] : [studentPk];
      const [openFines] = await conn.execute<OpenFineRow[]>(
        `
        SELECT f.id, f.amount, f.paid_amount, f.status
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE f.student_id = ?
          AND f.status IN ('Unpaid', 'Partial')
          AND f.amount > f.paid_amount
          AND e.status = 'Completed'
          ${openFineCreatorSql}
        ORDER BY f.updated_at ASC, f.id ASC
        `,
        openFineParams,
      );

      let remainingToApply = amount;
      const now = new Date();
      const receiptBase = `RCP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}${String(now.getMilliseconds()).padStart(3, "0")}`;
      let receiptNoForResponse = receiptBase;
      let insertSequence = 0;

      for (const fine of openFines) {
        if (remainingToApply <= 0) break;
        const fineAmount = clampMoney(Number(fine.amount) || 0);
        const finePaid = clampMoney(Number(fine.paid_amount) || 0);
        const fineRemaining = clampMoney(fineAmount - finePaid);
        if (fineRemaining <= 0) continue;

        const applied = clampMoney(Math.min(remainingToApply, fineRemaining));
        const nextPaid = clampMoney(finePaid + applied);
        const nextStatus = computeFineStatus(fineAmount, nextPaid, fine.status);

        await conn.execute<ResultSetHeader>(
          `UPDATE fines SET paid_amount = ?, status = ? WHERE id = ?`,
          [nextPaid, nextStatus, fine.id],
        );
        const receiptNo = `${receiptBase}-${String(insertSequence).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6)}`;
        await conn.execute<ResultSetHeader>(
          `INSERT INTO payments (student_id, fine_id, amount_paid, receipt_no, payment_method, remarks, paid_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            studentPk,
            Number(fine.id),
            applied,
            receiptNo,
            args.paymentMethod ?? "Cash",
            args.remarks ?? null,
            args.encodedByUserId,
          ],
        );
        if (insertSequence === 0) {
          receiptNoForResponse = receiptNo;
        }
        insertSequence += 1;
        remainingToApply = clampMoney(remainingToApply - applied);
      }

      if (remainingToApply > 0) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Unable to allocate payment across open fines." };
      }

      const totalsAfter = await this.getStudentTotals(studentPk, creatorForTotals, conn);
      await conn.commit();

      const student = await this.getPaymentStudentByPublicId(
        args.role,
        args.departmentId,
        args.encodedByUserId,
        args.publicStudentId,
      );

      return {
        ok: true as const,
        receiptNo: receiptNoForResponse,
        amountPaid: amount,
        previousBalance: totalsBefore.remaining,
        newBalance: totalsAfter.remaining,
        paidAmount: totalsAfter.paidAmount,
        totalFine: totalsAfter.totalFine,
        waivedAmount: totalsAfter.waivedAmount,
        student,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async updateFineAmount(args: {
    role: Role;
    departmentId: number | null;
    userId: number;
    fineId: number;
    amount: number;
  }) {
    const fineAmount = clampMoney(args.amount);
    const access = await this.assertFineAccess(
      args.fineId,
      args.role,
      args.departmentId,
      args.userId,
    );
    if (!access) {
      return { ok: false as const, status: 404, message: "Fine not found or access denied." };
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT amount, paid_amount, status FROM fines WHERE id = ? LIMIT 1`,
      [access.fineId],
    );
    if (!rows[0]) return { ok: false as const, status: 404, message: "Fine not found." };

    const paidAmount = clampMoney(Math.min(Number(rows[0].paid_amount) || 0, fineAmount));
    const nextStatus = computeFineStatus(fineAmount, paidAmount, String(rows[0].status ?? ""));
    await pool.execute<ResultSetHeader>(
      `UPDATE fines SET amount = ?, paid_amount = ?, status = ? WHERE id = ?`,
      [fineAmount, paidAmount, nextStatus, access.fineId],
    );

    const student = await this.getPaymentStudentByPublicId(
      args.role,
      args.departmentId,
      args.userId,
      access.publicStudentId,
    );

    return { ok: true as const, fineId: access.fineId, amount: fineAmount, student };
  }

  async setStudentBalance(args: {
    role: Role;
    departmentId: number | null;
    userId: number;
    publicStudentId: string;
    targetBalance: number;
  }) {
    const target = clampMoney(args.targetBalance);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const creatorForTotals = paymentCreatorUserId(args.role, args.userId);
      const studentPk = await this.assertStudentAccess(
        args.publicStudentId,
        args.role,
        args.departmentId,
        args.userId,
        conn,
      );
      if (!studentPk) {
        await conn.rollback();
        return { ok: false as const, status: 404, message: "Student not found or access denied." };
      }

      const totalsBefore = await this.getStudentTotals(studentPk, creatorForTotals, conn);
      if (target < 0 || target > totalsBefore.totalFine) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Balance must be between 0 and Total Fine." };
      }

      // Keep waived fines untouched; editable cap for payable side only.
      const payableTotal = clampMoney(totalsBefore.totalFine - totalsBefore.waivedAmount);
      const clampedTarget = Math.min(target, payableTotal);
      let desiredPaid = clampMoney(payableTotal - clampedTarget);

      const balanceFineCreatorSql =
        creatorForTotals != null ? " AND e.created_by = ? " : "";
      const balanceFineParams =
        creatorForTotals != null ? [studentPk, creatorForTotals] : [studentPk];
      const [fineRows] = await conn.execute<BalanceFineRow[]>(
        `
        SELECT f.id, f.amount, f.paid_amount, f.status
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE f.student_id = ?
          AND e.status = 'Completed'
          ${balanceFineCreatorSql}
        ORDER BY f.id ASC
        `,
        balanceFineParams,
      );

      for (const fine of fineRows) {
        const amount = clampMoney(Number(fine.amount) || 0);
        const isWaived = String(fine.status ?? "") === "Waived";
        if (isWaived) continue;

        const nextPaid = clampMoney(Math.min(desiredPaid, amount));
        const nextStatus = computeFineStatus(amount, nextPaid, fine.status);
        await conn.execute<ResultSetHeader>(
          `UPDATE fines SET paid_amount = ?, status = ? WHERE id = ?`,
          [nextPaid, nextStatus, Number(fine.id)],
        );
        desiredPaid = clampMoney(desiredPaid - nextPaid);
      }

      if (desiredPaid > 0) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Unable to apply requested balance change." };
      }

      const totalsAfter = await this.getStudentTotals(studentPk, creatorForTotals, conn);
      await conn.commit();

      const student = await this.getPaymentStudentByPublicId(
        args.role,
        args.departmentId,
        args.userId,
        args.publicStudentId,
      );

      return {
        ok: true as const,
        previousBalance: totalsBefore.remaining,
        newBalance: totalsAfter.remaining,
        paidAmount: totalsAfter.paidAmount,
        totalFine: totalsAfter.totalFine,
        waivedAmount: totalsAfter.waivedAmount,
        student,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
