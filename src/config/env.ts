import dotenv from "dotenv";
import fs from "fs";
import path from "path";

/**
 * Prefer `.env` in production; fall back to `.env.development`.
 * cPanel/LiteSpeed often sets NODE_ENV=production but may only ship one file.
 */
function loadEnvFile(): void {
  const candidates =
    process.env.NODE_ENV === "production"
      ? [".env", ".env.development"]
      : [".env.development", ".env"];

  for (const file of candidates) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath });
      return;
    }
  }

  dotenv.config();
}

loadEnvFile();

const requiredVars = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"];

requiredVars.forEach((varName) => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

export const env = {
  port: Number(process.env.PORT),
  dbHost: process.env.DB_HOST as string,
  dbPort: Number(process.env.DB_PORT),
  dbUser: process.env.DB_USER as string,
  dbPassword: process.env.DB_PASSWORD || "",
  dbName: process.env.DB_NAME as string,
  adminUsername: process.env.ADMIN_USERNAME as string,
  adminPassword: process.env.ADMIN_PASSWORD as string,
  superAdminUsername: process.env.SUPER_ADMIN_USERNAME as string,
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD as string,
  jwtSecret: process.env.JWT_SECRET as string,
  csg_client: process.env.CSG_CLIENT as string,
  // jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
};
