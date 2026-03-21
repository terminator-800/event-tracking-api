import bcrypt from "bcrypt";
import { pool } from "../config/db";
import { env } from "../config/env"
import { UserRepository } from "../repositories/users.repository";

const userRepository = new UserRepository();

async function seedAdmin(): Promise<void> {

  const hashedPassword = await bcrypt.hash(env.adminPassword, 10);

  await userRepository.insertAdmin(env.adminUsername, hashedPassword);

  console.log("Admin user seeded successfully");
  process.exit(0);
}

void seedAdmin();