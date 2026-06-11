import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";

export const DATA_RESET_CONFIRMATION_PHRASE = "RESET ALL DATA";

export interface DataResetPreviewCounts {
  fineAdjustments: number;
  payments: number;
  fines: number;
  attendance: number;
  eventAudiences: number;
  events: number;
  enrollments: number;
  students: number;
  programs: number;
  departments: number;
  nonAdminUsers: number;
  adminUsers: number;
}

export interface DataResetResult {
  deleted: DataResetPreviewCounts;
}

async function countTable(
  executor: typeof pool | PoolConnection,
  table: string,
): Promise<number> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM \`${table}\``,
  );
  return Number(rows[0]?.total ?? 0);
}

async function countNonAdminUsers(executor: typeof pool | PoolConnection): Promise<number> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users WHERE role != 'admin'`,
  );
  return Number(rows[0]?.total ?? 0);
}

async function countAdminUsers(executor: typeof pool | PoolConnection): Promise<number> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users WHERE role = 'admin'`,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getDataResetPreview(): Promise<DataResetPreviewCounts> {
  return {
    fineAdjustments: await countTable(pool, "fine_adjustments"),
    payments: await countTable(pool, "payments"),
    fines: await countTable(pool, "fines"),
    attendance: await countTable(pool, "attendance"),
    eventAudiences: await countTable(pool, "event_audiences"),
    events: await countTable(pool, "events"),
    enrollments: await countTable(pool, "enrollments"),
    students: await countTable(pool, "students"),
    programs: await countTable(pool, "programs"),
    departments: await countTable(pool, "departments"),
    nonAdminUsers: await countNonAdminUsers(pool),
    adminUsers: await countAdminUsers(pool),
  };
}

export async function executeDataReset(): Promise<DataResetResult> {
  const preview = await getDataResetPreview();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE users
       SET student_id = NULL, department_id = NULL, program_id = NULL
       WHERE role = 'admin'`,
    );

    await conn.execute("DELETE FROM fine_adjustments");
    await conn.execute("DELETE FROM payments");
    await conn.execute("DELETE FROM fines");
    await conn.execute("DELETE FROM attendance");
    await conn.execute("DELETE FROM event_audiences");
    await conn.execute("DELETE FROM events");

    const [userDeleteResult] = await conn.execute<ResultSetHeader>(
      `DELETE FROM users WHERE role != 'admin'`,
    );

    await conn.execute("DELETE FROM enrollments");
    await conn.execute("DELETE FROM students");
    await conn.execute("DELETE FROM programs");
    await conn.execute("DELETE FROM departments");

    await conn.commit();

    return {
      deleted: {
        ...preview,
        nonAdminUsers: Number(userDeleteResult.affectedRows ?? preview.nonAdminUsers),
      },
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
