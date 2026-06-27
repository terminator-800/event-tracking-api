import { Request, Response } from "express";
import {
  activateAcademicPeriod,
  createAcademicPeriod,
  deleteAcademicPeriod,
  getActiveAcademicPeriod,
  listAcademicPeriods,
  updateAcademicPeriod,
} from "./services/academic-period.service";

export class AcademicPeriodController {
  async list(_req: Request, res: Response): Promise<void> {
    try {
      const periods = await listAcademicPeriods();
      res.status(200).json({ periods });
    } catch (error) {
      console.error("[AcademicPeriodController.list]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async getActive(_req: Request, res: Response): Promise<void> {
    try {
      const period = await getActiveAcademicPeriod();
      if (!period) {
        res.status(404).json({ message: "No active academic period." });
        return;
      }
      res.status(200).json({ period });
    } catch (error) {
      console.error("[AcademicPeriodController.getActive]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const { schoolYear, school_year, semester, label, startsOn, starts_on, endsOn, ends_on } = req.body ?? {};
      const result = await createAcademicPeriod({
        schoolYear: schoolYear ?? school_year,
        semester,
        label,
        startsOn: startsOn ?? starts_on,
        endsOn: endsOn ?? ends_on,
        createdByUserId: req.user?.id ?? null,
      });
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(result.status).json({ message: "Academic period created.", period: result.data?.period });
    } catch (error) {
      console.error("[AcademicPeriodController.create]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid academic period id." });
        return;
      }
      const { schoolYear, school_year, semester, label, startsOn, starts_on, endsOn, ends_on } = req.body ?? {};
      const result = await updateAcademicPeriod(id, {
        schoolYear: schoolYear ?? school_year,
        semester,
        label,
        startsOn: startsOn ?? starts_on,
        endsOn: endsOn ?? ends_on,
      });
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(result.status).json({ message: "Academic period updated.", period: result.data?.period });
    } catch (error) {
      console.error("[AcademicPeriodController.update]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async activate(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      const userId = req.user?.id;
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid academic period id." });
        return;
      }
      if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const result = await activateAcademicPeriod(id, userId);
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(result.status).json({
        message: "Academic period activated.",
        period: result.data?.period,
      });
    } catch (error) {
      console.error("[AcademicPeriodController.activate]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async remove(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid academic period id." });
        return;
      }
      const result = await deleteAcademicPeriod(id);
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json({ message: "Academic period deleted." });
    } catch (error) {
      console.error("[AcademicPeriodController.remove]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
