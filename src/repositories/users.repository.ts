import { pool } from "../config/db";
import { UserQueries } from "./queries/users.queries";

export class UserRepository {
    async insertAdmin(
        username: string,
        hashedPassword: string,
    ): Promise<void> {
        await pool.execute(UserQueries.insertAdmin, [username, hashedPassword]);
    }

    async findByUsername(username: string): Promise<any> {
        const [rows]: any = await pool.execute(UserQueries.findByUsername, [username]);
        return rows[0] || null;
    }
}