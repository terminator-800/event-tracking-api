import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "../config/db";

type QueryExecutor = Pick<typeof pool, "execute">;

const RECONCILE_STALE_ABSENCE_FINES_SQL = `
  DELETE f
  FROM fines f
  INNER JOIN attendance a
    ON a.student_id = f.student_id
   AND a.event_id   = f.event_id
  WHERE f.event_id = ?
    AND f.status = 'Unpaid'
    AND (
      (f.reason = 'Absent PM' AND a.pm_time_in IS NOT NULL)
      OR (f.reason = 'Absent AM' AND a.am_time_in IS NOT NULL)
      OR (f.reason = 'Absent PM Time Out' AND a.pm_time_in IS NOT NULL)
      OR (f.reason = 'Absent AM Time Out' AND a.am_time_in IS NOT NULL)
    )
`;

/**
 * Removes unpaid absence fines that conflict with recorded time-in (late import after cron).
 */
export async function reconcileStaleAbsenceFines(
  eventId: number,
  conn: QueryExecutor | PoolConnection = pool,
): Promise<number> {
  const [result] = await conn.execute<ResultSetHeader>(RECONCILE_STALE_ABSENCE_FINES_SQL, [
    eventId,
  ]);
  return result.affectedRows ?? 0;
}

export async function eventHasFinesGenerated(
  eventId: number,
  conn: QueryExecutor | PoolConnection = pool,
): Promise<boolean> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT fines_generated FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (!rows.length) return false;
  return Number(rows[0].fines_generated) === 1;
}
