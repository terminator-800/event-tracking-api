import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserRepository } from "../repositories/users.repository";
import { validateRequiredFields } from '../utils/validate'
import { env } from "../config/env";

const userRepository = new UserRepository();

export class AuthController {
    
   async login(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body;

    if (!validateRequiredFields({ username, password }, res)) return;

    const user = await userRepository.findByUsername(username);

    if (!user) {
      res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      env.jwtSecret,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  }

  async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie("token");
    res.status(200).json({ message: "Logged out successfully" });
  }

  async me(req: Request, res: Response): Promise<void> {
    const user = req.user;
    res.status(200).json({ user });
  }
}