import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeCodex } from "../src/codex-observation.ts";
import type { Observation } from "../src/types.ts";

test.skipIf(process.platform === "win32")("Codex observation reads only its assignment and detects failure without resuming or stopping it", async () => {
  const home = mkdtempSync(join(tmpdir(), "impulse-codex-")), socket = join(home, "server.sock");
  const methods: string[] = [], observations: Observation[] = [];
  const server = Bun.serve({ unix: socket, fetch(req, server) {
    // The real Codex server rejects extension negotiation on its Unix listener.
    if (req.headers.has("sec-websocket-extensions")) return new Response("Unsupported", { status: 400 });
    if (server.upgrade(req)) return; return new Response("Upgrade required", { status: 400 });
  }, websocket: { message(ws, bytes) {
    const r = JSON.parse(String(bytes)); methods.push(r.method);
    if (r.id === undefined) return;
    let result: unknown = {};
    if (r.method === "thread/loaded/list") result = { data: ["other", "assignment"], nextCursor: null };
    if (r.method === "thread/read") result = { thread: { id: r.params.threadId, preview: r.params.threadId === "assignment" ? "assignment prompt" : "unrelated prompt", parentThreadId: null, status: { type: "idle" } } };
    if (r.method === "thread/turns/list") {
      expect(r.params.threadId).toBe("assignment");
      result = { data: [{ id: "turn", status: "failed", itemsView: "full", items: [{ type: "commandExecution", status: "inProgress" }], error: { code: 0, codexErrorInfo: "serverOverloaded", message: "Model is at capacity" } }], nextCursor: null };
    }
    ws.send(JSON.stringify({ id: r.id, result }));
  } } });
  const observer = observeCodex(socket, "assignment prompt", o => { observations.push(o); });
  try {
    for (let i = 0; i < 100 && !observations.some(o => o.state === "failed"); i++) await Bun.sleep(20);
    expect(observations.find(o => o.state === "failed")).toMatchObject({ session_id: "assignment", turn_id: "turn", active_tools: 1, error: { code: "serverOverloaded", message: "Model is at capacity" } });
    expect(methods.every(m => ["initialize", "initialized", "thread/loaded/list", "thread/read", "thread/turns/list"].includes(m))).toBe(true);
  } finally { await observer.close(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
}, 10000);

test.skipIf(process.platform === "win32")("legacy Codex reads stay active and incompatible observation never invents failure", async () => {
  for (const incompatible of [false, true]) {
    const home = mkdtempSync(join(tmpdir(), "impulse-codex-")), socket = join(home, "server.sock");
    const observations: Observation[] = [];
    const server = Bun.serve({ unix: socket, fetch(req, server) { if (server.upgrade(req)) return; return new Response("Upgrade", { status: 400 }); }, websocket: { message(ws, bytes) {
      const r = JSON.parse(String(bytes)); if (r.id === undefined) return;
      if (incompatible || r.method === "thread/turns/list") { ws.send(JSON.stringify({ id: r.id, error: { code: -32601, message: "Not implemented" } })); return; }
      const result = r.method === "thread/loaded/list" ? { data: ["assignment"] } : r.method === "thread/read" ? {
        thread: { id: "assignment", preview: "assignment prompt", status: { type: "active" }, turns: [{ id: "turn", status: "inProgress", items: [] }] }
      } : {};
      ws.send(JSON.stringify({ id: r.id, result }));
    } } });
    const observer = observeCodex(socket, "assignment prompt", value => { observations.push(value); });
    try {
      for (let i = 0; i < 100 && !observations.length; i++) await Bun.sleep(20);
      expect(observations[0]?.state).toBe(incompatible ? "unavailable" : "active");
      expect(observations.some(value => value.state === "failed")).toBe(false);
    } finally { await observer.close(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
  }
});
