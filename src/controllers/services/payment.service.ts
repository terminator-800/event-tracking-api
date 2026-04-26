import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";
import { Role } from "../../types/express";
import { clampMoney, computeFineStatus } from "../../utils/paymentStatus";

type SessionKind = "whole" | "am" | "pm";
const ADMIN_ROLES: Role[] = ["admin", "csg_president"];

interface PaymentStudentRow extends RowDataPacket {
  student_pk: number;
  student_id: string;
  student_name: string;
  course_code: string | null;
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
  if (value === 1) return "1st Year";
  if (value === 2) return "2nd Year";
  if (value === 3) return "3rd Year";
  return `${value}th Year`;
}

export class PaymentService {
  private async assertStudentAccess(
    publicStudentId: string,
    role: Role,
    departmentId: number | null,
    conn?: PoolConnection,
  ): Promise<number | null> {
    const executor = conn ?? pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT s.id AS student_pk, p.department_id AS department_id
      FROM students s
      INNER JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      INNER JOIN programs p ON p.id = en.program_id
      WHERE s.student_id = ?
      LIMIT 1
      `,
      [publicStudentId],
    );
    if (!rows[0]) return null;
    const studentPk = Number(rows[0].student_pk);
    if (!ADMIN_ROLES.includes(role)) {
      const dep = Number(rows[0].department_id);
      if (!departmentId || dep !== Number(departmentId)) return null;
    }
    return studentPk;
  }

  private async assertFineAccess(
    fineId: number,
    role: Role,
    departmentId: number | null,
    conn?: PoolConnection,
  ): Promise<{ fineId: number; studentId: number } | null> {
    const executor = conn ?? pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT f.id AS fine_id, f.student_id AS student_id, p.department_id AS department_id
      FROM fines f
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
    if (!ADMIN_ROLES.includes(role)) {
      const dep = Number(rows[0].department_id);
      if (!departmentId || dep !== Number(departmentId)) return null;
    }
    return { fineId: Number(rows[0].fine_id), studentId: Number(rows[0].student_id) };
  }

  private async getStudentTotals(studentPk: number, conn?: PoolConnection) {
    const executor = conn ?? pool;
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
      `,
      [studentPk],
    );
    const row = rows[0] ?? {};
    const totalFine = clampMoney(Number(row.total_fine) || 0);
    const paidAmount = clampMoney(Number(row.paid_amount) || 0);
    const waivedAmount = clampMoney(Number(row.waived_amount) || 0);
    const remaining = clampMoney(totalFine - paidAmount - waivedAmount);
    return { totalFine, paidAmount, waivedAmount, remaining };
  }

  async listPaymentStudents(role: Role, departmentId: number | null) {
    const params: (number | string)[] = [];
    const scopedClause = ADMIN_ROLES.includes(role) ? "" : "WHERE p.department_id = ?";
    if (!ADMIN_ROLES.includes(role)) params.push(Number(departmentId));

    const [studentRows] = await pool.execute<PaymentStudentRow[]>(
      `
      SELECT
        s.id AS student_pk,
        s.student_id AS student_id,
        CONCAT(s.last_name, ', ', s.first_name) AS student_name,
        p.course_code AS course_code,
        en.year_level AS year_level,
        (
          SELECT COUNT(DISTINCT ev.id)
          FROM events ev
          WHERE ev.status = 'Completed'
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
                  AND ea2.program_id = en.program_id
                  AND (ea2.year_level IS NULL OR ea2.year_level = en.year_level)
              )
            )
        ) AS total_events,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.amount ELSE 0 END), 0) AS total_fine,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.paid_amount ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL AND f.status = 'Waived' THEN GREATEST(f.amount - f.paid_amount, 0) ELSE 0 END), 0) AS waived_amount
      FROM students s
      INNER JOIN enrollments en ON en.id = (
        SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
      )
      INNER JOIN programs p ON p.id = en.program_id
      LEFT JOIN fines f ON f.student_id = s.id
      LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
      ${scopedClause}
      GROUP BY s.id, s.student_id, s.last_name, s.first_name, p.course_code, en.program_id, en.year_level
      HAVING total_fine > 0
      ORDER BY student_name ASC
      `,
      params.length ? params : undefined,
    );

    const studentPkList = studentRows.map((row) => Number(row.student_pk));
    const eventsByStudent = new Map<number, any[]>();
    if (studentPkList.length > 0) {
      const placeholders = studentPkList.map(() => "?").join(",");
      const [eventRows] = await pool.execute<PaymentEventRow[]>(
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
        studentPkList,
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
    }

    const students = studentRows.map((row) => ({
      studentId: String(row.student_id),
      studentName: String(row.student_name),
      course: row.course_code ? String(row.course_code) : "—",
      year: toYearLabel(row.year_level != null ? Number(row.year_level) : null),
      totalEvents: Math.max(0, Number(row.total_events) || 0),
      totalFine: clampMoney(Number(row.total_fine) || 0),
      paidAmount: clampMoney(Number(row.paid_amount) || 0),
      waivedAmount: clampMoney(Number(row.waived_amount) || 0),
      events: eventsByStudent.get(Number(row.student_pk)) ?? [],
    }));

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
      const studentPk = await this.assertStudentAccess(args.publicStudentId, args.role, args.departmentId, conn);
      if (!studentPk) {
        await conn.rollback();
        return { ok: false as const, status: 404, message: "Student not found or access denied." };
      }

      const totalsBefore = await this.getStudentTotals(studentPk, conn);
      if (amount > totalsBefore.remaining) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Amount cannot be greater than remaining balance." };
      }

      const [openFines] = await conn.execute<OpenFineRow[]>(
        `
        SELECT f.id, f.amount, f.paid_amount, f.status
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE f.student_id = ?
          AND f.status IN ('Unpaid', 'Partial')
          AND f.amount > f.paid_amount
          AND e.status = 'Completed'
        ORDER BY f.updated_at ASC, f.id ASC
        `,
        [studentPk],
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

      const totalsAfter = await this.getStudentTotals(studentPk, conn);
      await conn.commit();
      return {
        ok: true as const,
        receiptNo: receiptNoForResponse,
        amountPaid: amount,
        previousBalance: totalsBefore.remaining,
        newBalance: totalsAfter.remaining,
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
    fineId: number;
    amount: number;
  }) {
    const fineAmount = clampMoney(args.amount);
    const access = await this.assertFineAccess(args.fineId, args.role, args.departmentId);
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
    return { ok: true as const, fineId: access.fineId, amount: fineAmount };
  }

  async setStudentBalance(args: {
    role: Role;
    departmentId: number | null;
    publicStudentId: string;
    targetBalance: number;
  }) {
    const target = clampMoney(args.targetBalance);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const studentPk = await this.assertStudentAccess(args.publicStudentId, args.role, args.departmentId, conn);
      if (!studentPk) {
        await conn.rollback();
        return { ok: false as const, status: 404, message: "Student not found or access denied." };
      }

      const totalsBefore = await this.getStudentTotals(studentPk, conn);
      if (target < 0 || target > totalsBefore.totalFine) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Balance must be between 0 and Total Fine." };
      }

      // Keep waived fines untouched; editable cap for payable side only.
      const payableTotal = clampMoney(totalsBefore.totalFine - totalsBefore.waivedAmount);
      const clampedTarget = Math.min(target, payableTotal);
      let desiredPaid = clampMoney(payableTotal - clampedTarget);

      const [fineRows] = await conn.execute<BalanceFineRow[]>(
        `
        SELECT f.id, f.amount, f.paid_amount, f.status
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE f.student_id = ?
          AND e.status = 'Completed'
        ORDER BY f.id ASC
        `,
        [studentPk],
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

      const totalsAfter = await this.getStudentTotals(studentPk, conn);
      await conn.commit();
      return {
        ok: true as const,
        previousBalance: totalsBefore.remaining,
        newBalance: totalsAfter.remaining,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
