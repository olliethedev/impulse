import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Engine } from "./engine.ts";
import { duration } from "./schedule.ts";
import { message, requireThat } from "./errors.ts";
import { alive, bootId, powershell } from "./platform.ts";
import type { Notification } from "./types.ts";

async function send(command: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let error = "";
    child.stderr?.on("data", chunk => { error = (error + chunk.toString()).slice(-4000); });
    child.stdin?.on("error", () => {}); child.stdin?.end(input);
    const timer = setTimeout(() => { child.kill(); reject(new Error("Notification delivery timed out after 15 seconds")); }, 15000);
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(error || `Notification command exited ${code}`)); });
  });
}
export async function deliverPending(engine: Engine) {
  reconcileDeliveries(engine);
  for (const pending of engine.store.all("notifications").filter(n => n.status === "pending")) {
    const notification = engine.store.atomic(() => {
      const n = engine.store.get("notifications", pending.id)!;
      if (n.status !== "pending") return null;
      n.status = "delivering"; n.delivery = { pid: process.pid, boot_id: bootId(), owner: engine.lease()?.pid === process.pid ? engine.lease()!.owner : null }; engine.store.put("notifications", n); return n;
    });
    if (!notification) continue;
    try {
      const settings = engine.settings().notifications;
      if (settings.command) await send(settings.command, JSON.stringify(notification));
      if (settings.desktop) {
        const title = `Impulse: ${notification.task_name} ${notification.outcome}`;
        if (process.platform === "linux") await send(["notify-send", "--app-name=Impulse", "--", title, notification.summary], "");
        else if (process.platform === "darwin") await send(["osascript", "-e", "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run", title, notification.summary], "");
        else {
          // Data is passed on stdin and assigned through XML APIs, never interpolated as PowerShell/XML source.
          const script = `$d = [Console]::In.ReadToEnd() | ConvertFrom-Json; [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; $x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>'); $n=$x.GetElementsByTagName('text'); $n.Item(0).AppendChild($x.CreateTextNode($d.title)) > $null; $n.Item(1).AppendChild($x.CreateTextNode($d.summary)) > $null; $t=[Windows.UI.Notifications.ToastNotification]::new($x); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Impulse').Show($t)`;
          await send(powershell(script), JSON.stringify({ title, summary: notification.summary }));
        }
      }
      notification.status = "delivered"; notification.error = null;
    } catch (error) { notification.status = "failed"; notification.error = message(error); }
    engine.store.atomic(() => engine.store.put("notifications", notification));
  }
}
export function reconcileDeliveries(engine: Engine) {
  engine.store.atomic(() => {
    for (const n of engine.store.all("notifications").filter(n => n.status === "delivering")) {
      if (!n.delivery || n.delivery.boot_id !== bootId() || !alive(n.delivery.pid) || (n.delivery.owner && n.delivery.owner !== engine.lease()?.owner)) {
        n.status = "failed"; n.error = "Delivery was interrupted and may already have reached its destination. Explicit retry may duplicate it."; engine.store.put("notifications", n);
      }
    }
  });
}
export function retryNotification(engine: Engine, id: string): Notification {
  reconcileDeliveries(engine);
  return engine.store.atomic(() => {
    const n = engine.store.get("notifications", id); requireThat(n, "NOT_FOUND", "Notification not found", 3);
    requireThat(n.status !== "delivering", "DELIVERY_ACTIVE", "Notification delivery is active", 4);
    n.status = "pending"; n.error = null; engine.store.put("notifications", n); return n;
  });
}
export function prune(engine: Engine, taskRef?: string, apply = false) {
  return engine.store.atomic(() => {
    const settings = engine.settings().retention, now = engine.now();
    const candidates: { run_id: string; history: boolean; files: string[]; bytes: number }[] = [];
    for (const run of engine.runs(taskRef)) {
      if (!["succeeded", "failed", "cancelled", "interrupted"].includes(run.status) || run.finished_at === null) continue;
      const task = engine.task(run.task_id);
      if (task.hold && task.last_run === run.id) continue;
      const retention = { ...settings, ...run.definition.retention };
      const expired = (value: string) => value !== "forever" && run.finished_at! + duration(value) <= now;
      const history = expired(retention.history) && task.last_run !== run.id;
      const files: string[] = [];
      if (history || expired(retention.logs)) files.push(join(engine.store.paths.logs, `${run.id}.log`));
      if (history) {
        for (const id of [run.id, ...engine.agents(run.id).map(a => a.id)]) {
          files.push(join(engine.store.paths.contexts, `${id}.json`), join(engine.store.paths.launches, `${id}.json`));
          files.push(join(engine.store.paths.launches, `${id}.process.json`), join(engine.store.paths.launches, `${id}.control.json`));
          files.push(join(engine.store.paths.launches, `${id}.process-outcome.json`));
          files.push(join(engine.store.paths.launches, `${id}.instructions.md`));
        }
      }
      const existing = files.filter(existsSync), bytes = existing.reduce((sum, file) => sum + statSync(file).size, 0);
      if (!history && existing.length === 0) continue;
      candidates.push({ run_id: run.id, history, files: existing, bytes });
      if (apply) {
        for (const file of existing) rmSync(file);
        if (history) {
          for (const agent of engine.agents(run.id)) engine.store.delete("agents", agent.id);
          for (const event of engine.events(run.id)) engine.store.delete("events", event.id);
          for (const n of engine.store.all("notifications").filter(n => n.run_id === run.id && ["delivered", "failed"].includes(n.status))) engine.store.delete("notifications", n.id);
          engine.store.delete("runs", run.id);
        }
      }
    }
    return { applied: apply, candidates };
  });
}
