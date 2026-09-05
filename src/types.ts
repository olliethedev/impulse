export type FirstRun = { kind: "now" } | { kind: "at"; at: string } | { kind: "after"; delay: string } | { kind: "schedule" };
export type Schedule = { kind: "calendar"; cron: string; timezone: string } | { kind: "completion"; after: string };
export type Work = { kind: "script"; command: string[] } | { kind: "agent"; instructions: string };
export interface Definition {
  schema_version: 1;
  name: string;
  cwd: string;
  work: Work;
  first_run: FirstRun;
  schedule?: Schedule;
  policy: { catch_up: "once" | "skip"; overlap: "skip" | "queue_one"; hold_after_interruption: boolean;
    interruption_retry: { enabled: boolean; max_attempts: number; delay: string } };
  notifications: { on_success: boolean; on_failure: boolean; on_interruption: boolean };
  retention: { history?: string; logs?: string };
}
export interface Profile { command: string[]; lifecycle?: "process" | "external" }
export interface Settings {
  schema_version: 1;
  defaults: { harness: string; terminal: string };
  limits: { agents: number };
  retention: { history: string; logs: string };
  notifications: { desktop: boolean; command?: string[] };
  harnesses: Record<string, Profile>;
  terminals: Record<string, Profile>;
}
export interface ExecutionProfile { harness: string; terminal: string; harness_profile?: Profile; terminal_profile?: Profile }
export type Outcome = "succeeded" | "failed" | "unconfirmed" | "interrupted" | "cancelled";
export type Status = "queued" | "launching" | "running" | "stopping" | "uncertain" | Outcome;
export const activeStatuses: Status[] = ["queued", "launching", "running", "stopping", "uncertain"];
export interface ClockSample { boot_id: string; at: number }
export interface Due { at: number; source: "first" | "calendar" | "completion" | "explicit" | "retry"; nominal?: string; elapsed?: ClockSample }
export interface Task {
  id: string; name: string; source: string; source_hash: string; definition: Definition;
  revision: number; registered_at: number; enabled: boolean; removed: boolean;
  overrides: { harness?: string; terminal?: string }; profile: ExecutionProfile;
  next: Due | null; last_run: string | null; hold: boolean; zone: string;
  last_calendar_nominal: string | null;
  registered_clock?: ClockSample;
}
export interface Context { run_id: string; task_id: string; revision: number; agent_id?: string; token: string }
export interface Execution {
  status: Status; ticket: string; runner_nonce: string | null; pid: number | null;
  boot_id: string | null; heartbeat: number | null; launch_at: number | null;
  exit_code: number | null; ended_at: number | null; error: string | null;
}
export interface Run {
  id: string; task_id: string; revision: number; definition: Definition; profile: ExecutionProfile;
  status: Status; created_at: number; finished_at: number | null; trigger: string;
  script: Execution | null; context: Context; cancel: boolean; force: boolean;
  root_agent: string | null; retry_attempt: number; next_mutation: boolean;
  finished_clock?: ClockSample;
}
export interface Agent extends Execution {
  id: string; run_id: string; parent_id: string | null; instructions: string; created_at: number;
  context: Context; summary: string | null; handled: { reason: string; at: number } | null;
  outcome: "succeeded" | "failed" | null;
}
export interface Event { id: string; run_id: string | null; task_id: string; type: string; at: number; detail: unknown }
export interface Notification { id: string; run_id: string; task_id: string; task_name: string; outcome: Outcome;
  summary: string; at: number; status: "pending" | "delivering" | "delivered" | "failed"; error: string | null }
export interface Lease { owner: string; generation: number; until: number; pid: number; boot_id: string; enabled: boolean; tick: number }
