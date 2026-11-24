import { z } from "zod";
import { MenuBarQuotaReportSchema } from "./quotas.js";
import { MenuBarQuotaPreferenceSchema } from "./quota-preference.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().trim().min(1).max(512);
export const MenuBarSnapshotSchema = z
  .object({
    hosts: z
      .array(
        z.object({
          serverId: identifier,
          label: z.string().max(200),
          status: z.enum(["ready", "offline", "syncing"]),
        }),
      )
      .max(128),
    running: count,
    waiting: count,
    failed: count,
    finished: count,
    quotaReports: z.array(MenuBarQuotaReportSchema).max(128).optional(),
    quotaPreference: MenuBarQuotaPreferenceSchema.optional(),
    tasks: z
      .array(
        z.object({
          serverId: identifier,
          agentId: identifier,
          title: z.string().max(200),
          summary: z.string().max(300).optional(),
          updatedAt: z.number().nonnegative().optional(),
          status: z.enum(["waiting", "failed", "running", "finished"]),
        }),
      )
      .max(48),
  })
  .superRefine((snapshot, context) => {
    const ready = new Set(
      snapshot.hosts.filter((host) => host.status === "ready").map((host) => host.serverId),
    );
    const keys = new Set<string>();
    const totals = { waiting: 0, failed: 0, running: 0, finished: 0 };
    for (const task of snapshot.tasks) {
      const key = JSON.stringify([task.serverId, task.agentId]);
      if (!ready.has(task.serverId) || keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Tasks must be unique and belong to a ready host",
        });
      }
      keys.add(key);
      totals[task.status]++;
    }
    for (const status of ["waiting", "failed", "running", "finished"] as const) {
      if (totals[status] > snapshot[status]) {
        context.addIssue({ code: "custom", message: "Task totals exceed reported counts" });
      }
    }
    const ids = new Set(snapshot.hosts.map((host) => host.serverId));
    if (ids.size !== snapshot.hosts.length) {
      context.addIssue({ code: "custom", message: "Hosts must be unique" });
    }
  });

export type MenuBarSnapshot = z.infer<typeof MenuBarSnapshotSchema>;
export type MenuBarTask = MenuBarSnapshot["tasks"][number];

export function menuBarPresentation(snapshot: MenuBarSnapshot | null) {
  if (!snapshot) return { title: "?", summary: "Status unavailable — open Paseo to reconnect" };
  if (snapshot.hosts.length === 0) return { title: "—", summary: "No hosts configured" };
  const symbols: string[] = [];
  const descriptions: string[] = [];
  const attention = snapshot.waiting + snapshot.failed;
  if (attention > 0) symbols.push(`! ${attention}`);
  if (snapshot.running > 0) symbols.push(`▶ ${snapshot.running}`);
  if (snapshot.finished > 0) symbols.push(`✓ ${snapshot.finished}`);
  if (snapshot.waiting > 0) descriptions.push(`${snapshot.waiting} waiting for approval`);
  if (snapshot.failed > 0) descriptions.push(`${snapshot.failed} failed`);
  if (snapshot.running > 0) descriptions.push(`${snapshot.running} running`);
  if (snapshot.finished > 0) descriptions.push(`${snapshot.finished} finished, unread`);
  const unavailable = snapshot.hosts.filter((host) => host.status !== "ready").length;
  if (unavailable > 0) {
    symbols.push("?");
    descriptions.push(`${unavailable} host(s) offline or syncing`);
  }
  if (symbols.length === 0) return { title: "", summary: "Idle — no tasks need attention" };
  return { title: symbols.join("  "), summary: descriptions.join(" · ") };
}

interface Report {
  snapshot: MenuBarSnapshot;
  receivedAt: number;
}

// Renderers each report all hosts. Never sum their reports or count agents twice.
export class MenuBarReports {
  private readonly reports = new Map<number, Report>();

  update(windowId: number, snapshot: MenuBarSnapshot, now: number): void {
    this.reports.delete(windowId);
    this.reports.set(windowId, { snapshot, receivedAt: now });
  }

  remove(windowId: number): void {
    this.reports.delete(windowId);
  }

  clear(): void {
    this.reports.clear();
  }

  latestWindow(now: number): number | null {
    let latest: number | null = null;
    for (const [id, report] of this.reports) {
      if (now - report.receivedAt < 45_000) latest = id;
    }
    return latest;
  }

  current(now: number): MenuBarSnapshot | null {
    let latest: MenuBarSnapshot | null = null;
    for (const report of this.reports.values()) {
      if (now - report.receivedAt < 45_000) latest = report.snapshot;
    }
    return latest;
  }
}
