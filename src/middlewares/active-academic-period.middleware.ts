import type { Request, Response, NextFunction } from "express";
import { getActiveAcademicPeriod } from "../repositories/academic-periods.repository";
import type { AcademicPeriodRow } from "../repositories/queries/academic-periods.queries";

declare global {
  namespace Express {
    interface Request {
      activeAcademicPeriod?: AcademicPeriodRow | null;
    }
  }
}

/**
 * Operational writes require an active school year + semester.
 * Attaches `req.activeAcademicPeriod` for automatic stamping.
 */
export async function requireActiveAcademicPeriod(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const active = await getActiveAcademicPeriod();
  if (!active) {
    res.status(403).json({
      message:
        "No active school year and semester. Ask the super admin to activate an academic period before continuing.",
    });
    return;
  }

  req.activeAcademicPeriod = active;
  next();
}

/** Attach active period when present (reads). Does not block. */
export async function attachActiveAcademicPeriod(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  req.activeAcademicPeriod = await getActiveAcademicPeriod();
  next();
}
