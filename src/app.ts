import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import studentDashboardRoutes from "./routes/student-dashboard.routes";
import attendancePageRoutes from "./routes/attendance-page.routes";
import paymentRoutes from "./routes/payment.routes";

const app = express();

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.use(authRoutes);
app.use(userRoutes);
app.use(studentDashboardRoutes);
app.use(attendancePageRoutes);
app.use(paymentRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", message: "Event Tracking API is running" });
});

export default app;