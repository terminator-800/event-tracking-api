import { Request, Response, NextFunction } from "express";
import { Role } from "../types/express";

export function roleMiddleware(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Access denied." });
      return;
    }

    next();
  };
}