import { Request, Response } from "express";
import { getUserDepartmentIdForAttendance } from "../repositories/attendance-page.repository";
import {
  assertCanAccessEventConfig,
  getEventRowForAccess,
} from "./services/event-config-export.service";
import {
  buildAttendanceJsonPackage,
  importAttendanceJson,
  parseAttendanceJsonBuffer,
  previewAttendanceJsonImport,
  validateAttendanceJsonPackage,
  type AttendanceImportAction,
} from "./services/attendance-json-export.service";

function parseDepartmentCodeQuery(req: Request): string | null {
  if (typeof req.query.departmentCode === "string") return req.query.departmentCode;
  if (typeof req.query.department_code === "string") return req.query.department_code;
  return null;
}

function parseImportAction(raw: unknown): AttendanceImportAction {
  return String(raw ?? "skip").trim().toLowerCase() === "update" ? "update" : "skip";
}

export class AttendanceJsonExportController {
  /** GET /export/event/:eventId/attendance/json */
  async exportAttendance(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const role = String(req.user?.role ?? "").toLowerCase();
    const eventId = Number(req.params.eventId);
    const departmentCode = parseDepartmentCodeQuery(req);

    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }
    if (!Number.isFinite(eventId) || eventId <= 0) {
      res.status(400).json({ message: "Invalid event ID." });
      return;
    }

    try {
      const event = await getEventRowForAccess(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found." });
        return;
      }

      const departmentId =
        role === "admin" || role === "super_admin" || role === "csg_president"
          ? null
          : await getUserDepartmentIdForAttendance(userId);

      const access = await assertCanAccessEventConfig({
        event,
        userId,
        role,
        departmentId,
      });
      if (!access.ok) {
        res.status(access.status).json({ message: access.message });
        return;
      }

      // Governors export their own department; CSG/admin must pass departmentCode.
      if (role !== "admin" && role !== "super_admin" && role !== "csg_president") {
        if (departmentId == null) {
          res.status(403).json({ message: "Department scope required to export attendance." });
          return;
        }
      } else if (!String(departmentCode ?? "").trim()) {
        res.status(400).json({
          message: "Select a department before exporting attendance.",
        });
        return;
      }

      const { pkg, filename } = await buildAttendanceJsonPackage({
        eventId,
        username,
        departmentId,
        departmentCode,
      });

      const body = JSON.stringify(pkg, null, 2);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(body);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message =
        err instanceof Error ? err.message : "Failed to export attendance.";
      console.error("[AttendanceJson.exportAttendance]", err);
      res.status(status).json({ message });
    }
  }

  /** POST /export/event/attendance/preview */
  async previewImport(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const role = String(req.user?.role ?? "").toLowerCase();
    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }
    if (role !== "admin" && role !== "super_admin" && role !== "csg_president") {
      res.status(403).json({
        message: "Only CSG President (or admin) can import attendance into a master event.",
      });
      return;
    }

    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      let pkg;
      if (file?.buffer) {
        pkg = parseAttendanceJsonBuffer(file.buffer);
      } else if (req.body && typeof req.body === "object" && (req.body as { format?: string }).format) {
        pkg = validateAttendanceJsonPackage(req.body);
      } else {
        res.status(400).json({ message: "Upload an attendance .json file." });
        return;
      }

      const preview = await previewAttendanceJsonImport(pkg);
      res.status(preview.valid ? 200 : 422).json(preview);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message = err instanceof Error ? err.message : "Failed to preview attendance import.";
      console.error("[AttendanceJson.previewImport]", err);
      res.status(status).json({ message });
    }
  }

  /** POST /export/event/attendance/import */
  async importAttendance(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const role = String(req.user?.role ?? "").toLowerCase();
    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }
    if (role !== "admin" && role !== "super_admin" && role !== "csg_president") {
      res.status(403).json({
        message: "Only CSG President (or admin) can import attendance into a master event.",
      });
      return;
    }

    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const body = (req.body ?? {}) as Record<string, unknown>;
      let pkg;
      if (file?.buffer) {
        pkg = parseAttendanceJsonBuffer(file.buffer);
      } else if (body.format) {
        pkg = validateAttendanceJsonPackage(body);
      } else {
        res.status(400).json({ message: "Upload an attendance .json file." });
        return;
      }

      const action = parseImportAction(body.action);
      const result = await importAttendanceJson({
        pkg,
        action,
        userId,
        role,
      });
      res.status(result.success ? 200 : 422).json(result);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message = err instanceof Error ? err.message : "Attendance import failed.";
      console.error("[AttendanceJson.importAttendance]", err);
      res.status(status).json({ message });
    }
  }
}
