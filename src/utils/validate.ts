import { Response } from "express";

export function validateRequiredFields(
  fields: Record<string, any>,
  res: Response
): boolean {
  const missing = Object.entries(fields).some(([, value]) => !value);
  if (missing) {
    res.status(400).json({ message: "All fields are required" });
    return false;
  }
  return true;
}