// types/express.ts
export type Role =
  | "super_admin"
  | "admin"
  | "csg_president"
  | "it_governor"
  | "cba_governor"
  | "ceas_governor"
  | "coc_governor"
  | "chm_governor";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        full_name?: string | null;
        role: Role;
        department_id?: number | null;
        department_name?: string | null;
        department_code?: string | null;
      };
    }
  }
}

export {};
