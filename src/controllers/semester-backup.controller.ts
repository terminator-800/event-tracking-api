import { Request, Response } from "express";
import {
  generateSemesterBackup,
  resolveBackupScope,
} from "./services/semester-backup.service";
import { getUserDepartmentIdForAttendance } from "../repositories/attendance-page.repository";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class SemesterBackupController {
  /** GET /backup/semester/:periodId */
  async download(req: Request, res: Response): Promise<void> {
    const periodId = Number(req.params.periodId);
    if (!Number.isFinite(periodId) || periodId <= 0) {
      res.status(400).json({ message: "Invalid academic period id." });
      return;
    }

    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || !role) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    try {
      const jwtDept =
        req.user?.department_id != null && Number.isFinite(Number(req.user.department_id))
          ? Number(req.user.department_id)
          : null;
      const dbDept = await getUserDepartmentIdForAttendance(userId);
      const departmentId = jwtDept ?? dbDept;
      const scope = resolveBackupScope(role, userId, departmentId);

      if (scope.needsDepartment && scope.departmentId == null) {
        res.status(403).json({
          message: "Your account has no department assigned. Backup is limited to your college.",
        });
        return;
      }

      if (scope.creatorMode === "own" && scope.creatorUserId == null) {
        res.status(403).json({ message: "Unable to resolve your account for event creator backup." });
        return;
      }

      if (scope.creatorMode === "department_creators" && scope.departmentId == null) {
        res.status(403).json({
          message: "Your account has no department assigned. Backup is limited to creators in your college.",
        });
        return;
      }

      const result = await generateSemesterBackup({
        periodId,
        departmentId: scope.departmentId,
        creatorMode: scope.creatorMode,
        creatorUserId: scope.creatorUserId,
      });
      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.setHeader("X-Backup-Events", String(result.counts.events));
      res.setHeader("X-Backup-Attendance", String(result.counts.attendance));
      res.setHeader("X-Backup-Collection", String(result.counts.collection));
      res.setHeader("X-Backup-Scope", result.scope.scopeLabel);
      res.send(result.buffer);
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err != null && "status" in err
          ? Number((err as { status?: number }).status)
          : 500;
      const message = err instanceof Error ? err.message : "Failed to generate semester backup.";
      console.error("[SemesterBackup.download]", err);
      res.status(Number.isFinite(status) && status >= 400 ? status : 500).json({ message });
    }
  }
}
