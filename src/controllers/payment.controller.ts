import { Request, Response } from "express";
import { Role } from "../types/express";
import { PaymentService } from "./services/payment.service";

const paymentService = new PaymentService();

export class PaymentController {
  async summary(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const summary = await paymentService.getPaymentSummary(role, departmentId, userId);
      res.status(200).json({ summary });
    } catch (error) {
      console.error("[PaymentController.summary]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async transactions(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const data = await paymentService.listPaymentTransactions(role, departmentId, userId);
      res.status(200).json(data);
    } catch (error) {
      console.error("[PaymentController.transactions]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async lookup(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const identifier = String(req.query.identifier ?? "").trim();
      if (!identifier) {
        res.status(400).json({ message: "identifier is required (Student ID or RFID)." });
        return;
      }

      const student = await paymentService.getPaymentStudentByIdentifier(
        role,
        departmentId,
        userId,
        identifier,
      );
      if (!student) {
        res.status(404).json({ message: "Student not found or access denied." });
        return;
      }
      res.status(200).json({ student });
    } catch (error) {
      console.error("[PaymentController.lookup]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async getOne(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const studentId = String(req.params.studentId ?? "").trim();
      if (!studentId) {
        res.status(400).json({ message: "studentId is required." });
        return;
      }

      const student = await paymentService.getPaymentStudentByPublicId(
        role,
        departmentId,
        userId,
        studentId,
      );
      if (!student) {
        res.status(404).json({ message: "Student not found or access denied." });
        return;
      }
      res.status(200).json({ student });
    } catch (error) {
      console.error("[PaymentController.getOne]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const data = await paymentService.listPaymentStudents(role, departmentId, userId);
      res.status(200).json(data);
    } catch (error) {
      console.error("[PaymentController.list]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async record(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || !userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const studentId = String(req.body?.studentId ?? "").trim();
      const amountPaid = Number(req.body?.amountPaid ?? 0);
      const paymentMethod = req.body?.paymentMethod;
      const remarks = req.body?.remarks;
      if (!studentId) {
        res.status(400).json({ message: "studentId is required." });
        return;
      }

      const result = await paymentService.recordPayment({
        encodedByUserId: userId,
        role,
        departmentId,
        publicStudentId: studentId,
        amountPaid,
        paymentMethod,
        remarks,
        academicPeriodId: req.activeAcademicPeriod?.id ?? null,
      });
      if (!result.ok) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      console.error("[PaymentController.record]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async updateFineAmount(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const fineId = Number(req.params.fineId);
      const amount = Number(req.body?.amount ?? 0);
      if (!Number.isFinite(fineId) || fineId <= 0) {
        res.status(400).json({ message: "Invalid fine id." });
        return;
      }
      const result = await paymentService.updateFineAmount({ role, departmentId, userId, fineId, amount });
      if (!result.ok) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      console.error("[PaymentController.updateFineAmount]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async setStudentBalance(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const departmentId = req.user?.department_id ?? null;
      const userId = req.user?.id;
      if (!role || userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const studentId = String(req.params.studentId ?? "").trim();
      const targetBalance = Number(req.body?.targetBalance ?? 0);
      if (!studentId) {
        res.status(400).json({ message: "Invalid student id." });
        return;
      }
      const result = await paymentService.setStudentBalance({
        role,
        departmentId,
        userId,
        publicStudentId: studentId,
        targetBalance,
        academicPeriodId: req.activeAcademicPeriod?.id ?? null,
      });
      if (!result.ok) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      console.error("[PaymentController.setStudentBalance]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
