import bcrypt from "bcrypt";
import { env } from "../config/env";
import { UserRepository } from "../repositories/users.repository";

const userRepository = new UserRepository();

export async function ensureDefaultAdmin(): Promise<void> {
  const hasAdmin = await userRepository.hasAdminUser();
  if (hasAdmin) return;

  if (!env.adminUsername || !env.adminPassword) {
    console.warn(
      "No admin user found and ADMIN_USERNAME/ADMIN_PASSWORD are not set; skipping admin bootstrap.",
    );
    return;
  }

  const hashedPassword = await bcrypt.hash(env.adminPassword, 10);
  await userRepository.insertAdmin(env.adminUsername, hashedPassword);
  console.log("Default admin user created.");
}
