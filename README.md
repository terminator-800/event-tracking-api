# Normi Event Tracking API

Backend REST API for **Northern Mindanao Colleges, Inc. (NMCI)** — **Event Attendance Monitoring**.

This service powers the NMCI / Central Student Government (CSG) event tracking system. It handles authentication, event scheduling, RFID attendance, student records, fines, payments, and admin operations against a **MySQL** database.

Works together with **[normi-event-tracking-client](../normi-event-tracking-client)** (React + Vite frontend).

---

## What this project is for

NMCI needs a reliable backend to support campus event attendance. This API provides:

1. **Public attendance endpoints** — Students check in/out by Student ID or RFID for ongoing events (with optional event password protection).
2. **Staff / CSG operations** — Authenticated users create and manage events, view attendance dashboards, track student participation, record fine payments, import student rosters, and manage system users.
3. **Automated event lifecycle** — A cron job updates event status (`Upcoming` → `Ongoing` → `Completed`) and applies attendance-related fine logic on Manila time.

The API is the single source of truth for attendance data, fines, and payments used by the desk client.

---

## Main capabilities

| Area | Description |
|------|-------------|
| **Auth** | Cookie-based JWT sessions; login rate limiting |
| **Events** | CRUD, current/ongoing/upcoming listing, audience targeting by department/program |
| **Attendance** | Time-in/time-out recording, event password verification, desk attendance pages |
| **Students** | Dashboard roster, per-student detail, participation history |
| **Payments** | Fine lookup, payment recording, transaction history, balance adjustments |
| **Import** | Admin CSV upload for students and enrollments |
| **Users** | Admin user management and department listing |
| **Data reset** | Admin preview/reset for selected tables |

### Role-based access

- **admin** — Full access (users, import, data reset)
- **csg_president** — Institution-wide event and desk operations
- **Department governors** — `it_governor`, `cba_governor`, `ceas_governor`, `coc_governor`, `chm_governor`

---

## Tech stack

- **Node.js** + **Express 5**
- **TypeScript**
- **MySQL** (`mysql2`)
- **JWT** + **httpOnly cookies** for auth
- **bcrypt** for password hashing
- **multer** for CSV uploads
- **node-cron** for scheduled event status updates
- **express-rate-limit** on login routes

---

## Prerequisites

- **Node.js** 18+ (recommended: latest LTS)
- **MySQL** 8+ (or compatible MariaDB)
- Database created ahead of time (see env `DB_NAME`)

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Configuration is loaded from **`.env.development`** in the project root.

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=event_tracking_database

PORT=5000
CSG_CLIENT=http://localhost:5173

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password

JWT_SECRET=your_long_random_secret
JWT_EXPIRES_IN=7d

NODE_ENV=development
```

| Variable | Purpose |
|----------|---------|
| `DB_*` | MySQL connection |
| `PORT` | API listen port (default `5000`) |
| `CSG_CLIENT` | Frontend origin for CORS (must match the client URL) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First admin account seeded when no admin exists |
| `JWT_SECRET` | Signing key for auth tokens |

### 3. Run the development server

```bash
npm run dev
```

On startup the server will:

1. Connect to MySQL
2. Run `CREATE TABLE IF NOT EXISTS` for all models
3. Seed the default **admin** user if none exists
4. Register the event status cron job

Health check: `GET http://localhost:5000/health`

### 4. Production build

```bash
npm run build
npm start
```

### 5. Manual admin seed (optional)

Same logic as startup seed:

```bash
npm run seed:admin
```

---

## Database

Tables are created automatically on boot via `src/models/index.ts`:

`departments` → `students` → `programs` → `enrollments` → `users` → `events` → `event_audiences` → `attendance` → `fines` → `payment_transactions` → `payments` → `fine_adjustments`

**Schema changes on existing databases** are not applied at runtime. If you upgrade from an older schema, run the manual `ALTER TABLE` statements documented in the model files (e.g. `students.models.ts`) using **MySQL Workbench**.

### Student CSV import (admin)

Upload via `POST /import/students-csv` with multipart field `file`.

Expected columns (header aliases are supported):

- Student Number
- RFID
- Full Name
- Year Level
- Department
- Semester
- School Year

Rows for **Graduate School** are skipped during import.

---

## API overview

### Health

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | Public |

### Auth

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/login` | Public |
| `POST` | `/logout` | Public |
| `GET` | `/me` | Required |
| `GET` | `/department` | Required |

### Events & public attendance

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/get-current-event` | Optional |
| `GET` | `/get-events` | Staff roles |
| `POST` | `/create/events` | Staff roles |
| `PUT` | `/update/events/:id` | Staff roles |
| `DELETE` | `/delete/events/:id` | Staff roles |
| `POST` | `/attendance/verify-event-password` | Public |
| `POST` | `/attendance/time-in-out` | Public |

### Attendance desk

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/attendance/page/events` | Staff roles |
| `GET` | `/attendance/page/events/:eventId` | Staff roles |
| `GET` | `/attendance/page/stream` | Staff roles |

### Students dashboard

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/dashboard/students` | Staff roles |
| `GET` | `/dashboard/students/:studentId` | Staff roles |

### Payments

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/payments/summary` | Staff roles |
| `GET` | `/payments/transactions` | Staff roles |
| `GET` | `/payments/students/lookup` | Staff roles |
| `GET` | `/payments/students` | Staff roles |
| `GET` | `/payments/students/:studentId` | Staff roles |
| `POST` | `/payments/record` | Staff roles |
| `PUT` | `/payments/fines/:fineId` | Staff roles |
| `PUT` | `/payments/students/:studentId/balance` | Staff roles |

### Admin

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/create-account` | Admin |
| `GET` | `/departments` | Admin |
| `GET` | `/users` | Admin |
| `PUT` | `/users/:id` | Admin |
| `DELETE` | `/users/:id` | Admin |
| `POST` | `/import/students-csv` | Admin |
| `GET` | `/admin/data-reset/preview` | Admin |
| `POST` | `/admin/data-reset` | Admin |

---

## Project structure (overview)

```
src/
├── app.ts                 # Express app, CORS, route mounting
├── server.ts              # Boot: DB, tables, admin seed, cron
├── config/                # env + MySQL pool
├── controllers/           # Route handlers
├── controllers/services/  # Business logic
├── cron/                  # Event status updater
├── middlewares/           # Auth, roles, upload, rate limit
├── models/                # CREATE TABLE definitions
├── repositories/          # SQL queries
├── routes/                # Route definitions
├── seed/                  # Default admin seed
└── utils/                 # Date/time, validation, SQL helpers
```

---

## Related repository

| Repo | Role |
|------|------|
| **normi-event-tracking-api** (this repo) | REST API, database, business logic |
| **normi-event-tracking-client** | React frontend |

Start this API first, then run the client with `VITE_API_BASE_URL` pointing to this server.

---

## Institution

**Northern Mindanao Colleges, Inc.**  
Event Attendance Monitoring System  
Central Student Government (CSG)

---

## License

Private / institutional use for Northern Mindanao Colleges, Inc.
