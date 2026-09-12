import { parseObservation } from "./observation.ts";
import type { Observation } from "./types.ts";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The DOM constructor shadows Bun's options overload in the pinned TypeScript declarations.
type Socket = WebSocket & { terminate(): void };
const SocketClient = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): Socket };

type RecordValue = Record<string, any>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected Codex protocol response");
  return value as RecordValue;
}
function safeText(value: unknown, fallback: string, max = 4096): string {
  return typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : fallback;
}

/** Only connects to the private socket created by this runner. Never subscribes, resumes or starts work. */
export function observeCodex(socket: string, prompt: string, record: (observation: Observation) => void) {
  let stopped = false, session: string | undefined, ws: Socket | undefined, sequence = 0;
  let aliasDirectory: string | undefined, socketPath = socket;
  let timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined;
  const pending = new Map<number, { resolve: (value: RecordValue) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  function disconnect() {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Codex observation connection closed")); }
    pending.clear(); const connection = ws; ws = undefined; connection?.terminate();
  }
  async function connect() {
    // Bun's ws+unix URL parser percent-encodes spaces without decoding the filesystem path.
    // A private temporary alias preserves arbitrary state-directory names without a transport dependency.
    if (!aliasDirectory && /[\s%:#?]/.test(socket)) {
      aliasDirectory = mkdtempSync(join(tmpdir(), "impulse-observer-"));
      socketPath = join(aliasDirectory, "server.sock"); symlinkSync(socket, socketPath);
    }
    // Codex's Unix listener rejects WebSocket extension negotiation.
    ws = new SocketClient(`ws+unix://${socketPath}:/`, { perMessageDeflate: false, headers: { Host: "localhost" } });
    const connection = ws;
    connection.addEventListener("message", event => {
      try {
        if (typeof event.data !== "string" || event.data.length > 16 * 1024 * 1024) throw new Error("Codex observation response exceeds its limit");
        const message = object(JSON.parse(event.data)), request = pending.get(message.id);
        if (!request) return; // Includes server notifications; this observer never answers approvals.
        clearTimeout(request.timer); pending.delete(message.id);
        if (message.error) request.reject(new Error(`Codex observation RPC ${object(message.error).code}`));
        else request.resolve(object(message.result));
      } catch { disconnect(); }
    });
    connection.addEventListener("close", () => { if (ws === connection) disconnect(); });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { connection.terminate(); reject(new Error("Codex observation connection timed out")); }, 5000);
      connection.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      connection.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Codex observation connection unavailable")); }, { once: true });
      connection.addEventListener("close", () => { clearTimeout(timeout); reject(new Error("Codex observation connection closed")); }, { once: true });
    });
    await request("initialize", { clientInfo: { name: "impulse_observer", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    connection.send(JSON.stringify({ method: "initialized" }));
  }
  function request(method: string, params: unknown): Promise<RecordValue> {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error("Codex observation connection unavailable")); return; }
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error("Codex observation request timed out")); }, 5000);
      pending.set(id, { resolve, reject, timer: timeout });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function read() {
    if (!session) {
      let cursor: string | null = null;
      const matches: string[] = [];
      for (let page = 0; page < 10; page++) {
        const loaded = await request("thread/loaded/list", { cursor, limit: 100 });
        if (!Array.isArray(loaded.data)) throw new Error("Codex loaded-thread response is unavailable");
        for (const id of loaded.data) {
          if (typeof id !== "string") throw new Error("Codex session identity is unavailable");
          const thread = object((await request("thread/read", { threadId: id })).thread);
          if (!thread.parentThreadId && thread.preview === prompt) matches.push(id);
        }
        cursor = loaded.nextCursor ?? null;
        if (!cursor) break;
      }
      if (cursor || matches.length > 1) throw new Error("Codex assignment identity is ambiguous");
      session = matches[0];
      if (!session) { record({ state: "unavailable", note: "Waiting for the assignment's Codex session; no global transcript search is performed." }); return; }
    }
    const thread = object((await request("thread/read", { threadId: session })).thread);
    let turns: unknown[], full = false;
    try {
      const page = await request("thread/turns/list", { threadId: session, limit: 1, itemsView: "notLoaded" });
      if (!Array.isArray(page.data)) throw new Error("Invalid turn page");
      turns = page.data;
    } catch {
      // Older app-server versions predate paginated history. Read only this bound session.
      const legacy = object((await request("thread/read", { threadId: session, includeTurns: true })).thread);
      if (!Array.isArray(legacy.turns)) throw new Error("Codex turn history is unavailable");
      turns = legacy.turns.slice(-1); full = true;
    }
    const turn = turns.length ? object(turns[0]) : undefined;
    const status = object(thread.status).type;
    const result: Observation = { session_id: session, state: status === "active" ? "active" : "idle" };
    if (turn) result.turn_id = safeText(turn.id, "unknown", 256);
    if (status !== "active" && turn?.status === "failed") {
      const error = object(turn.error);
      result.state = "failed";
      result.error = { code: safeText(typeof error.codexErrorInfo === "string" ? error.codexErrorInfo : Object.keys(error.codexErrorInfo ?? {})[0], "unknown", 128), message: safeText(error.message, "Codex turn failed") };
      try {
        const detail = full ? turn : object((await request("thread/turns/list", { threadId: session, limit: 1, itemsView: "full" })).data?.[0]);
        if (detail.id === turn.id && Array.isArray(detail.items) && (full || detail.itemsView === "full")) result.active_tools = detail.items.filter((item: RecordValue) => item.status === "inProgress").length;
      } catch { /* Failure evidence remains useful when tool details are unavailable. */ }
    } else if (turn?.status === "inProgress") result.state = "active";
    else if (!["active", "idle", "notLoaded"].includes(status)) { result.state = "unavailable"; result.note = "Codex runtime status is unavailable; inspect the assignment session."; }
    record(parseObservation(result));
  }
  const done = (async () => {
    while (!stopped) {
      try { if (!ws) await connect(); if (!stopped) await read(); }
      catch (error) { disconnect(); if (!stopped) record({ state: "unavailable", ...(session ? { session_id: session } : {}), note: safeText(error instanceof Error ? error.message : null, "Codex observation unavailable", 1024) }); }
      if (!stopped) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 5000); });
    }
  })();
  return { async close() { stopped = true; clearTimeout(timer); wake?.(); disconnect(); await done; if (aliasDirectory) rmSync(aliasDirectory, { recursive: true, force: true }); } };
}
