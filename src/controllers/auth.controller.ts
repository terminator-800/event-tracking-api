import { Request, Response } from "express";
import { validateRequiredFields } from '../utils/validate'
import { verifyUserCredentials, generateAuthToken, setAuthCookie, generateDepartmentToken } from './services/auth.service'
import { pool } from '../config/db';

export class AuthController {
    
async login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!validateRequiredFields({ username, password }, res)) return;

    const user = await verifyUserCredentials(username, password);

    if (!user) {
      res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    const token = generateAuthToken(user);
    setAuthCookie(res, token);

    res.status(200).json({
      message: "Login successful",
    });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}

async departmentSignIn(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!validateRequiredFields({ username, password }, res)) return;

    const user = await verifyUserCredentials(username, password);

    if (!user) {
      res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    if (!user.department_id) {
      res.status(403).json({ message: "This account has no associated department." });
      return;
    }

    const [rows]: any = await pool.execute(
      `SELECT id, name, code FROM departments WHERE id = ? LIMIT 1`,
      [user.department_id]
    );
    console.log("department rows:", rows); // add this
    if (!rows.length) {
      res.status(404).json({ message: "Department not found." });
      return;
    }

    const department = rows[0];

    // Defense-in-depth: ensure the department selected on the homepage matches
    // the department assigned to the authenticated user.
    //
    // Frontend sends (depending on view):
    // - departmentKey: e.g. "CHM"
    // - department_code / departmentCode: e.g. "CHM"
    // - department / department_name: display strings
    // We validate against `departments.code` because that matches the home keys.
    const expectedDepartmentCodeRaw =
      req.body.departmentKey ??
      req.body.department_code ??
      req.body.departmentCode ??
      req.body.department ??
      null;

    const expectedDepartmentCode = expectedDepartmentCodeRaw != null ? String(expectedDepartmentCodeRaw).trim().toUpperCase() : null;

    if (expectedDepartmentCode) {
      const actualDepartmentCode = String(department.code).trim().toUpperCase();
      if (expectedDepartmentCode !== actualDepartmentCode) {
        res.status(403).json({ message: "This account is not authorized for the selected department." });
        return;
      }
    }

    const token = generateDepartmentToken({
      id: user.id,
      username: user.username,
      role: user.role,
      department_id: Number(department.id),
      department_name: String(department.name),
      department_code: String(department.code),
    });

    setAuthCookie(res, token);

    res.status(200).json({
      message: "Login successful",
      department: {
        department_id: department.id,
        department_name: department.name,
        department_code: department.code,
      },
    });
  } catch (error) {
    console.error("Error in departmentSignIn:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}

async logout(_req: Request, res: Response): Promise<void> {
  res.clearCookie("token");
  res.status(200).json({ message: "Logged out successfully" });
}

async me(req: Request, res: Response): Promise<void> {
  const user = req.user;
  res.status(200).json({ user });
}

async departmentMe(req: Request, res: Response): Promise<void> {
  try {
    const departmentId = req.user?.department_id;

    if (!departmentId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [rows]: any = await pool.execute(
      `SELECT id, name, code FROM departments WHERE id = ? LIMIT 1`,
      [departmentId]
    );

    if (!rows.length) {
      res.status(404).json({ message: "Department not found." });
      return;
    }

    res.status(200).json({ department: rows[0] });
  } catch (error) {
    console.error("Error in departmentMe:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}
}