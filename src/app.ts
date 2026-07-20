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
import { env } from "./config/env";

const app = express();

app.use(cors({
  origin: env.csg_client,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.use(authRoutes);
app.use(userRoutes);
app.use(studentDashboardRoutes);
app.use(attendancePageRoutes);
app.use(paymentRoutes);
app.use(academicPeriodRoutes);
app.use(exportSecurityRoutes);
app.use(excelExportRoutes);
app.use(eventConfigExportRoutes);
app.use(publicStudentAttendanceRoutes);
app.use(rbacRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", message: "Event Tracking API is running" });
});

export default app;