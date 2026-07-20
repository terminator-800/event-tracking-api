import type { AcademicPeriodSemester } from "../../models/academic_periods.model";

export type AcademicPeriodRow = {
  id: number;
  school_year: string;
  semester: AcademicPeriodSemester;
  status: "draft" | "active" | "archived";
  label: string | null;
  starts_on: string | null;
  ends_on: string | null;
  activated_at: string | null;
  activated_by_user_id: number | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
};

export const ACADEMIC_PERIOD_QUERIES = {
  listAll: `
    SELECT ap.*, u.username AS activated_by_username, cu.username AS created_by_username
    FROM academic_periods ap
    LEFT JOIN users u ON u.id = ap.activated_by_user_id
    LEFT JOIN users cu ON cu.id = ap.created_by_user_id
    ORDER BY ap.school_year DESC, FIELD(ap.semester, 'summer', '2nd sem', '1st sem'), ap.id DESC
  `,
  findById: `SELECT * FROM academic_periods WHERE id = ? LIMIT 1`,
  findActive: `SELECT * FROM academic_periods WHERE status = 'active' LIMIT 1`,
  findBySchoolYearSemester: `
    SELECT * FROM academic_periods WHERE school_year = ? AND semester = ? LIMIT 1
  `,
  insert: `
    INSERT INTO academic_periods (
      school_year, semester, status, label, starts_on, ends_on, created_by_user_id
    ) VALUES (?, ?, 'draft', ?, ?, ?, ?)
  `,
  updateDraft: `
    UPDATE academic_periods
    SET school_year = ?, semester = ?, label = ?, starts_on = ?, ends_on = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'draft'
  `,
  archiveAllActive: `
    UPDATE academic_periods
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'active'
  `,
  activate: `
    UPDATE academic_periods
    SET status = 'active',
        activated_at = CURRENT_TIMESTAMP,
        activated_by_user_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  deleteById: `DELETE FROM academic_periods WHERE id = ? AND status <> 'active'`,
};
