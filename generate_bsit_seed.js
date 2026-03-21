const fs = require('fs');

// Simple CSV parser
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

// Read CSV file
const csvContent = fs.readFileSync('BSIT.csv', 'utf-8');
let records = parseCSV(csvContent);

// Remove duplicate student IDs - prefer ones WITHOUT -1 in enrollment_ref
const studentMap = {};
records.forEach(record => {
  const studentId = record['ID Number'];
  const enrollmentRef = record['Name'];
  
  if (!studentMap[studentId]) {
    studentMap[studentId] = record;
  } else {
    // If current record has no -1 and existing has -1, replace
    // Otherwise keep the existing one
    const hasHyphenOne = enrollmentRef.includes('-1');
    const existingHasHyphenOne = studentMap[studentId]['Name'].includes('-1');
    
    if (!hasHyphenOne && existingHasHyphenOne) {
      studentMap[studentId] = record;
    }
  }
});

const uniqueRecords = Object.values(studentMap);

console.log(`✅ Processing ${uniqueRecords.length} student records (removed duplicate IDs, prefer no -1)...`);
records = uniqueRecords;

// Start building SQL
let sql = `-- ============================================================
-- BSIT Complete Seed Data Script - ALL ${records.length} RECORDS
-- MySQL Workbench
-- Created: March 21, 2026
-- Description: Inserts data into departments, programs, 
--              students, and enrollments tables
-- ============================================================

SET FOREIGN_KEY_CHECKS=0;

-- ============================================================
-- 1. INSERT DEPARTMENTS
-- ============================================================
INSERT IGNORE INTO departments (name, code) VALUES
('College of Information Technology', 'CIT');

-- ============================================================
-- 2. INSERT PROGRAMS
-- ============================================================
INSERT IGNORE INTO programs (course_code, course_name, major, department_id) VALUES
('BSIT', 'Bachelor of Science in Information Technology', '', (SELECT id FROM departments WHERE code = 'CIT'));

-- ============================================================
-- 3. INSERT STUDENTS (${records.length} RECORDS)
-- ============================================================
INSERT INTO students (student_id, first_name, middle_name, last_name, email) VALUES
`;

// Track emails to handle duplicates - using lowercase for comparison
const emailCount = {};
const usedEmails = new Set();

// Add students
records.forEach((record, i) => {
  const studentId = record['ID Number'] ? record['ID Number'].replace(/'/g, "''") : '';
  const firstName = record['First Name'] ? record['First Name'].replace(/'/g, "''") : '';
  const middleName = record['Middle Name'] ? record['Middle Name'].replace(/'/g, "''") : '';
  const lastName = record['Last Name'] ? record['Last Name'].replace(/'/g, "''") : '';
  let email = record['Email'] ? record['Email'].trim() : `noemail_${i}@bsit.edu`;
  
  if (!email) email = `noemail_${i}@bsit.edu`;
  
  // Normalize email to lowercase for duplicate checking
  const emailLower = email.toLowerCase();
  
  // Handle duplicate emails with +suffix
  if (usedEmails.has(emailLower)) {
    // Email already used, add suffix
    if (!emailCount[emailLower]) {
      emailCount[emailLower] = 1;
    } else {
      emailCount[emailLower]++;
    }
    
    const [localPart, domain] = email.split('@');
    email = `${localPart}+${emailCount[emailLower]}@${domain}`;
  } else {
    // First occurrence of this email
    usedEmails.add(emailLower);
  }
  
  // Escape single quotes in email
  email = email.replace(/'/g, "''");
  
  const comma = i < records.length - 1 ? ',' : ';';
  sql += `\n('${studentId}', '${firstName}', '${middleName}', '${lastName}', '${email}')${comma}`;
});

// Add enrollments
sql += `

-- ============================================================
-- 4. INSERT ENROLLMENTS (${records.length} RECORDS)
-- ============================================================
INSERT INTO enrollments (enrollment_ref, student_id, program_id, school_year, semester, year_level) VALUES
`;

const yearMap = {
  'First Year': 1,
  'Second Year': 2,
  'Third Year': 3,
  'Fourth Year': 4
};

records.forEach((record, i) => {
  const enrollmentRef = record['Name'] ? record['Name'].replace(/'/g, "''") : '';
  const studentId = record['ID Number'] ? record['ID Number'].replace(/'/g, "''") : '';
  const schoolYear = record['School Year'] ? record['School Year'].replace(/'/g, "''") : 'SY2025-2026';
  const yearStr = record['Year'] ? record['Year'].trim() : 'First Year';
  const yearLevel = yearMap[yearStr] || 1;
  
  const comma = i < records.length - 1 ? ',' : ';';
  sql += `\n('${enrollmentRef}', (SELECT id FROM students WHERE student_id = '${studentId}'), (SELECT id FROM programs WHERE course_code = 'BSIT'), '${schoolYear}', '2nd sem', ${yearLevel})${comma}`;
});

// Add closing
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

// Create seeds directory if it doesn't exist
if (!fs.existsSync('seeds')) {
  fs.mkdirSync('seeds');
}

// Write to file
fs.writeFileSync('seeds/bsit_complete_seed_all.sql', sql, 'utf-8');

console.log(`✅ Complete seed script generated!`);
console.log(`📊 Total records: ${records.length} students`);
console.log(`📁 File: seeds/bsit_complete_seed_all.sql`);
const fileSize = fs.statSync('seeds/bsit_complete_seed_all.sql').size / 1024 / 1024;
console.log(`📏 File size: ${fileSize.toFixed(2)} MB`);
