import { ensureDefaultAdmin } from "./ensureDefaultAdmin";

async function seedAdmin(): Promise<void> {
  try {
    await ensureDefaultAdmin();
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed admin:", error);
    process.exit(1);
  }
}

void seedAdmin();
