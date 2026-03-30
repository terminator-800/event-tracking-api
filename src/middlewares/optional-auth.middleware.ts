import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Optional auth middleware:
 * - If `token` cookie is present and valid, attaches `req.user`.
 * - If missing/invalid, continues without blocking (used for public endpoints).
 */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token;
  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as Express.Request["user"];
    req.user = decoded;
  } catch {
    // Intentionally ignore invalid/expired tokens for "optional" endpoints.
  }

  next();
}

