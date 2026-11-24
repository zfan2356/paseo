import { describe, expect, it } from "vitest";
import {
  MenuBarReports,
  MenuBarSnapshotSchema,
  menuBarPresentation,
  type MenuBarSnapshot,
} from "./state.js";

const idle: MenuBarSnapshot = {
  hosts: [{ serverId: "local", label: "Mac", status: "ready" }],
  running: 0,
  waiting: 0,
  failed: 0,
  finished: 0,
  tasks: [],
};

describe("menu bar presentation", () => {
  it("distinguishes unavailable, unconfigured and idle without a false completion claim", () => {
    expect(menuBarPresentation(null).title).toBe("?");
    expect(menuBarPresentation({ ...idle, hosts: [] }).title).toBe("—");
    expect(menuBarPresentation(idle)).toEqual({
      title: "",
      summary: "Idle — no tasks need attention",
    });
  });
  it("shows attention, running, unread completion and disconnected hosts together", () => {
    expect(
      menuBarPresentation({
        ...idle,
        running: 2,
        waiting: 1,
        failed: 2,
        finished: 3,
        hosts: [...idle.hosts, { serverId: "remote", label: "GPU", status: "offline" }],
      }),
    ).toEqual({
      title: "! 3  ▶ 2  ✓ 3  ?",
      summary:
        "1 waiting for approval · 2 failed · 2 running · 3 finished, unread · 1 host(s) offline or syncing",
    });
  });
});

describe("menu bar reports", () => {
  it("uses the latest report without summing multiple windows and expires it", () => {
    const reports = new MenuBarReports();
    reports.update(1, { ...idle, running: 5 }, 0);
    reports.update(2, idle, 1_000);
    expect(reports.current(2_000)).toEqual(idle);
    expect(reports.current(46_000)).toBeNull();
  });
  it("falls back when a renderer closes and clears all on sleep", () => {
    const reports = new MenuBarReports();
    reports.update(1, idle, 0);
    reports.update(2, { ...idle, running: 1 }, 1_000);
    reports.remove(2);
    expect(reports.current(2_000)).toEqual(idle);
    reports.clear();
    expect(reports.current(2_000)).toBeNull();
  });
});

describe("menu bar IPC validation", () => {
  it("rejects invalid counts, duplicate hosts and tasks targeting unknown hosts", () => {
    expect(MenuBarSnapshotSchema.safeParse({ ...idle, running: -1 }).success).toBe(false);
    expect(
      MenuBarSnapshotSchema.safeParse({ ...idle, hosts: [...idle.hosts, ...idle.hosts] }).success,
    ).toBe(false);
    expect(
      MenuBarSnapshotSchema.safeParse({
        ...idle,
        running: 1,
        tasks: [{ serverId: "unknown", agentId: "task", title: "Task", status: "running" }],
      }).success,
    ).toBe(false);
  });
});
