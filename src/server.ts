import app from "./app";
import { env } from "./config/env";
import { testDatabaseConnection } from "./config/db";
import { createTables } from "./models/index";
import { registerEventStatusCron } from "./cron/event.status.updater";
import { ensureDefaultAdmin } from "./seed/ensureDefaultAdmin";

async function startServer(): Promise<void> {
  try {
    await testDatabaseConnection();
    await createTables();
    console.log("MySQL connected successfully");

    await ensureDefaultAdmin();

    registerEventStatusCron();

    app.listen(env.port, () => {
      console.log(`Server running at http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

void startServer();
