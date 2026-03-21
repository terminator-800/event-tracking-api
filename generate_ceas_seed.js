const fs = require('fs');

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
// 2️⃣ Read CSV
// ---------------------------
const csvContent = fs.readFileSync('CEAS.csv', 'utf-8');
let records = parseCSV(csvContent);

// ---------------------------
// 3️⃣ Remove duplicate student IDs (prefer no -1/-2)
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
console.log(`✅ Processing ${records.length} unique student records...`);

// ---------------------------
// 4️⃣ Build unique programs (Course + Major)
// ---------------------------
const programMap = {}; // key = Course||Major
records.forEach(record => {
  const course = record['Course'].trim();
  const major = record['Major'] ? record['Major'].trim() : '';
  const deptCode = 'CEAS'; // hardcode department code

  const key = `${course}||${major}`;
  if (!programMap[key]) {
    programMap[key] = { course, major, deptCode };
  }
});

// Helper function to generate full course_name for programs/enrollments
function progName(course, major) {
  if (course.startsWith('BSED')) {
    return major ? `Bachelor of Secondary Education Major in ${major}` : 'Bachelor of Secondary Education';
  } else if (course.startsWith('BEED')) {
    return major ? `Bachelor of Elementary Education Major in ${major}` : 'Bachelor of Elementary Education';
  } else {
    return course;
  }
}

// ---------------------------
// 5️⃣ Start SQL
// ---------------------------
let sql = `-- ============================================================
-- CEAS Complete Seed Data Script - ALL ${records.length} STUDENTS
-- MySQL Workbench
-- Created: March 21, 2026
-- ============================================================

SET FOREIGN_KEY_CHECKS=0;

-- ============================================================
-- 1. INSERT DEPARTMENTS
-- ============================================================
INSERT IGNORE INTO departments (name, code) VALUES
('College of Teacher Education', 'CEAS');

`;

// ---------------------------
// 6️⃣ Insert Programs
// ---------------------------
sql += `-- ============================================================
-- 2. INSERT PROGRAMS
-- ============================================================
INSERT INTO programs (course_code, course_name, major, department_id) VALUES
`;

Object.values(programMap).forEach((prog, i, arr) => {
  const comma = i < arr.length - 1 ? ',' : ';';

  // Map course_code
  let courseCode = '';
  if (prog.course.startsWith('BSED')) courseCode = 'BSED';
  else if (prog.course.startsWith('BEED')) courseCode = 'BEED';
  else courseCode = prog.course;

  sql += `('${courseCode}', '${progName(prog.course, prog.major)}', '${prog.major}', (SELECT id FROM departments WHERE code = '${prog.deptCode}'))${comma}\n`;
});

// ---------------------------
// 7️⃣ Insert Students
// ---------------------------
sql += `\n-- ============================================================
-- 3. INSERT STUDENTS (${records.length})
-- ============================================================
INSERT INTO students (student_id, first_name, middle_name, last_name, email) VALUES
`;

const emailCount = {};
const usedEmails = new Set();

records.forEach((record, i) => {
  const studentId = record['ID Number'] ? record['ID Number'].replace(/'/g, "''") : '';
  const firstName = record['First Name'] ? record['First Name'].replace(/'/g, "''") : '';
  const middleName = record['Middle Name'] ? record['Middle Name'].replace(/'/g, "''") : '';
  const lastName = record['Last Name'] ? record['Last Name'].replace(/'/g, "''") : '';
  let email = record['Email'] ? record['Email'].trim() : `noemail_${i}@ceas.edu`;
  if (!email) email = `noemail_${i}@ceas.edu`;

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

  const comma = i < records.length - 1 ? ',' : ';';
  sql += `('${studentId}', '${firstName}', '${middleName}', '${lastName}', '${email}')${comma}\n`;
});

// ---------------------------
// 8️⃣ Insert Enrollments
// ---------------------------
const yearMap = {
  'First Year': 1,
  'Second Year': 2,
  'Third Year': 3,
  'Fourth Year': 4
};

sql += `\n-- ============================================================
-- 4. INSERT ENROLLMENTS (${records.length})
-- ============================================================
INSERT INTO enrollments (enrollment_ref, student_id, program_id, school_year, semester, year_level) VALUES
`;

records.forEach((record, i) => {
  const enrollmentRef = record['Name'] ? record['Name'].replace(/'/g, "''") : '';
  const studentId = record['ID Number'] ? record['ID Number'].replace(/'/g, "''") : '';
  const schoolYear = record['School Year'] ? record['School Year'].replace(/'/g, "''") : 'SY2025-2026';
  const yearStr = record['Year'] ? record['Year'].trim() : 'First Year';
  const yearLevel = yearMap[yearStr] || 1;

  const course = record['Course'].trim();
  const major = record['Major'] ? record['Major'].trim() : '';

  const comma = i < records.length - 1 ? ',' : ';';
  sql += `('${enrollmentRef}', (SELECT id FROM students WHERE student_id = '${studentId}'), (SELECT id FROM programs WHERE course_name = '${progName(course, major)}'), '${schoolYear}', '2nd sem', ${yearLevel})${comma}\n`;
});

// ---------------------------
// 9️⃣ Finish
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
// 🔟 Write to file
// ---------------------------
if (!fs.existsSync('seeds')) fs.mkdirSync('seeds');
fs.writeFileSync('seeds/ceas_complete_seed_all.sql', sql, 'utf-8');

console.log(`✅ Complete seed script generated!`);
console.log(`📊 Total students: ${records.length}`);
console.log(`📁 File: seeds/ceas_complete_seed_all.sql`);
const fileSize = fs.statSync('seeds/ceas_complete_seed_all.sql').size / 1024 / 1024;
console.log(`📏 File size: ${fileSize.toFixed(2)} MB`);