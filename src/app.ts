import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";

const app = express();

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.use(authRoutes);
app.use(userRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", message: "Event Tracking API is running" });
});

export default app;