import { Request, Response } from "express";
import { getUserDepartmentIdForAttendance } from "../repositories/attendance-page.repository";
import {
  assertCanAccessEventConfig,
  buildEventConfigPackage,
  getEventConfigRoster,
  getEventRowForAccess,
  importEventConfig,
  parseEventConfigBuffer,
  previewEventConfigImport,
  validateEventConfigPackage,
  type ImportEventConfigAction,
} from "./services/event-config-export.service";

function parseAction(raw: unknown): ImportEventConfigAction {
  const v = String(raw ?? "check").trim().toLowerCase();
  if (v === "merge" || v === "create" || v === "check" || v === "update" || v === "cancel") {
    return v;
  }
  // Legacy client values map to update/merge (never create duplicate copies).
  if (v === "skip" || v === "replace" || v === "copy") return "update";
  return "check";
}

function parseDepartmentCodeQuery(req: Request): string | null {
  if (typeof req.query.departmentCode === "string") return req.query.departmentCode;
  if (typeof req.query.department_code === "string") return req.query.department_code;
  return null;
}

export class EventConfigExportController {
  /** GET /export/event/:eventId/config/roster */
  async getRoster(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
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

      const roster = await getEventConfigRoster({
        eventId,
        departmentCode,
        role,
        userDepartmentId: departmentId ?? req.user?.department_id ?? null,
      });
      res.status(200).json(roster);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message = err instanceof Error ? err.message : "Failed to load roster.";
      console.error("[EventConfig.getRoster]", err);
      res.status(status).json({ message });
    }
  }

  /** GET /export/event/:eventId/config */
  async exportConfig(req: Request, res: Response): Promise<void> {
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

      // All-department events must be exported for a specific department.
      if (Number(event.is_all_departments) === 1 && !String(departmentCode ?? "").trim()) {
        res.status(400).json({
          message: "Select a department before exporting this all-departments event.",
        });
        return;
      }

      const { pkg, filename } = await buildEventConfigPackage({
        eventId,
        username,
        departmentCodeFilter: departmentCode,
      });

      const body = JSON.stringify(pkg, null, 2);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(body);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message = err instanceof Error ? err.message : "Failed to export event config.";
      console.error("[EventConfig.exportConfig]", err);
      res.status(status).json({ message });
    }
  }

  /** POST /export/event/config/preview — multipart file or JSON body */
  async previewImport(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const role = String(req.user?.role ?? "").toLowerCase();
    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      let pkg;
      if (file?.buffer) {
        pkg = parseEventConfigBuffer(file.buffer);
      } else if (req.body && typeof req.body === "object" && (req.body as { format?: string }).format) {
        pkg = validateEventConfigPackage(req.body);
      } else if (req.body?.package) {
        pkg = validateEventConfigPackage(req.body.package);
      } else {
        res.status(400).json({ message: "Upload a .json config file or send a config package body." });
        return;
      }

      const departmentId =
        role === "admin" || role === "super_admin" || role === "csg_president"
          ? null
          : await getUserDepartmentIdForAttendance(userId);

      const preview = await previewEventConfigImport(pkg, {
        role,
        departmentId,
        userId,
      });
      res.status(preview.valid ? 200 : 422).json(preview);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message = err instanceof Error ? err.message : "Failed to preview import.";
      console.error("[EventConfig.previewImport]", err);
      res.status(status).json({ message });
    }
  }

  /** POST /export/event/config/import */
  async importConfig(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const role = String(req.user?.role ?? "").toLowerCase();
    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const body = (req.body ?? {}) as Record<string, unknown>;
      let pkg;
      if (file?.buffer) {
        pkg = parseEventConfigBuffer(file.buffer);
      } else if (body.package) {
        pkg = validateEventConfigPackage(body.package);
      } else if (body.format) {
        pkg = validateEventConfigPackage(body);
      } else {
        res.status(400).json({ message: "Upload a .json config file or send a config package body." });
        return;
      }

      const attendancePassword = String(
        body.attendancePassword ?? body.attendance_password ?? "",
      ).trim();
      const action = parseAction(body.action);

      const departmentId =
        role === "admin" || role === "super_admin" || role === "csg_president"
          ? null
          : await getUserDepartmentIdForAttendance(userId);

      const result = await importEventConfig({
        pkg,
        userId,
        username,
        role,
        departmentId,
        attendancePassword,
        action,
      });

      res.status(result.success ? 200 : 422).json(result);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 500;
      const message = err instanceof Error ? err.message : "Import failed.";
      console.error("[EventConfig.importConfig]", err);
      res.status(status).json({ message });
    }
  }
}
