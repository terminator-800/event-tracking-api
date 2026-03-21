import { createDepartmentsTable } from "./departments.model";
import { createProgramsTable } from "./programs.model";
import { createStudentsTable } from "./students.models";
import {createEnrollmentsTable } from './enrollments.model';
import { createUsersTable } from "./users.model";

export async function createTables(): Promise<void> {
  await createDepartmentsTable();
  await createProgramsTable();
  await createStudentsTable();
  await createEnrollmentsTable();
  await createUsersTable(); 
}