import { createDepartmentsTable } from "./department.model";
import { createProgramsTable } from "./program.model";
import { createStudentsTable } from "./students.models";
import {createEnrollmentsTable } from './enrollments.model';

export async function createTables(): Promise<void> {
  await createDepartmentsTable();
  await createProgramsTable();
  await createStudentsTable();
  await createEnrollmentsTable();
}