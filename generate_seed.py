import csv
import os

# Read CSV file
csv_file = 'BSCRIM.csv'
sql_output = 'seeds/bscrim_complete_seed_all.sql'

# Read all records
students = []
enrollments = []

with open(csv_file, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        students.append(row)
        enrollments.append(row)

# Start building SQL
sql = """-- ============================================================
-- BSCRIM Complete Seed Data Script - ALL 986 RECORDS
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
('College of Criminology', 'COC');

-- ============================================================
-- 2. INSERT PROGRAMS
-- ============================================================
INSERT IGNORE INTO programs (course_code, course_name, major, department_id) VALUES
('BSCRIM', 'Bachelor of Science in Criminology', '', (SELECT id FROM departments WHERE code = 'COC'));

-- ============================================================
-- 3. INSERT STUDENTS (986 RECORDS)
-- ============================================================
INSERT INTO students (student_id, first_name, middle_name, last_name, email) VALUES
"""

# Add students
for i, student in enumerate(students):
    student_id = student['ID Number'].replace("'", "''")
    first_name = student['First Name'].replace("'", "''")
    middle_name = student['Middle Name'].replace("'", "''") if student['Middle Name'] else ''
    last_name = student['Last Name'].replace("'", "''")
    email = student['Email'].replace("'", "''").strip()
    
    # Handle duplicate emails
    if not email or email == '':
        email = f"noemail_{i}@bscrim.edu"
    
    comma = ',' if i < len(students) - 1 else ';'
    sql += f"\n('{student_id}', '{first_name}', '{middle_name}', '{last_name}', '{email}'){comma}"

# Add enrollments
sql += """

-- ============================================================
-- 4. INSERT ENROLLMENTS (986 RECORDS)
-- ============================================================
INSERT INTO enrollments (enrollment_ref, student_id, program_id, school_year, semester, year_level) VALUES
"""

for i, enrollment in enumerate(enrollments):
    enrollment_ref = enrollment['Name'].replace("'", "''")
    student_id = enrollment['ID Number'].replace("'", "''")
    school_year = enrollment['School Year'].replace("'", "''")
    
    # Extract year level
    year_str = enrollment['Year'].strip()
    year_map = {
        'First Year': 1,
        'Second Year': 2,
        'Third Year': 3,
        'Fourth Year': 4
    }
    year_level = year_map.get(year_str, 1)
    
    comma = ',' if i < len(enrollments) - 1 else ';'
    sql += f"\n('{enrollment_ref}', (SELECT id FROM students WHERE student_id = '{student_id}'), (SELECT id FROM programs WHERE course_code = 'BSCRIM'), '{school_year}', '2nd sem', {year_level}){comma}"

# Add closing
sql += """

SET FOREIGN_KEY_CHECKS=1;

-- ============================================================
-- CONFIRMATION QUERIES
-- ============================================================
SELECT '✅ Seed Complete!' AS status;
SELECT COUNT(*) AS departments_count FROM departments;
SELECT COUNT(*) AS programs_count FROM programs;
SELECT COUNT(*) AS students_count FROM students;
SELECT COUNT(*) AS enrollments_count FROM enrollments;
"""

# Create directory if it doesn't exist
os.makedirs('seeds', exist_ok=True)

# Write to file
with open(sql_output, 'w', encoding='utf-8') as f:
    f.write(sql)

print(f"✅ Complete seed script generated!")
print(f"📊 Total records: {len(students)} students")
print(f"📁 File: {sql_output}")
file_size = os.path.getsize(sql_output) / 1024 / 1024
print(f"📏 File size: {file_size:.2f} MB")
