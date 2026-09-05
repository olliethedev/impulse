import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { requireThat } from "./errors.ts";
import { ensurePaths, type Paths } from "./paths.ts";
import type { Agent, Event, Notification, Run, Task } from "./types.ts";

interface Collections { tasks: Task; runs: Run; agents: Agent; events: Event; notifications: Notification }
/** All command mutations share one SQLite transaction boundary, including receipts and events. */
export class Store {
  private db: Database;
  constructor(public paths: Paths) {
    ensurePaths(paths);
    this.db = new Database(paths.db, { create: true, strict: true });
    if (process.platform !== "win32") chmodSync(paths.db, 0o600);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    requireThat(version <= 1, "INCOMPATIBLE_STATE", "This database requires a newer Impulse version", 6);
    this.db.transaction(() => {
      for (const name of ["tasks", "runs", "agents", "events", "notifications", "meta"])
        this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT`);
      this.db.exec("PRAGMA user_version = 1");
    }).immediate();
  }
  atomic<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  get<K extends keyof Collections>(table: K, id: string): Collections[K] | null {
    const row = this.db.query(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | null;
    return row ? JSON.parse(row.data) as Collections[K] : null;
  }
  all<K extends keyof Collections>(table: K): Collections[K][] {
    return (this.db.query(`SELECT data FROM ${table} ORDER BY rowid`).all() as { data: string }[]).map(r => JSON.parse(r.data) as Collections[K]);
  }
  put<K extends keyof Collections>(table: K, value: Collections[K]) {
    this.db.query(`INSERT INTO ${table} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id, JSON.stringify(value));
  }
  delete<K extends keyof Collections>(table: K, id: string) { this.db.query(`DELETE FROM ${table} WHERE id=?`).run(id); }
  meta<T>(id: string): T | null {
    const row = this.db.query("SELECT data FROM meta WHERE id=?").get(id) as { data: string } | null;
    return row ? JSON.parse(row.data) as T : null;
  }
  setMeta(id: string, value: unknown) { this.db.query("INSERT INTO meta (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(id, JSON.stringify(value)); }
  close() { this.db.close(); }
}
