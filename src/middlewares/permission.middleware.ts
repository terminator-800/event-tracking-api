import { Request, Response, NextFunction } from "express";
import { roleHasPermission } from "../controllers/services/rbac.service";

/** Requires the authenticated user to hold the given permission key. */
export function permissionMiddleware(...permissionKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const role = String(req.user.role ?? "");
      if (role.toLowerCase() === "super_admin") {
        next();
        return;
      }
      for (const key of permissionKeys) {
        const ok = await roleHasPermission(role, key);
        if (ok) {
          next();
          return;
        }
      }
      res.status(403).json({ message: "Access denied." });
    } catch (error) {
      console.error("[permissionMiddleware]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };
}
