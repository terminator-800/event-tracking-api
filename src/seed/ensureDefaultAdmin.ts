import bcrypt from "bcrypt";
import { env } from "../config/env";
import { UserRepository } from "../repositories/users.repository";

const userRepository = new UserRepository();

/**
 * Ensures at least one admin exists. Safe to call on every server start (no-op if admin already present).
 * Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD in env.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  if (await userRepository.hasAdminUser()) {
    console.log("[Bootstrap] Admin user already exists — skipping default admin seed.");
    return;
  }

  const username = String(env.adminUsername ?? "").trim();
  const password = env.adminPassword;

  if (!username || !password) {
    console.warn(
      "[Bootstrap] No admin user in database and ADMIN_USERNAME/ADMIN_PASSWORD are not set. " +
        "Set them in .env.development (or your deployment env) and restart, or run npm run seed:admin.",
    );
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await userRepository.insertAdmin(username, hashedPassword);
  console.log(`[Bootstrap] Default admin user created (username: ${username}).`);
}
