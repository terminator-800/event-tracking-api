import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";
import { SQL_STUDENT_FULL_NAME, SQL_STUDENT_YEAR_LEVEL, SQL_STUDENT_DEPARTMENT_NAME, resolveStudentDepartmentName } from "../../utils/studentDisplaySql";
import {
  SQL_LATEST_PROGRAM_LEFT_JOIN,
  sqlLatestEnrollmentLeftJoin,
} from "../../utils/studentEligibilitySql";
import { Role } from "../../types/express";
import { clampMoney, computeFineStatus } from "../../utils/paymentStatus";
import { getActiveAcademicPeriod } from "../../repositories/academic-periods.repository";

const SQL_USER_ENCODED_BY_NAME = `COALESCE(NULLIF(TRIM(u.full_name), ''), u.username)`;

type SessionKind = "whole" | "am" | "pm";

/** Admins / Super Admin always see institution-wide payment data. */
function isPaymentAdminRole(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

function isDeptCashier(role: Role, departmentId: number | null | undefined): boolean {
  if (role === "dept_cashier") return true;
  return role === "cashier" && departmentId != null && Number.isFinite(Number(departmentId));
}

/** CSG Cashier = institution CSG desk (no college department). */
function isCsgCashier(role: Role, departmentId: number | null | undefined): boolean {
  if (role === "csg_cashier") return true;
  return role === "cashier" && !isDeptCashier(role, departmentId);
}

function isAnyCashierRole(role: Role): boolean {
  return role === "cashier" || role === "csg_cashier" || role === "dept_cashier";
}

type PaymentScope = {
  needsDeptScope: boolean;
  /** Governor: only events they created. */
  creatorUserId: number | null;
  /**
   * CSG President + CSG Cashier share one payment view:
   * only fines/events created by users with role csg_president.
   */
  csgPresidentEventsOnly: boolean;
};

function resolvePaymentScope(
  role: Role,
  departmentId: number | null | undefined,
  userId: number | null | undefined,
): PaymentScope {
  if (isPaymentAdminRole(role)) {
    return { needsDeptScope: false, creatorUserId: null, csgPresidentEventsOnly: false };
  }
  // Same payment view for CSG President and CSG Cashier
  if (role === "csg_president" || isCsgCashier(role, departmentId)) {
    return { needsDeptScope: false, creatorUserId: null, csgPresidentEventsOnly: true };
  }
  // Dept Cashier: college filter only
  if (isDeptCashier(role, departmentId)) {
    return { needsDeptScope: true, creatorUserId: null, csgPresidentEventsOnly: false };
  }
  // Governors: own events + department
  const id = userId != null && Number.isFinite(Number(userId)) ? Number(userId) : null;
  return { needsDeptScope: true, creatorUserId: id, csgPresidentEventsOnly: false };
}

/** `AND alias.created_by …` for event joins (aliases: e, fe, ev). */
function eventCreatorFilterSql(alias: string, scope: PaymentScope): string {
  if (scope.csgPresidentEventsOnly) {
    return ` AND ${alias}.created_by IN (SELECT cu.id FROM users cu WHERE cu.role = 'csg_president') `;
  }
  if (scope.creatorUserId != null) {
    return ` AND ${alias}.created_by = ? `;
  }
  return "";
}

function pushEventCreatorParams(params: Array<number | string>, scope: PaymentScope): void {
  if (!scope.csgPresidentEventsOnly && scope.creatorUserId != null) {
    params.push(scope.creatorUserId);
  }
}

async function resolveActivePeriodId(): Promise<number | null> {
  const active = await getActiveAcademicPeriod();
  return active?.id ?? null;
}

interface PaymentStudentRow extends RowDataPacket {
  student_pk: number;
  student_id: string;
  student_name: string;
  course_code: string | null;
  major: string | null;
  department_name: string | null;
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
    const scope = resolvePaymentScope(role, departmentId, userId);

    // Admins, CSG President, and CSG Cashier may look up any student (fines still scoped).
    if (isPaymentAdminRole(role) || role === "csg_president" || isCsgCashier(role, departmentId)) {
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

    // Dept Cashier + Governors: student must be in their department
    if (scope.needsDeptScope) {
      if (departmentId == null || !Number.isFinite(Number(departmentId))) return null;
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
        LIMIT 1
        `,
        [publicStudentId, Number(departmentId)],
      );
      if (!rows[0]) return null;
      return Number((rows[0] as { student_pk: number }).student_pk);
    }

    return null;
  }

  private async assertFineAccess(
    fineId: number,
    role: Role,
    departmentId: number | null,
    userId: number | null,
    conn?: PoolConnection,
  ): Promise<{ fineId: number; studentPk: number; publicStudentId: string } | null> {
    const executor = conn ?? pool;
    const scope = resolvePaymentScope(role, departmentId, userId);
    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT f.id AS fine_id, f.student_id AS student_pk, s.student_id AS public_student_id,
             p.department_id AS department_id, ev.created_by AS event_created_by,
             cu.role AS creator_role
      FROM fines f
      INNER JOIN events ev ON ev.id = f.event_id
      LEFT JOIN users cu ON cu.id = ev.created_by
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

    const evCreator = Number((rows[0] as { event_created_by: number }).event_created_by);
    const creatorRole = String((rows[0] as { creator_role?: string }).creator_role ?? "")
      .trim()
      .toLowerCase();

    if (scope.csgPresidentEventsOnly) {
      if (creatorRole !== "csg_president") return null;
    } else if (scope.creatorUserId != null) {
      if (!Number.isFinite(evCreator) || evCreator !== scope.creatorUserId) return null;
    }

    const publicStudentId = String((rows[0] as { public_student_id: string }).public_student_id ?? "").trim();
    if (!publicStudentId) return null;
    const payload = {
      fineId: Number(rows[0].fine_id),
      studentPk: Number((rows[0] as { student_pk: number }).student_pk),
      publicStudentId,
    };

    if (isPaymentAdminRole(role) || role === "csg_president" || isCsgCashier(role, departmentId)) {
      return payload;
    }

    const dep = Number(rows[0].department_id);
    if (!departmentId || dep !== Number(departmentId)) return null;
    return payload;
  }

  private async getStudentTotals(
    studentPk: number,
    scope: PaymentScope,
    academicPeriodId: number | null,
    conn?: PoolConnection,
  ) {
    const executor = conn ?? pool;
    const creatorSql = eventCreatorFilterSql("e", scope);
    const periodSql =
      academicPeriodId != null
        ? " AND f.academic_period_id = ? AND e.academic_period_id = ? "
        : " AND 1=0 ";
    const params: (number | string)[] = [studentPk];
    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) {
      params.push(academicPeriodId);
      params.push(academicPeriodId);
    }
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
        ${periodSql}
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
      department: resolveStudentDepartmentName(row.department_name, row.course_code),
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
    scope: PaymentScope,
    academicPeriodId: number | null,
    executor: typeof pool | PoolConnection = pool,
  ): Promise<Map<number, any[]>> {
    const eventsByStudent = new Map<number, any[]>();
    if (studentPkList.length === 0) return eventsByStudent;

    const needsDeptScope = scope.needsDeptScope;
    const placeholders = studentPkList.map(() => "?").join(",");
    const eventCreatorSql = eventCreatorFilterSql("e", scope);
    const periodSql =
      academicPeriodId != null
        ? " AND f.academic_period_id = ? AND e.academic_period_id = ? "
        : " AND 1=0 ";
    const eventParams: (number | string)[] = [...studentPkList];
    pushEventCreatorParams(eventParams, scope);
    if (academicPeriodId != null) {
      eventParams.push(academicPeriodId);
      eventParams.push(academicPeriodId);
    }

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
        ${periodSql}
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

    const eCreatorWhere = eventCreatorFilterSql("e", scope);
    const zeroFineParams: (number | string)[] = [...studentPkList];
    if (needsDeptScope) zeroFineParams.push(Number(departmentId));
    pushEventCreatorParams(zeroFineParams, scope);
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

  private async resolvePublicStudentId(
    identifier: string,
    role: Role,
    departmentId: number | null,
    userId: number | null,
    conn?: PoolConnection,
  ): Promise<string | null> {
    const trimmed = String(identifier ?? "").trim();
    if (!trimmed) return null;
    const executor = conn ?? pool;

    const [rows] = await executor.execute<RowDataPacket[]>(
      `
      SELECT s.id AS student_pk, s.student_id AS public_student_id
      FROM students s
      WHERE s.student_id = ? OR s.rfid = ?
      LIMIT 1
      `,
      [trimmed, trimmed],
    );
    if (!rows[0]) return null;

    const publicStudentId = String((rows[0] as { public_student_id: string }).public_student_id ?? "").trim();
    if (!publicStudentId) return null;

    const studentPk = await this.assertStudentAccess(publicStudentId, role, departmentId, userId, conn);
    if (!studentPk) return null;
    return publicStudentId;
  }

  async getPaymentSummary(role: Role, departmentId: number | null, userId: number | null) {
    const academicPeriodId = await resolveActivePeriodId();
    const scope = resolvePaymentScope(role, departmentId, userId);
    const feCreatorSql = eventCreatorFilterSql("fe", scope);
    const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);
    const periodFineSql =
      academicPeriodId != null
        ? " AND f.academic_period_id = ? AND fe.academic_period_id = ? "
        : " AND 1=0 ";
    const params: (number | string)[] = [];
    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) {
      params.push(academicPeriodId);
      params.push(academicPeriodId);
    }
    if (scope.needsDeptScope) params.push(Number(departmentId));

    const deptSql = scope.needsDeptScope ? " AND p.department_id = ? " : "";

    const [rows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT
        COUNT(DISTINCT s.id) AS students_with_balance,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.amount ELSE 0 END), 0) AS ledger_total,
        COALESCE(SUM(CASE WHEN fe.id IS NOT NULL THEN f.paid_amount ELSE 0 END), 0) AS collected,
        COALESCE(SUM(
          CASE
            WHEN fe.id IS NOT NULL AND f.status != 'Waived'
            THEN GREATEST(f.amount - f.paid_amount, 0)
            ELSE 0
          END
        ), 0) AS outstanding,
        COALESCE(SUM(
          CASE WHEN fe.id IS NOT NULL AND f.status = 'Waived' THEN GREATEST(f.amount - f.paid_amount, 0) ELSE 0 END
        ), 0) AS waived
      FROM students s
      ${enrollmentJoin}
      LEFT JOIN programs p ON p.id = en.program_id
      LEFT JOIN departments d ON d.id = p.department_id
      LEFT JOIN fines f ON f.student_id = s.id
      LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
        ${feCreatorSql}
        ${periodFineSql}
      WHERE en.id IS NOT NULL
        ${deptSql}
      `,
      params.length ? params : undefined,
    );

    const row = rows[0] ?? {};
    const outstanding = clampMoney(Number(row.outstanding) || 0);

    const balanceParams: (number | string)[] = [];
    pushEventCreatorParams(balanceParams, scope);
    if (academicPeriodId != null) {
      balanceParams.push(academicPeriodId);
      balanceParams.push(academicPeriodId);
    }
    if (scope.needsDeptScope) balanceParams.push(Number(departmentId));

    const [balanceRows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS total FROM (
        SELECT s.id
        FROM students s
        ${enrollmentJoin}
        LEFT JOIN programs p ON p.id = en.program_id
        LEFT JOIN fines f ON f.student_id = s.id
        LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
          ${feCreatorSql}
          ${periodFineSql}
        WHERE en.id IS NOT NULL
          ${deptSql}
        GROUP BY s.id
        HAVING COALESCE(SUM(
          CASE
            WHEN fe.id IS NOT NULL AND f.status != 'Waived'
            THEN GREATEST(f.amount - f.paid_amount, 0)
            ELSE 0
          END
        ), 0) > 0
      ) AS with_balance
      `,
      balanceParams.length ? balanceParams : undefined,
    );

    return {
      ledgerTotal: clampMoney(Number(row.ledger_total) || 0),
      collected: clampMoney(Number(row.collected) || 0),
      outstanding,
      waived: clampMoney(Number(row.waived) || 0),
      studentsWithBalance: Math.max(0, Number(balanceRows[0]?.total) || 0),
    };
  }

  async listPaymentTransactions(role: Role, departmentId: number | null, userId: number | null) {
    const academicPeriodId = await resolveActivePeriodId();
    const scope = resolvePaymentScope(role, departmentId, userId);
    const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);
    let creatorFilterSql = "";
    if (scope.csgPresidentEventsOnly) {
      creatorFilterSql = `
        AND EXISTS (
          SELECT 1 FROM payments pay
          INNER JOIN fines f ON f.id = pay.fine_id
          INNER JOIN events e ON e.id = f.event_id
          INNER JOIN users cu ON cu.id = e.created_by AND cu.role = 'csg_president'
          WHERE pay.transaction_id = pt.id
        )
      `;
    } else if (scope.creatorUserId != null) {
      creatorFilterSql = `
        AND EXISTS (
          SELECT 1 FROM payments pay
          INNER JOIN fines f ON f.id = pay.fine_id
          INNER JOIN events e ON e.id = f.event_id
          WHERE pay.transaction_id = pt.id AND e.created_by = ?
        )
      `;
    }
    const deptSql = scope.needsDeptScope
      ? `
        AND EXISTS (
          SELECT 1
          FROM enrollments en
          INNER JOIN programs prog ON prog.id = en.program_id
          WHERE en.student_id = s.id
            AND prog.department_id = ?
            AND en.academic_period_id = ?
        )
      `
      : "";
    const periodTxnSql =
      academicPeriodId != null ? " AND pt.academic_period_id = ? " : " AND 1=0 ";

    const fineCreatorSql = eventCreatorFilterSql("e", scope);
    const finePeriodSql =
      academicPeriodId != null
        ? " AND f.academic_period_id = ? AND e.academic_period_id = ? "
        : " AND 1=0 ";

    const params: (number | string)[] = [];
    // Params for student_fines join (creator + period)
    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) {
      params.push(academicPeriodId);
      params.push(academicPeriodId);
    }
    // Params for transaction WHERE creator filter
    pushEventCreatorParams(params, scope);
    if (scope.needsDeptScope) {
      params.push(Number(departmentId));
      if (academicPeriodId != null) params.push(academicPeriodId);
    }
    if (academicPeriodId != null) params.push(academicPeriodId);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT
        pt.id,
        pt.transaction_code,
        pt.total_amount_paid,
        pt.payment_method,
        pt.remarks,
        pt.status,
        pt.previous_balance,
        pt.balance_after,
        pt.paid_at,
        s.student_id AS public_student_id,
        ${SQL_STUDENT_FULL_NAME} AS student_name,
        p.course_code AS course_code,
        ${SQL_STUDENT_DEPARTMENT_NAME} AS department_name,
        ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
        ${SQL_USER_ENCODED_BY_NAME} AS encoded_by,
        COALESCE(student_fines.total_fines, 0) AS total_fines
      FROM payment_transactions pt
      INNER JOIN students s ON s.id = pt.student_id
      ${enrollmentJoin}
      ${SQL_LATEST_PROGRAM_LEFT_JOIN}
      LEFT JOIN departments d ON d.id = p.department_id
      INNER JOIN users u ON u.id = pt.paid_by_user_id
      LEFT JOIN (
        SELECT
          f.student_id AS student_pk,
          COALESCE(SUM(f.amount), 0) AS total_fines
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE e.status = 'Completed'
          ${fineCreatorSql}
          ${finePeriodSql}
        GROUP BY f.student_id
      ) student_fines ON student_fines.student_pk = pt.student_id
      WHERE 1=1
        ${creatorFilterSql}
        ${deptSql}
        ${periodTxnSql}
      ORDER BY pt.paid_at DESC, pt.id DESC
      `,
      params.length ? params : undefined,
    );

    return {
      transactions: rows.map((row) => ({
        id: Number(row.id),
        transactionCode: String(row.transaction_code ?? ""),
        studentId: String(row.public_student_id ?? ""),
        studentName: String(row.student_name ?? "Unknown Student"),
        amountPaid: clampMoney(Number(row.total_amount_paid) || 0),
        totalFines: clampMoney(Number(row.total_fines) || 0),
        paymentMethod: String(row.payment_method ?? "Cash"),
        remarks: row.remarks != null ? String(row.remarks) : null,
        paidAt: row.paid_at != null ? String(row.paid_at) : "",
        encodedBy: String(row.encoded_by ?? ""),
        status: String(row.status ?? "Partial") === "Paid" ? "Paid" : "Partial",
        previousBalance:
          row.previous_balance != null ? clampMoney(Number(row.previous_balance) || 0) : null,
        balanceAfter: row.balance_after != null ? clampMoney(Number(row.balance_after) || 0) : null,
        department: resolveStudentDepartmentName(row.department_name, row.course_code),
        year: row.year_level != null ? String(row.year_level) : "",
      })),
    };
  }

  async getPaymentStudentByIdentifier(
    role: Role,
    departmentId: number | null,
    userId: number | null,
    identifier: string,
  ) {
    const publicStudentId = await this.resolvePublicStudentId(identifier, role, departmentId, userId);
    if (!publicStudentId) return null;
    return this.getPaymentStudentByPublicId(role, departmentId, userId, publicStudentId);
  }

  /**
   * Name search for New Payment. Returns lightweight matches (not full fine events).
   * Scoped the same way as payment student access (dept cashiers → college only).
   */
  async searchPaymentStudentsByName(
    role: Role,
    departmentId: number | null,
    _userId: number | null,
    query: string,
    limit = 15,
  ): Promise<
    Array<{
      studentId: string;
      studentName: string;
      course: string;
      department: string;
      year: string;
    }>
  > {
    const trimmed = String(query ?? "").trim();
    if (trimmed.length < 2) return [];

    const academicPeriodId = await resolveActivePeriodId();
    const scope = resolvePaymentScope(role, departmentId, _userId);
    const needsDeptScope = scope.needsDeptScope;
    const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);
    const like = `%${trimmed.toLowerCase()}%`;
    const take = Math.min(20, Math.max(1, Math.floor(Number(limit) || 15)));

    const params: (number | string)[] = [like, like, like, like];
    if (needsDeptScope) params.push(Number(departmentId));

    const [rows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT
        s.student_id AS student_id,
        ${SQL_STUDENT_FULL_NAME} AS student_name,
        p.course_code AS course_code,
        ${SQL_STUDENT_DEPARTMENT_NAME} AS department_name,
        ${SQL_STUDENT_YEAR_LEVEL} AS year_level
      FROM students s
      ${enrollmentJoin}
      ${SQL_LATEST_PROGRAM_LEFT_JOIN}
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE en.id IS NOT NULL
        AND (
          LOWER(${SQL_STUDENT_FULL_NAME}) LIKE ?
          OR LOWER(TRIM(COALESCE(s.full_name, ''))) LIKE ?
          OR LOWER(TRIM(COALESCE(s.first_name, ''))) LIKE ?
          OR LOWER(TRIM(COALESCE(s.last_name, ''))) LIKE ?
        )
        ${needsDeptScope ? " AND p.department_id = ? " : ""}
      ORDER BY student_name ASC
      LIMIT ${take}
      `,
      params,
    );

    return rows.map((row) => ({
      studentId: String(row.student_id ?? "").trim(),
      studentName: String(row.student_name ?? "").trim() || "Unknown Student",
      course: row.course_code ? String(row.course_code) : "—",
      department: resolveStudentDepartmentName(
        row.department_name != null ? String(row.department_name) : null,
        row.course_code != null ? String(row.course_code) : null,
      ),
      year: toYearLabel(row.year_level != null ? Number(row.year_level) : null),
    })).filter((row) => row.studentId);
  }

  async getPaymentStudentByPublicId(
    role: Role,
    departmentId: number | null,
    userId: number | null,
    publicStudentId: string,
  ) {
    const academicPeriodId = await resolveActivePeriodId();
    const studentPk = await this.assertStudentAccess(publicStudentId, role, departmentId, userId);
    if (!studentPk) return null;

    const scope = resolvePaymentScope(role, departmentId, userId);
    const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);
    const feCreatorSql = eventCreatorFilterSql("fe", scope);
    const evCreatorSql = eventCreatorFilterSql("ev", scope);
    const periodFineSql =
      academicPeriodId != null
        ? " AND f.academic_period_id = ? AND fe.academic_period_id = ? "
        : " AND 1=0 ";
    const periodEventSql =
      academicPeriodId != null ? " AND ev.academic_period_id = ? " : " AND 1=0 ";
    const params: (number | string)[] = [];
    // Subquery event filter (evCreatorSql then periodEventSql)
    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) params.push(academicPeriodId);
    // Fine join filter (feCreatorSql then periodFineSql)
    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) {
      params.push(academicPeriodId);
      params.push(academicPeriodId);
    }
    params.push(studentPk);
    if (scope.needsDeptScope) params.push(Number(departmentId));

    const [studentRows] = await pool.execute<PaymentStudentRow[]>(
      `
      SELECT
        s.id AS student_pk,
        s.student_id AS student_id,
        ${SQL_STUDENT_FULL_NAME} AS student_name,
        p.course_code AS course_code,
        p.major AS major,
        MAX(${SQL_STUDENT_DEPARTMENT_NAME}) AS department_name,
        ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
        (
          SELECT COUNT(DISTINCT ev.id)
          FROM events ev
          WHERE ev.status = 'Completed'
            ${evCreatorSql}
            ${periodEventSql}
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
      ${enrollmentJoin}
      LEFT JOIN programs p ON p.id = en.program_id
      LEFT JOIN departments d ON d.id = p.department_id
      LEFT JOIN fines f ON f.student_id = s.id
      LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
        ${feCreatorSql}
        ${periodFineSql}
      WHERE s.id = ?
        AND en.id IS NOT NULL
        ${scope.needsDeptScope ? " AND p.department_id = ? " : ""}
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
      scope,
      academicPeriodId,
    );
    return this.formatPaymentStudentDto(row, eventsByStudent.get(studentPk) ?? []);
  }

  async listPaymentStudents(role: Role, departmentId: number | null, userId: number | null) {
    const academicPeriodId = await resolveActivePeriodId();
    const params: (number | string)[] = [];
    const scope = resolvePaymentScope(role, departmentId, userId);
    const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);
    const scopedClause = scope.needsDeptScope
      ? "WHERE en.id IS NOT NULL AND p.department_id = ?"
      : "WHERE en.id IS NOT NULL";

    const feCreatorSql = eventCreatorFilterSql("fe", scope);
    const evCreatorSql = eventCreatorFilterSql("ev", scope);
    const periodFineSql =
      academicPeriodId != null
        ? " AND f.academic_period_id = ? AND fe.academic_period_id = ? "
        : " AND 1=0 ";
    const periodEventSql =
      academicPeriodId != null ? " AND ev.academic_period_id = ? " : " AND 1=0 ";

    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) params.push(academicPeriodId);
    pushEventCreatorParams(params, scope);
    if (academicPeriodId != null) {
      params.push(academicPeriodId);
      params.push(academicPeriodId);
    }
    if (scope.needsDeptScope) params.push(Number(departmentId));

    const [studentRows] = await pool.execute<PaymentStudentRow[]>(
      `
      SELECT
        s.id AS student_pk,
        s.student_id AS student_id,
        ${SQL_STUDENT_FULL_NAME} AS student_name,
        p.course_code AS course_code,
        p.major AS major,
        MAX(${SQL_STUDENT_DEPARTMENT_NAME}) AS department_name,
        ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
        (
          SELECT COUNT(DISTINCT ev.id)
          FROM events ev
          WHERE ev.status = 'Completed'
            ${evCreatorSql}
            ${periodEventSql}
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
      ${enrollmentJoin}
      LEFT JOIN programs p ON p.id = en.program_id
      LEFT JOIN departments d ON d.id = p.department_id
      LEFT JOIN fines f ON f.student_id = s.id
      LEFT JOIN events fe ON fe.id = f.event_id AND fe.status = 'Completed'
        ${feCreatorSql}
        ${periodFineSql}
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
    academicPeriodId?: number | null;
  }) {
    const amount = clampMoney(args.amountPaid);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false as const, status: 400, message: "Amount paid must be greater than zero." };
    }

    const academicPeriodId =
      args.academicPeriodId != null && Number.isFinite(Number(args.academicPeriodId))
        ? Number(args.academicPeriodId)
        : await resolveActivePeriodId();
    if (academicPeriodId == null) {
      return {
        ok: false as const,
        status: 403,
        message: "No active school year and semester. Activate an academic period before recording payments.",
      };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const scope = resolvePaymentScope(args.role, args.departmentId, args.encodedByUserId);
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

      const totalsBefore = await this.getStudentTotals(studentPk, scope, academicPeriodId, conn);
      if (amount > totalsBefore.remaining) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Amount cannot be greater than remaining balance." };
      }

      const openFineCreatorSql = eventCreatorFilterSql("e", scope);
      const openFineParams: (number | string)[] = [studentPk, academicPeriodId, academicPeriodId];
      pushEventCreatorParams(openFineParams, scope);
      const [openFines] = await conn.execute<OpenFineRow[]>(
        `
        SELECT f.id, f.amount, f.paid_amount, f.status
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE f.student_id = ?
          AND f.status IN ('Unpaid', 'Partial')
          AND f.amount > f.paid_amount
          AND e.status = 'Completed'
          AND f.academic_period_id = ?
          AND e.academic_period_id = ?
          ${openFineCreatorSql}
        ORDER BY f.updated_at ASC, f.id ASC
        `,
        openFineParams,
      );

      let remainingToApply = amount;
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const datePart = `${y}${m}${d}`;

      const [seqRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(id), 0) + 1 AS next_seq FROM payment_transactions FOR UPDATE`,
      );
      const nextSeq = Math.max(1, Number(seqRows[0]?.next_seq) || 1);
      const transactionCode = `CSG-${datePart}-${String(nextSeq).padStart(5, "0")}`;

      const [txnResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO payment_transactions
          (transaction_code, student_id, academic_period_id, total_amount_paid, payment_method, remarks, paid_by_user_id, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionCode,
          studentPk,
          academicPeriodId,
          amount,
          args.paymentMethod ?? "Cash",
          args.remarks ?? null,
          args.encodedByUserId,
          now,
        ],
      );
      const transactionId = Number(txnResult.insertId);
      if (!Number.isFinite(transactionId) || transactionId <= 0) {
        await conn.rollback();
        return { ok: false as const, status: 500, message: "Unable to create payment transaction." };
      }

      const receiptBase = `RCP-${datePart}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}${String(now.getMilliseconds()).padStart(3, "0")}`;
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
          `INSERT INTO payments (student_id, academic_period_id, fine_id, amount_paid, receipt_no, payment_method, remarks, paid_by_user_id, transaction_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentPk,
            academicPeriodId,
            Number(fine.id),
            applied,
            receiptNo,
            args.paymentMethod ?? "Cash",
            args.remarks ?? null,
            args.encodedByUserId,
            transactionId,
          ],
        );
        insertSequence += 1;
        remainingToApply = clampMoney(remainingToApply - applied);
      }

      if (remainingToApply > 0) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Unable to allocate payment across open fines." };
      }

      const totalsAfter = await this.getStudentTotals(studentPk, scope, academicPeriodId, conn);
      const transactionStatus = totalsAfter.remaining <= 0 ? "Paid" : "Partial";
      await conn.execute<ResultSetHeader>(
        `UPDATE payment_transactions SET status = ?, previous_balance = ?, balance_after = ? WHERE id = ?`,
        [transactionStatus, totalsBefore.remaining, totalsAfter.remaining, transactionId],
      );
      await conn.commit();

      const student = await this.getPaymentStudentByPublicId(
        args.role,
        args.departmentId,
        args.encodedByUserId,
        args.publicStudentId,
      );

      const [encoderRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(TRIM(full_name), ''), username) AS encoded_by
         FROM users WHERE id = ? LIMIT 1`,
        [args.encodedByUserId],
      );
      const encodedBy = encoderRows.length ? String(encoderRows[0].encoded_by ?? "") : "";

      return {
        ok: true as const,
        transactionCode,
        transactionId,
        receiptNo: transactionCode,
        amountPaid: amount,
        previousBalance: totalsBefore.remaining,
        newBalance: totalsAfter.remaining,
        paidAmount: totalsAfter.paidAmount,
        totalFine: totalsAfter.totalFine,
        waivedAmount: totalsAfter.waivedAmount,
        encodedBy,
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
    academicPeriodId?: number | null;
  }) {
    const target = clampMoney(args.targetBalance);
    const academicPeriodId =
      args.academicPeriodId != null && Number.isFinite(Number(args.academicPeriodId))
        ? Number(args.academicPeriodId)
        : await resolveActivePeriodId();
    if (academicPeriodId == null) {
      return {
        ok: false as const,
        status: 403,
        message: "No active school year and semester. Activate an academic period before updating balances.",
      };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const scope = resolvePaymentScope(args.role, args.departmentId, args.userId);
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

      const totalsBefore = await this.getStudentTotals(studentPk, scope, academicPeriodId, conn);
      if (target < 0 || target > totalsBefore.totalFine) {
        await conn.rollback();
        return { ok: false as const, status: 400, message: "Balance must be between 0 and Total Fine." };
      }

      // Keep waived fines untouched; editable cap for payable side only.
      const payableTotal = clampMoney(totalsBefore.totalFine - totalsBefore.waivedAmount);
      const clampedTarget = Math.min(target, payableTotal);
      let desiredPaid = clampMoney(payableTotal - clampedTarget);

      const balanceFineCreatorSql = eventCreatorFilterSql("e", scope);
      const balanceFineParams: (number | string)[] = [studentPk, academicPeriodId, academicPeriodId];
      pushEventCreatorParams(balanceFineParams, scope);
      const [fineRows] = await conn.execute<BalanceFineRow[]>(
        `
        SELECT f.id, f.amount, f.paid_amount, f.status
        FROM fines f
        INNER JOIN events e ON e.id = f.event_id
        WHERE f.student_id = ?
          AND e.status = 'Completed'
          AND f.academic_period_id = ?
          AND e.academic_period_id = ?
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

      const totalsAfter = await this.getStudentTotals(studentPk, scope, academicPeriodId, conn);
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

  /**
   * Super Admin only: remove a payment transaction and reverse allocated fine payments.
   */
  async deletePaymentTransaction(args: {
    role: Role;
    transactionId: number;
  }) {
    if (args.role !== "super_admin") {
      return { ok: false as const, status: 403, message: "Only Super Admin can delete payments." };
    }
    const transactionId = Number(args.transactionId);
    if (!Number.isFinite(transactionId) || transactionId <= 0) {
      return { ok: false as const, status: 400, message: "Invalid payment transaction id." };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [txnRows] = await conn.execute<RowDataPacket[]>(
        `
        SELECT id, transaction_code, student_id, total_amount_paid
        FROM payment_transactions
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [transactionId],
      );
      if (!txnRows.length) {
        await conn.rollback();
        return { ok: false as const, status: 404, message: "Payment transaction not found." };
      }
      const txn = txnRows[0];

      const [paymentRows] = await conn.execute<RowDataPacket[]>(
        `
        SELECT id, fine_id, amount_paid
        FROM payments
        WHERE transaction_id = ?
        ORDER BY id ASC
        FOR UPDATE
        `,
        [transactionId],
      );

      for (const pay of paymentRows) {
        const fineId = pay.fine_id != null ? Number(pay.fine_id) : null;
        const applied = clampMoney(Number(pay.amount_paid) || 0);
        if (fineId == null || !Number.isFinite(fineId) || fineId <= 0 || applied <= 0) continue;

        const [fineRows] = await conn.execute<RowDataPacket[]>(
          `SELECT id, amount, paid_amount, status FROM fines WHERE id = ? LIMIT 1 FOR UPDATE`,
          [fineId],
        );
        if (!fineRows.length) continue;

        const fineAmount = clampMoney(Number(fineRows[0].amount) || 0);
        const currentPaid = clampMoney(Number(fineRows[0].paid_amount) || 0);
        const nextPaid = clampMoney(currentPaid - applied);
        const nextStatus = computeFineStatus(fineAmount, nextPaid, String(fineRows[0].status ?? ""));

        await conn.execute<ResultSetHeader>(
          `UPDATE fines SET paid_amount = ?, status = ? WHERE id = ?`,
          [nextPaid, nextStatus, fineId],
        );
      }

      await conn.execute<ResultSetHeader>(`DELETE FROM payments WHERE transaction_id = ?`, [
        transactionId,
      ]);
      await conn.execute<ResultSetHeader>(`DELETE FROM payment_transactions WHERE id = ?`, [
        transactionId,
      ]);

      await conn.commit();

      return {
        ok: true as const,
        id: transactionId,
        transactionCode: String(txn.transaction_code ?? ""),
        amountPaid: clampMoney(Number(txn.total_amount_paid) || 0),
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
