import app from "./app";
import { env } from "./config/env";
import { testDatabaseConnection } from "./config/db";

async function startServer(): Promise<void> {
  try {
    await testDatabaseConnection();
    console.log("MySQL connected successfully");

    app.listen(env.port, () => {
      console.log(`Server running at http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

void startServer();
