import { createDepartmentsTable } from "./departments.model";
import { createProgramsTable } from "./programs.model";
import { createStudentsTable } from "./students.models";
import {createEnrollmentsTable } from './enrollments.model';
import { createUsersTable } from "./users.model";
import { createEventAudiencesTable } from './event_audiences.model';
import { createEventsTable } from './events.model';

export async function createTables(): Promise<void> {
  await createDepartmentsTable();    // no deps
  await createStudentsTable();       // no deps
  await createProgramsTable();       // depends on departments
  await createEnrollmentsTable();    // depends on students, programs
  await createUsersTable();          // depends on students, departments, programs
  await createEventsTable();         // depends on users
  await createEventAudiencesTable(); //
}