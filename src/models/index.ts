import { createDepartmentsTable } from "./departments.model";
import { createProgramsTable } from "./programs.model";
import { createStudentsTable } from "./students.models";
import { createEnrollmentsTable } from './enrollments.model';
import { createUsersTable } from "./users.model";
import { createEventAudiencesTable } from './event_audiences.model';
import { createEventsTable } from './events.model';
import { createAttendanceTable } from './attendance.model'; 
import { createFinesTable } from './fines.models';            

export async function createTables(): Promise<void> {
  await createDepartmentsTable();    // no deps
  await createStudentsTable();       // no deps
  await createProgramsTable();       // depends on departments
  await createEnrollmentsTable();    // depends on students, programs
  await createUsersTable();          // depends on students, departments, programs
  await createEventsTable();         // depends on users
  await createEventAudiencesTable(); // depends on events, departments, programs
  await createAttendanceTable();     // depends on students, events  👈 add
  await createFinesTable();          // depends on students, events, attendance  👈 add
}