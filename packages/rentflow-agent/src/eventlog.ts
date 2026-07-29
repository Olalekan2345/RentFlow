import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AgentEventSchema, type AgentEvent } from "@rentflow/shared";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../data");
mkdirSync(dataDir, { recursive: true });
const logPath = resolve(dataDir, "events.jsonl");

// Keep a rolling in-memory tail so the dashboard can fetch without re-reading disk.
const recent: AgentEvent[] = [];
const MAX_RECENT = 500;

type Emit = Omit<AgentEvent, "ts"> & { ts?: number };

export function logEvent(evt: Emit): AgentEvent {
  const event = AgentEventSchema.parse({ ts: Date.now(), ...evt });
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.shift();
  try {
    appendFileSync(logPath, JSON.stringify(event) + "\n");
  } catch {
    /* logging must never crash the agent */
  }
  const tag = event.type.toUpperCase().padEnd(16);
  console.log(`[${new Date(event.ts).toISOString()}] ${tag} ${event.message}`);
  return event;
}

export function recentEvents(sinceTs = 0): AgentEvent[] {
  return recent.filter((e) => e.ts > sinceTs);
}

export function allEventsFromDisk(): AgentEvent[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return AgentEventSchema.parse(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((e): e is AgentEvent => e !== null);
}
