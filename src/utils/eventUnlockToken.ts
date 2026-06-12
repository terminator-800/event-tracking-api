import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const EVENT_UNLOCK_TOKEN_PURPOSE = "attendance_unlock";
const EVENT_UNLOCK_EXPIRES_IN = "12h";

export interface EventUnlockTokenPayload {
  purpose: typeof EVENT_UNLOCK_TOKEN_PURPOSE;
  eventId: number;
}

export function signEventUnlockToken(eventId: number): string {
  return jwt.sign(
    { purpose: EVENT_UNLOCK_TOKEN_PURPOSE, eventId: Number(eventId) },
    env.jwtSecret,
    { expiresIn: EVENT_UNLOCK_EXPIRES_IN },
  );
}

export function verifyEventUnlockToken(token: string): EventUnlockTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as EventUnlockTokenPayload;
    if (decoded?.purpose !== EVENT_UNLOCK_TOKEN_PURPOSE) return null;
    if (!Number.isFinite(Number(decoded.eventId))) return null;
    return { purpose: EVENT_UNLOCK_TOKEN_PURPOSE, eventId: Number(decoded.eventId) };
  } catch {
    return null;
  }
}
