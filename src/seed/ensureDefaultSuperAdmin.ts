import bcrypt from "bcrypt";
import { env } from "../config/env";
import { UserRepository } from "../repositories/users.repository";

const userRepository = new UserRepository();

export async function ensureDefaultSuperAdmin(): Promise<void> {
  const hasSuperAdmin = await userRepository.hasSuperAdminUser();
  if (hasSuperAdmin) return;

  if (!env.superAdminUsername || !env.superAdminPassword) {
    console.warn(
      "No super_admin user found and SUPER_ADMIN_USERNAME/SUPER_ADMIN_PASSWORD are not set; skipping super admin bootstrap.",
    );
    return;
  }

  const hashedPassword = await bcrypt.hash(env.superAdminPassword, 10);
  await userRepository.insertSuperAdmin(env.superAdminUsername, hashedPassword);
  console.log("Default super admin user created.");
}
