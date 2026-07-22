import { Request, Response } from "express";
import {
  getPermissionsForRole,
  getRolePermissionMatrix,
  saveRolePermissionMatrix,
} from "./services/rbac.service";

export class RbacController {
  async myPermissions(req: Request, res: Response): Promise<void> {
    try {
      const role = String(req.user?.role ?? "");
      if (!role) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const permissions = await getPermissionsForRole(role);
      res.status(200).json({ role, permissions });
    } catch (error) {
      console.error("[RbacController.myPermissions]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async getMatrix(req: Request, res: Response): Promise<void> {
    try {
      const data = await getRolePermissionMatrix();
      res.status(200).json(data);
    } catch (error) {
      console.error("[RbacController.getMatrix]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async saveMatrix(req: Request, res: Response): Promise<void> {
    try {
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      const result = await saveRolePermissionMatrix(updates);
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json({ message: "Role permissions saved." });
    } catch (error) {
      console.error("[RbacController.saveMatrix]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
