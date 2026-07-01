import { ensureDefaultSuperAdmin } from "./ensureDefaultSuperAdmin";

async function seedSuperAdmin(): Promise<void> {
  try {
    await ensureDefaultSuperAdmin();
    console.log("Super admin seed finished");
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed super admin:", error);
    process.exit(1);
  }
}

void seedSuperAdmin();
