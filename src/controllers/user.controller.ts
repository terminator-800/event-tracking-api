// controllers/user.controller.ts

import { Request, Response } from "express";
import { validateRequiredFields } from '../utils/validate';
import { createUser } from './services/user.service'

export class UserController {

  async createUser(req: Request, res: Response): Promise<void> {
    try {

      const { department, email, major, password, role, username } = req.body;

      if (!validateRequiredFields({ email, password, role, username }, res)) return;

      const result = await createUser({ department, email, major, password, role, username });

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
}