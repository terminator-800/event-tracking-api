export type FineStatus = "Unpaid" | "Partial" | "Paid" | "Waived";

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function clampMoney(value: number): number {
  return Math.max(0, roundMoney(value));
}

export function computeFineStatus(amount: number, paidAmount: number, currentStatus?: string): FineStatus {
  const normalizedCurrent = String(currentStatus ?? "").trim();
  if (normalizedCurrent === "Waived") return "Waived";

  const total = clampMoney(amount);
  const paid = clampMoney(paidAmount);
  if (paid <= 0) return "Unpaid";
  if (paid < total) return "Partial";
  return "Paid";
}
