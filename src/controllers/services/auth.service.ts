import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserRepository } from "../../repositories/users.repository";
import { env } from "../../config/env";
import { Response } from "express";

const userRepository = new UserRepository();

export async function verifyUserCredentials(
  username: string,
  password: string
): Promise<{ id: number; username: string; role: string, department_id: number | null } | null> {
  
  const user = await userRepository.findByUsername(username);
  if (!user) return null;

  const match = await bcrypt.compare(password, user.password);
  if (!match) return null;

  return user;
}

export function generateAuthToken(user: { id: number; username: string; role: string; department_id?: number | null }) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, department_id: user.department_id ?? null },
    env.jwtSecret,
    { expiresIn: "7d" }
  );
}

export function generateDepartmentToken(department: { department_id: number; department_name: string; department_code: string }) {
  console.log("generateDepartmentToken payload:", department);
  return jwt.sign(
    { 
      department_id: department.department_id,
      department_name: department.department_name,
      department_code: department.department_code
    },
    env.jwtSecret,
    { expiresIn: "7d" }
  );
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}