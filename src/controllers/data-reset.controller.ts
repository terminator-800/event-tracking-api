import { Request, Response } from "express";
import {
  DATA_RESET_CONFIRMATION_PHRASE,
  executeDataReset,
  getDataResetPreview,
} from "./services/data-reset.service";

export class DataResetController {
  async preview(_req: Request, res: Response): Promise<void> {
    try {
      const counts = await getDataResetPreview();
      res.status(200).json({ counts });
    } catch (error) {
      console.error("[DataResetController.preview]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async reset(req: Request, res: Response): Promise<void> {
    try {
      const confirmation = String(req.body?.confirmation ?? "").trim();
      if (confirmation !== DATA_RESET_CONFIRMATION_PHRASE) {
        res.status(400).json({
          message: `Confirmation must be exactly "${DATA_RESET_CONFIRMATION_PHRASE}".`,
        });
        return;
      }

      const result = await executeDataReset();
      res.status(200).json({
        message: "All data has been reset. Admin account(s) were kept.",
        deleted: result.deleted,
      });
    } catch (error) {
      console.error("[DataResetController.reset]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
