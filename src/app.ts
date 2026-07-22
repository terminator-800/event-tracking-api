import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import studentDashboardRoutes from "./routes/student-dashboard.routes";
import attendancePageRoutes from "./routes/attendance-page.routes";
import paymentRoutes from "./routes/payment.routes";
import academicPeriodRoutes from "./routes/academic-period.routes";
import exportSecurityRoutes from "./routes/export-security.routes";
import excelExportRoutes from "./routes/excel-export.routes";
import eventConfigExportRoutes from "./routes/event-config-export.routes";
import publicStudentAttendanceRoutes from "./routes/public-student-attendance.routes";
import rbacRoutes from "./routes/rbac.routes";
import semesterBackupRoutes from "./routes/semester-backup.routes";
import { env } from "./config/env";

const app = express();

app.use(cors({
  origin: env.csg_client,
  credentials: true,
  exposedHeaders: [
    "Content-Disposition",
    "X-Backup-Events",
    "X-Backup-Attendance",
    "X-Backup-Collection",
    "X-Backup-Scope",
  ],
}));

app.use(express.json());
app.use(cookieParser());

app.use("/api",authRoutes);
app.use("/api",userRoutes);
app.use("/api",studentDashboardRoutes);
app.use("/api",attendancePageRoutes);
app.use("/api",paymentRoutes);
app.use("/api",academicPeriodRoutes);
app.use("/api",exportSecurityRoutes);
app.use("/api",excelExportRoutes);
app.use("/api",eventConfigExportRoutes);
app.use("/api",publicStudentAttendanceRoutes);
app.use("/api",rbacRoutes);
app.use("/api",semesterBackupRoutes);

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", message: "Event Tracking API is running" });
});

export default app;