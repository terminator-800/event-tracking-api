import type { RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import {
  ACADEMIC_PERIOD_QUERIES,
  type AcademicPeriodRow,
} from "./queries/academic-periods.queries";

function rowToPeriod(row: RowDataPacket): AcademicPeriodRow {
  return row as AcademicPeriodRow;
}

export async function getActiveAcademicPeriod(): Promise<AcademicPeriodRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(ACADEMIC_PERIOD_QUERIES.findActive);
  return rows[0] ? rowToPeriod(rows[0]) : null;
}

export async function listAcademicPeriods(): Promise<AcademicPeriodRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(ACADEMIC_PERIOD_QUERIES.listAll);
  return rows.map(rowToPeriod);
}

export async function getAcademicPeriodById(id: number): Promise<AcademicPeriodRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(ACADEMIC_PERIOD_QUERIES.findById, [id]);
  return rows[0] ? rowToPeriod(rows[0]) : null;
}
