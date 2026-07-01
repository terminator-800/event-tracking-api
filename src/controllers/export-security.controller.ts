import { Request, Response } from "express";
import {
  getExportSettings,
  setExportPassword,
  toggleExportProtection,
  getExportKeyForClient,
  verifyExportFingerprint,
} from "./services/export-security.service";

export class ExportSecurityController {
  async getSettings(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await getExportSettings();
      res.status(200).json(settings);
    } catch (error) {
      console.error("[ExportSecurity.getSettings]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async setPassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: "Unauthorized." });
        return;
      }

      const { password } = req.body ?? {};
      if (!password || typeof password !== "string" || password.trim().length < 4) {
        res.status(400).json({ message: "Password must be at least 4 characters." });
        return;
      }

      await setExportPassword(password.trim(), userId);
      res.status(200).json({ message: "Export password set successfully. Protection is now enabled." });
    } catch (error) {
      console.error("[ExportSecurity.setPassword]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async toggle(req: Request, res: Response): Promise<void> {
    try {
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") {
        res.status(400).json({ message: "enabled (boolean) is required." });
        return;
      }
      const result = await toggleExportProtection(enabled);
      if (!result.success) {
        res.status(400).json({ message: result.message });
        return;
      }
      res.status(200).json({ message: `Export password protection ${enabled ? "enabled" : "disabled"}.` });
    } catch (error) {
      console.error("[ExportSecurity.toggle]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  /** Returns the plain-text password for client-side PDF encryption. Protected endpoint. */
  async getExportKey(_req: Request, res: Response): Promise<void> {
    try {
      const password = await getExportKeyForClient();
      res.status(200).json({ password });
    } catch (error) {
      console.error("[ExportSecurity.getExportKey]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async verifyFile(req: Request, res: Response): Promise<void> {
    try {
      const { fingerprint } = req.body ?? {};
      if (typeof fingerprint !== "string") {
        res.status(400).json({ message: "fingerprint (string) is required." });
        return;
      }
      const result = await verifyExportFingerprint(fingerprint);
      res.status(200).json(result);
    } catch (error) {
      console.error("[ExportSecurity.verifyFile]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
