export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4022";
export const LANDLORD_URL =
  process.env.NEXT_PUBLIC_LANDLORD_URL ?? "http://localhost:4021";

export interface AgentStatus {
  operatorId: string;
  asset: string;
  tokenId: string | null;
  balance: string;
  dailyRate: string;
  runwayDays: number;
  leaseId: string;
  daysPaid: number;
  termDays: number;
  nextDueDate: string;
  state: "IDLE" | "RUNNING" | "GRACE" | "ALERT" | "COMPLETE";
  simulatedDay: number;
  lastAlert: string | null;
  updatedAt: number;
}

export interface Payment {
  date: string;
  amount: string;
  asset: string;
  txId: string;
  hashscanUrl: string;
  paidAt: number;
}

export interface AgentEvent {
  ts: number;
  type: string;
  message: string;
  date?: string;
}

export async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
