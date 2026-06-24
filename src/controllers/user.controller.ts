// controllers/user.controller.ts

import { Request, Response } from "express";
import { validateRequiredFields } from '../utils/validate';
import { createUser, deleteUserById, listUsers, updateUserById } from './services/user.service'
import { importStudentsCsv } from "./services/import-students-csv.service";

export class UserController {

  async createUser(req: Request, res: Response): Promise<void> {
    try {

      const { department, fullName, major, password, role, username } = req.body;

      if (!validateRequiredFields({ fullName, password, role, username }, res)) return;

      const result = await createUser({
        department,
        fullName: String(fullName).trim(),
        major,
        password,
        role,
        username,
      });

      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }

      res.status(201).json({
        message: "User created successfully.",
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async listUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await listUsers();
      res.status(200).json({ users });
    } catch (error) {
      console.error("Error listing users:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid user id." });
        return;
      }
      const { fullName, username, password } = req.body ?? {};
      const result = await updateUserById(id, {
        fullName: fullName !== undefined ? String(fullName).trim() : undefined,
        username: username ? String(username).trim() : undefined,
        password: password ? String(password) : undefined,
      });
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json({ message: "User updated successfully." });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid user id." });
        return;
      }
      const result = await deleteUserById(id);
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json({ message: "User deleted successfully." });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async importStudentsCsv(req: Request, res: Response): Promise<void> {
    try {
      const file = (req as Request & { file?: { buffer?: Buffer } }).file;
      if (!file || !file.buffer) {
        res.status(400).json({ message: "CSV file is required." });
        return;
      }

      const result = await importStudentsCsv(file.buffer);
      res.status(200).json({
        message: "CSV import completed.",
        ...result,
      });
    } catch (error) {
      console.error("Error importing students CSV:", error);
      res.status(500).json({ message: "Internal server error while importing CSV." });
    }
  }
}