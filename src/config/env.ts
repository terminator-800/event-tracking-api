import dotenv from "dotenv";

dotenv.config();

const requiredVars = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"];

requiredVars.forEach((varName) => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

export const env = {
  port: Number(process.env.PORT || 5000),
  dbHost: process.env.DB_HOST as string,
  dbPort: Number(process.env.DB_PORT),
  dbUser: process.env.DB_USER as string,
  dbPassword: process.env.DB_PASSWORD || "",
  dbName: process.env.DB_NAME as string,
  adminUsername: process.env.ADMIN_USERNAME as string,
  adminPassword: process.env.ADMIN_PASSWORD as string,
  jwtSecret: process.env.JWT_SECRET as string,
  // jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
};
