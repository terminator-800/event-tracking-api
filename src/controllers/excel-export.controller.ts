import { Request, Response } from "express";
import {
  generateEventExcel,
  generateAllEventsExcel,
  previewImportExcel,
  importEventExcel,
  importEventFull,
  getExportAuditLog,
} from "./services/excel-export.service";
import { getUserDepartmentIdForAttendance } from "../repositories/attendance-page.repository";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class ExcelExportController {
  /** GET /export/event/:eventId/excel */
  async exportEvent(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const role = String(req.user?.role ?? "").toLowerCase();
    const eventId = Number(req.params.eventId);

    if (!userId) { res.status(401).json({ message: "Unauthorized." }); return; }
    if (!Number.isFinite(eventId)) { res.status(400).json({ message: "Invalid event ID." }); return; }

    try {
      const deptScope = (role === "admin" || role === "super_admin" || role === "csg_president")
        ? null
        : (await getUserDepartmentIdForAttendance(userId));

      const result = await generateEventExcel({ eventId, userId, username, departmentScope: deptScope });

      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[ExcelExport.exportEvent]", err);
      res.status(500).json({ message: msg });
    }
  }

  /** GET /export/events/excel */
  async exportAllEvents(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const role = String(req.user?.role ?? "").toLowerCase();

    if (!userId) { res.status(401).json({ message: "Unauthorized." }); return; }

    try {
      const deptScope = (role === "admin" || role === "super_admin" || role === "csg_president")
        ? null
        : (await getUserDepartmentIdForAttendance(userId));

      const buffer = await generateAllEventsExcel({ userId, username, role, departmentScope: deptScope });

      const filename = `all-events-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      console.error("[ExcelExport.exportAllEvents]", err);
      res.status(500).json({ message: "Failed to generate Excel export." });
    }
  }

  /** POST /export/event/import-preview  (CSG President only) */
  async importPreview(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!userId) { res.status(401).json({ message: "Unauthorized." }); return; }
    if (!file?.buffer) { res.status(400).json({ message: "No file uploaded." }); return; }

    try {
      const preview = await previewImportExcel(file.buffer, userId, username);
      res.status(preview.valid ? 200 : 422).json(preview);
    } catch (err) {
      console.error("[ExcelExport.importPreview]", err);
      res.status(500).json({ message: "Failed to process file." });
    }
  }

  /** POST /export/event/import  (CSG President only) — legacy */
  async importExcel(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!userId) { res.status(401).json({ message: "Unauthorized." }); return; }
    if (!file?.buffer) { res.status(400).json({ message: "No file uploaded." }); return; }

    try {
      const result = await importEventExcel(file.buffer, userId, username);
      res.status(result.success ? 200 : 422).json(result);
    } catch (err) {
      console.error("[ExcelExport.importExcel]", err);
      res.status(500).json({ message: "Import failed." });
    }
  }

  /**
   * POST /export/event/import-full  (CSG President only)
   * Full import: creates event, students, attendance, fines, payments.
   * Body field `action`: 'check' | 'skip' | 'replace' | 'copy' (default: 'check')
   */
  async importEventFull(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    const username = req.user?.username ?? "Unknown";
    const file = (req as any).file as Express.Multer.File | undefined;
    const rawAction = String((req.body as Record<string, unknown>)?.action ?? "check");
    const action = (["check", "skip", "replace", "copy"].includes(rawAction)
      ? rawAction
      : "check") as "check" | "skip" | "replace" | "copy";

    if (!userId) { res.status(401).json({ message: "Unauthorized." }); return; }
    if (!file?.buffer) { res.status(400).json({ message: "No file uploaded." }); return; }

    try {
      const result = await importEventFull(file.buffer, userId, username, action);
      res.status(result.success ? 200 : 422).json(result);
    } catch (err) {
      console.error("[ExcelExport.importEventFull]", err);
      res.status(500).json({ message: "Import failed due to an unexpected error." });
    }
  }

  /** GET /export/audit-log  (CSG President only) */
  async getAuditLog(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await getExportAuditLog(limit);
      res.status(200).json({ log: rows });
    } catch (err) {
      console.error("[ExcelExport.getAuditLog]", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
