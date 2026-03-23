const fs = require('fs');
const path = require('path');

// ---------------------------
// 1️⃣ Simple CSV parser
// ---------------------------
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] || '';
    });
    records.push(record);
  }

  return records;
}

// ---------------------------
// 2️⃣ Configuration for CSVs
// ---------------------------
const csvFiles = [
  { file: 'CEAS.csv', deptCode: 'CEAS', deptName: 'College of Education, Arts and Sciences'},
  { file: 'BSIT.csv', deptCode: 'CIT', deptName: 'College of Information Technology' },
  { file: 'BSCRIM.csv', deptCode: 'COC', deptName: 'College of Criminology' },
  { file: 'HM.csv', deptCode: 'CHM', deptName: 'College of Hospitality Management' },
  { file: 'BSBA.csv', deptCode: 'CBA', deptName: 'College of Business Administration' },
];

const allRecords = [];
const programMap = {}; // key = Course||Major||Dept
const departmentMap = {}; // track inserted departments

csvFiles.forEach(({ file, deptCode, deptName }) => {
  const content = fs.readFileSync(path.join(file), 'utf-8');
  let records = parseCSV(content);

  // ---------------------------
  // Remove duplicate student IDs
  // ---------------------------
  const studentMap = {};
  records.forEach(record => {
    const studentId = record['ID Number'];
    const enrollmentRef = record['Name'];

    if (!studentMap[studentId]) {
      studentMap[studentId] = record;
    } else {
      const hasHyphenOne = enrollmentRef.includes('-1') || enrollmentRef.includes('-2');
      const existingHasHyphenOne = studentMap[studentId]['Name'].includes('-1') || studentMap[studentId]['Name'].includes('-2');
      if (!hasHyphenOne && existingHasHyphenOne) {
        studentMap[studentId] = record;
      }
    }
  });

  records = Object.values(studentMap);
  allRecords.push(...records);

  // ---------------------------
  // Build unique programs
  // ---------------------------
  records.forEach(record => {
    const course = record['Course'].trim();
    const major = record['Major'] ? record['Major'].trim() : '';
    const key = `${course}||${major}||${deptCode}`;
    if (!programMap[key]) {
      programMap[key] = { course, major, deptCode };
    }
  });

  // Track departments
  departmentMap[deptCode] = deptName;
});

console.log(`✅ Processing ${allRecords.length} unique student records across ${csvFiles.length} departments...`);

// ---------------------------
// Helper function for course_name
// ---------------------------
function progName(course, major) {
  if (course.startsWith('BSED')) {
    return major ? `Bachelor of Secondary Education Major in ${major}` : 'Bachelor of Secondary Education';
  } else if (course.startsWith('BEED')) {
    return major ? `Bachelor of Elementary Education Major in ${major}` : 'Bachelor of Elementary Education';
  } else if (course.startsWith('BSIT')) {
    return 'Bachelor of Science in Information Technology';
  } else if (course.startsWith('BSCRIM')) {
    return 'Bachelor of Science in Criminology';
  } else if (course.startsWith('BSHM')) {
    return 'Bachelor of Science in Hospitality Management';
  } else if (course.startsWith('BSBA')) {
    return major ? `BSBA ${major}` : 'BSBA';
  } else {
    return course;
  }
}

// ---------------------------
// 3️⃣ Start SQL
// ---------------------------
let sql = `-- ============================================================
-- Complete Seed Data Script - ALL STUDENTS
-- MySQL Workbench
-- Created: March 21, 2026
-- ============================================================

SET FOREIGN_KEY_CHECKS=0;

-- ============================================================
-- 1. INSERT DEPARTMENTS
-- ============================================================
INSERT IGNORE INTO departments (name, code) VALUES
`;

Object.entries(departmentMap).forEach(([code, name], i, arr) => {
  const comma = i < arr.length - 1 ? ',' : ';';
  sql += `('${name}', '${code}')${comma}\n`;
});

// ---------------------------
// 4️⃣ Insert Programs
// ---------------------------
sql += `\n-- ============================================================
-- 2. INSERT PROGRAMS
-- ============================================================\nINSERT INTO programs (course_code, course_name, major, department_id) VALUES\n`;

Object.values(programMap).forEach((prog, i, arr) => {
  const comma = i < arr.length - 1 ? ',' : ';';

  // --- Map course_code short
  let courseCode = prog.course;
  if (prog.course.startsWith('BSED')) courseCode = 'BSED';
  else if (prog.course.startsWith('BEED')) courseCode = 'BEED';
  else if (prog.course.startsWith('BSIT')) courseCode = 'BSIT';
  else if (prog.course.startsWith('BSCRIM')) courseCode = 'BSCRIM';
  else if (prog.course.startsWith('BSHM')) courseCode = 'BSHM';
  else if (prog.course.startsWith('BSBA')) courseCode = 'BSBA';

  sql += `('${courseCode}', '${progName(prog.course, prog.major)}', '${prog.major}', (SELECT id FROM departments WHERE code = '${prog.deptCode}'))${comma}\n`;
});

// ---------------------------
// 5️⃣ Insert Students
// ---------------------------
sql += `\n-- ============================================================
-- 3. INSERT STUDENTS (${allRecords.length})
-- ============================================================\nINSERT INTO students (student_id, first_name, middle_name, last_name, email) VALUES\n`;

const emailCount = {};
const usedEmails = new Set();

allRecords.forEach((record, i) => {
  const studentId = record['ID Number'] ? record['ID Number'].replace(/'/g, "''") : '';
  const firstName = record['First Name'] ? record['First Name'].replace(/'/g, "''") : '';
  const middleName = record['Middle Name'] ? record['Middle Name'].replace(/'/g, "''") : '';
  const lastName = record['Last Name'] ? record['Last Name'].replace(/'/g, "''") : '';
  let email = record['Email'] ? record['Email'].trim() : `noemail_${i}@example.edu`;
  if (!email) email = `noemail_${i}@example.edu`;

  const emailLower = email.toLowerCase();
  if (usedEmails.has(emailLower)) {
    if (!emailCount[emailLower]) emailCount[emailLower] = 1;
    else emailCount[emailLower]++;
    const [localPart, domain] = email.split('@');
    email = `${localPart}+${emailCount[emailLower]}@${domain}`;
  } else {
    usedEmails.add(emailLower);
  }
  email = email.replace(/'/g, "''");

  const comma = i < allRecords.length - 1 ? ',' : ';';
  sql += `('${studentId}', '${firstName}', '${middleName}', '${lastName}', '${email}')${comma}\n`;
});

// ---------------------------
// 6️⃣ Insert Enrollments
// ---------------------------
const yearMap = { 'First Year': 1, 'Second Year': 2, 'Third Year': 3, 'Fourth Year': 4 };

sql += `\n-- ============================================================
-- 4. INSERT ENROLLMENTS (${allRecords.length})
-- ============================================================\nINSERT INTO enrollments (enrollment_ref, student_id, program_id, school_year, semester, year_level) VALUES\n`;

allRecords.forEach((record, i) => {
  const enrollmentRef = record['Name'] ? record['Name'].replace(/'/g, "''") : '';
  const studentId = record['ID Number'] ? record['ID Number'].replace(/'/g, "''") : '';
  const schoolYear = record['School Year'] ? record['School Year'].replace(/'/g, "''") : 'SY2025-2026';
  const yearStr = record['Year'] ? record['Year'].trim() : 'First Year';
  const yearLevel = yearMap[yearStr] || 1;

  const course = record['Course'].trim();
  const major = record['Major'] ? record['Major'].trim() : '';

  const comma = i < allRecords.length - 1 ? ',' : ';';
  sql += `('${enrollmentRef}', (SELECT id FROM students WHERE student_id = '${studentId}'), (SELECT id FROM programs WHERE course_name = '${progName(course, major)}'), '${schoolYear}', '2nd sem', ${yearLevel})${comma}\n`;
});

// ---------------------------
// 7️⃣ Finish
// ---------------------------
sql += `
SET FOREIGN_KEY_CHECKS=1;

-- ============================================================
-- CONFIRMATION QUERIES
-- ============================================================
SELECT '✅ Seed Complete!' AS status;
SELECT COUNT(*) AS departments_count FROM departments;
SELECT COUNT(*) AS programs_count FROM programs;
SELECT COUNT(*) AS students_count FROM students;
SELECT COUNT(*) AS enrollments_count FROM enrollments;
`;

// ---------------------------
// 8️⃣ Write to file
// ---------------------------
if (!fs.existsSync('seeds')) fs.mkdirSync('seeds');
fs.writeFileSync('seeds/complete_seed_all_departments.sql', sql, 'utf-8');

console.log(`✅ Complete seed script generated!`);
console.log(`📊 Total students: ${allRecords.length}`);
console.log(`📁 File: seeds/complete_seed_all_departments.sql`);
const fileSize = fs.statSync('seeds/complete_seed_all_departments.sql').size / 1024 / 1024;
console.log(`📏 File size: ${fileSize.toFixed(2)} MB`);