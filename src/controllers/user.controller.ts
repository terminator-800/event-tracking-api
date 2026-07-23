// controllers/user.controller.ts

import { Request, Response } from "express";
import { validateRequiredFields } from '../utils/validate';
import { createUser, deleteUserById, getAuditLogs, getSuperAdminStats, listDepartments, listUsers, revealUserAccountPassword, updateUserById } from './services/user.service'
import { importStudentsCsv } from "./services/import-students-csv.service";

export class UserController {

  async createUser(req: Request, res: Response): Promise<void> {
    try {

      const { department, fullName, major, password, role, username } = req.body;

      if (!validateRequiredFields({ fullName, password, role, username }, res)) return;

      const result = await createUser({
        department: department != null ? String(department) : "",
        fullName: String(fullName).trim(),
        major: major != null ? String(major) : "",
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

  async listDepartments(_req: Request, res: Response): Promise<void> {
    try {
      const departments = await listDepartments();
      res.status(200).json({ departments });
    } catch (error) {
      console.error("Error listing departments:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await listUsers(req.user?.role);
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
      const { fullName, username, password, role, department } = req.body ?? {};
      const requesterRole = String(req.user?.role ?? "").toLowerCase();

      if (role !== undefined && requesterRole !== "super_admin") {
        res.status(403).json({ message: "Only super admin can change user roles." });
        return;
      }

      const result = await updateUserById(id, {
        fullName: fullName !== undefined ? String(fullName).trim() : undefined,
        username: username ? String(username).trim() : undefined,
        password: password ? String(password) : undefined,
        role: role !== undefined ? (String(role).trim().toLowerCase() as never) : undefined,
        department: department !== undefined ? String(department).trim() : undefined,
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

  async getSuperAdminStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = await getSuperAdminStats();
      res.status(200).json(stats);
    } catch (error) {
      console.error("Error fetching super admin stats:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async getAuditLogs(_req: Request, res: Response): Promise<void> {
    try {
      const logs = await getAuditLogs();
      res.status(200).json({ logs });
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async revealUserPassword(req: Request, res: Response): Promise<void> {
    try {
      if (String(req.user?.role ?? "").toLowerCase() !== "super_admin") {
        res.status(403).json({ message: "Access denied." });
        return;
      }
      const id = Number(req.params.id);
      const result = await revealUserAccountPassword(id);
      if (!result.success) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json({
        password: result.password ?? null,
        recoverable: Boolean(result.recoverable),
      });
    } catch (error) {
      console.error("Error revealing user password:", error);
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