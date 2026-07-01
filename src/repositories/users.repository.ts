import { pool } from "../config/db";
import { UserQueries } from "./queries/users.queries";

export class UserRepository {
    async insertAdmin(
        username: string,
        hashedPassword: string,
    ): Promise<void> {
        await pool.execute(UserQueries.insertAdmin, [username, hashedPassword]);
    }

    async insertSuperAdmin(
        username: string,
        hashedPassword: string,
    ): Promise<void> {
        await pool.execute(UserQueries.insertSuperAdmin, [username, hashedPassword]);
    }

    async findByUsername(username: string): Promise<any> {
        const [rows]: any = await pool.execute(UserQueries.findByUsername, [username]);
        return rows[0] || null;
    }

    async hasAdminUser(): Promise<boolean> {
        const [rows]: any = await pool.execute(UserQueries.hasAdminUser);
        return rows.length > 0;
    }

    async hasSuperAdminUser(): Promise<boolean> {
        const [rows]: any = await pool.execute(UserQueries.hasSuperAdminUser);
        return rows.length > 0;
    }
}