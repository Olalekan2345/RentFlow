/**
 * Thin adapter over Node's built-in `node:sqlite` (Node 22+/24) exposing the
 * small slice of the better-sqlite3 API this project uses. Using the built-in
 * means zero native compilation — judges can `npm install && npm run demo`
 * without a C++ toolchain.
 */
import { createRequire } from "node:module";

// Load via createRequire so bundlers/test runners (Vite/Vitest) don't try to
// statically resolve the newer `node:sqlite` builtin — Node resolves it at runtime.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

// Silence only the one-time node:sqlite experimental-feature warning so demo
// output stays clean. Filtering the 'warning' event works regardless of runtime
// (tsx/Node) and re-dispatches every other warning untouched.
const priorWarningListeners = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w?.name === "ExperimentalWarning" && /SQLite is an experimental/.test(w.message)) return;
  if (priorWarningListeners.length) {
    for (const l of priorWarningListeners) l.call(process, w);
  } else {
    console.warn(w.stack ?? String(w));
  }
});

export interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DB {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(directive: string): void;
}

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  return {
    prepare: (sql) => db.prepare(sql) as unknown as Statement,
    exec: (sql) => db.exec(sql),
    pragma: (directive) => db.exec(`PRAGMA ${directive};`),
  };
}
