import { createDepartmentsTable } from "./departments.model";
import { createProgramsTable } from "./programs.model";
import { createStudentsTable } from "./students.models";
import { createUsersTable } from "./users.model";
import { createAcademicPeriodsTable } from "./academic_periods.model";
import { createEnrollmentsTable } from './enrollments.model';
import { createEventAudiencesTable } from './event_audiences.model';
import { createEventsTable } from './events.model';
import { createAttendanceTable } from './attendance.model'; 
import { createFinesTable } from './fines.models';            
import { createPaymentTransactionsTable } from "./payment_transactions.model";
import { createPaymentsTable } from "./payments.model";
import { createFineAdjustmentsTable } from "./fine_adjustments.model";
import { createSystemExportSettingsTable } from "./system-export-settings.model";
import { createExportAuditLogTable } from "./export-audit-log.model";
import { createRolePermissionsTable } from "./role_permissions.model";

export async function createTables(): Promise<void> {
  await createDepartmentsTable();           // no deps
  await createStudentsTable();              // no deps
  await createProgramsTable();              // depends on departments
  await createUsersTable();                 // depends on students, departments, programs
  await createAcademicPeriodsTable();       // depends on users
  await createEnrollmentsTable();           // depends on students, programs, academic_periods
  await createEventsTable();                // depends on users, academic_periods
  await createEventAudiencesTable();        // depends on events, departments, programs
  await createAttendanceTable();            // depends on students, events
  await createFinesTable();                 // depends on students, events, attendance
  await createPaymentTransactionsTable();   // depends on students, users
  await createPaymentsTable();              // depends on students, fines, users, payment_transactions
  await createFineAdjustmentsTable();       // depends on fines, users
  await createSystemExportSettingsTable();  // depends on users
  await createExportAuditLogTable();        // depends on users
  await createRolePermissionsTable();       // RBAC matrix
}