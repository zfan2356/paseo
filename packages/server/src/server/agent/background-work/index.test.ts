import { describe, expect, test } from "vitest";

import { AgentBackgroundWorkStore } from "./index.js";

const T0 = "2026-10-06T10:00:00.000Z";
const T1 = "2026-10-06T10:05:00.000Z";

describe("AgentBackgroundWorkStore", () => {
  test("stamps new items and keeps their start time across replacements", () => {
    const store = new AgentBackgroundWorkStore();

    expect(
      store.apply("agent-a", [{ id: "bash-1", kind: "shell", description: "sleep 20" }], T0),
    ).toEqual([{ id: "bash-1", kind: "shell", description: "sleep 20", startedAt: T0 }]);

    expect(
      store.apply(
        "agent-a",
        [
          { id: "bash-1", kind: "shell", description: "sleep 20" },
          { id: "task-1", kind: "other", description: null },
        ],
        T1,
      ),
    ).toEqual([
      { id: "bash-1", kind: "shell", description: "sleep 20", startedAt: T0 },
      { id: "task-1", kind: "other", description: null, startedAt: T1 },
    ]);
  });

  test("returns null when the replacement changes nothing", () => {
    const store = new AgentBackgroundWorkStore();
    store.apply("agent-a", [{ id: "bash-1", kind: "shell", description: "sleep 20" }], T0);

    expect(
      store.apply("agent-a", [{ id: "bash-1", kind: "shell", description: "sleep 20" }], T1),
    ).toBeNull();
    expect(store.apply("agent-b", [], T1)).toEqual([]);
    expect(store.apply("agent-b", [], T1)).toBeNull();
  });

  test("distinguishes an unknown inventory from an observed empty inventory", () => {
    const store = new AgentBackgroundWorkStore();
    expect(store.summary("agent-a")).toBeUndefined();
    store.apply("agent-a", []);
    expect(store.summary("agent-a")).toEqual({ count: 0 });
    store.clear("agent-a");
    expect(store.summary("agent-a")).toBeUndefined();
  });

  test("keeps the first occurrence of a duplicated id", () => {
    const store = new AgentBackgroundWorkStore();

    expect(
      store.apply(
        "agent-a",
        [
          { id: "bash-1", kind: "shell", description: "first" },
          { id: "bash-1", kind: "shell", description: "second" },
        ],
        T0,
      ),
    ).toEqual([{ id: "bash-1", kind: "shell", description: "first", startedAt: T0 }]);
  });

  test("scopes lists per agent and clears one agent", () => {
    const store = new AgentBackgroundWorkStore();
    store.apply("agent-a", [{ id: "bash-1", kind: "shell", description: null }], T0);
    store.apply("agent-b", [{ id: "bash-2", kind: "shell", description: null }], T0);

    expect(store.clear("agent-a")).toEqual([]);
    expect(store.clear("agent-a")).toBeNull();
    expect(store.list("agent-a")).toEqual([]);
    expect(store.list("agent-b")).toHaveLength(1);
  });

  test("keeps only the wire fields of each input", () => {
    const store = new AgentBackgroundWorkStore();
    const input = { id: "bash-1", kind: "shell", description: null, pid: 4242 };

    expect(store.apply("agent-a", [input], T0)).toEqual([
      { id: "bash-1", kind: "shell", description: null, startedAt: T0 },
    ]);
  });

  test("list returns a copy", () => {
    const store = new AgentBackgroundWorkStore();
    store.apply("agent-a", [{ id: "bash-1", kind: "shell", description: null }], T0);

    store.list("agent-a").pop();

    expect(store.list("agent-a")).toHaveLength(1);
  });
});

test("stop tokens follow a live item and change when an id is reused", () => {
  const store = new AgentBackgroundWorkStore();
  const input = { id: "1", kind: "shell", description: null, canStop: true };
  const first = store.apply("agent", [input], T0)![0];
  expect(first.stopToken).toBeTruthy();
  expect(store.apply("agent", [input], T1)).toBeNull();
  store.apply("agent", []);
  const second = store.apply("agent", [input], T0)![0];
  expect(second.stopToken).not.toBe(first.stopToken);
});

test("revokes a stop token while inventory ownership is being re-established", () => {
  const store = new AgentBackgroundWorkStore();
  const item = { id: "1", kind: "shell", description: null, canStop: true };
  const first = store.apply("agent", [item])![0];
  const stale = store.apply("agent", [{ ...item, canStop: false }])![0];
  expect(stale.stopToken).toBeUndefined();
  expect(store.apply("agent", [item])![0].stopToken).not.toBe(first.stopToken);
});

test("publishes command changes without replacing a live item's identity", () => {
  const store = new AgentBackgroundWorkStore();
  const item = {
    id: "1",
    kind: "monitor",
    description: "Watch build",
    command: "tail -f build.log",
    canStop: true,
  };
  const first = store.apply("agent", [item], T0)![0];
  expect(first.command).toBe("tail -f build.log");
  const changed = store.apply("agent", [{ ...item, command: "tail -f other.log" }], T1)![0];
  expect(changed).toMatchObject({
    command: "tail -f other.log",
    startedAt: T0,
    stopToken: first.stopToken,
  });
});

describe("external background sources", () => {
  test("fences replaced instances, preserves stale rows, and routes scoped stop tokens", async () => {
    const { ExternalBackgroundWork } = await import("./external.js");
    const changed = new Set<string>();
    const store = new ExternalBackgroundWork((ids) => {
      for (const id of ids) changed.add(id);
    });
    const stopped: string[] = [];
    const entry = {
      agentId: "agent-a",
      id: "same-id",
      kind: "monitor",
      description: "CI watch",
      startedAt: null,
      canStop: true,
      external: { status: "Running", running: true, deadline: T1, finishedAt: null, issue: null },
    };
    const first = store.open("plugin/waits", "Multica", async (item) => {
      stopped.push(item.id);
    });
    first.replace({ status: "ready", observedAt: T0, items: [entry] });
    const item = store.list("agent-a")[0]!;
    expect(item.startedAt).toBe("");
    expect(store.list("agent-b")).toEqual([]);
    expect(await store.stop("agent-b", item.id, item.stopToken!)).toBe(false);
    await store.stop("agent-a", item.id, item.stopToken!);
    expect(stopped).toEqual(["same-id"]);
    first.fail();
    expect(store.list("agent-a")[0]!.external?.freshness).toBe("stale");
    expect(store.list("agent-a")[0]!.canStop).toBe(false);
    await expect(store.stop("agent-a", item.id, item.stopToken!)).rejects.toThrow("source changed");
    const second = store.open("plugin/waits", "Multica", async () => {});
    first.replace({ status: "ready", observedAt: T1, items: [] });
    first.close();
    expect(store.list("agent-a").some((row) => row.description === "CI watch")).toBe(true);
    second.replace({ status: "ready", observedAt: T1, items: [] });
    expect(store.list("agent-a")).toEqual([]);
    expect(changed.has("agent-a")).toBe(true);
    second.close();
    expect(store.list("agent-b")).toEqual([]);
  });

  test("keeps native and external inventories independent even with identical ids", async () => {
    const { ExternalBackgroundWork } = await import("./external.js");
    const native = new AgentBackgroundWorkStore();
    const external = new ExternalBackgroundWork(() => {});
    const source = external.open("plugin", "Multica", async () => {});
    source.replace({
      status: "ready",
      observedAt: T0,
      items: [
        {
          agentId: "a",
          id: "1",
          kind: "monitor",
          description: null,
          startedAt: T0,
          canStop: false,
          external: {
            status: "Succeeded · awaiting handling",
            running: false,
            deadline: T1,
            finishedAt: T1,
            issue: null,
          },
        },
      ],
    });
    native.apply("a", [{ id: "1", kind: "shell", description: "native" }]);
    expect(new Set([...native.list("a"), ...external.list("a")].map((item) => item.id)).size).toBe(
      2,
    );
    native.clear("a");
    expect(external.list("a")).toHaveLength(1);
    source.close();
    expect(native.summary("a")).toBeUndefined();
  });
});

test("projects external inventory only to capable clients and strips read-only controls", async () => {
  const { projectBackgroundWork } = await import("./projection.js");
  const message = {
    type: "agent.background_work.update" as const,
    payload: {
      agentId: "a",
      items: [
        {
          id: "native",
          kind: "shell",
          description: null,
          startedAt: T0,
          canStop: true,
          stopToken: "native-token",
        },
        {
          id: "external",
          kind: "monitor",
          description: "CI",
          startedAt: "",
          canStop: true,
          stopToken: "external-token",
          external: {
            source: "multica",
            label: "Multica",
            freshness: "ready" as const,
            observedAt: T0,
            status: "Running",
            running: true,
            deadline: T1,
            finishedAt: null,
            issue: null,
          },
        },
      ],
    },
  };
  const legacy = projectBackgroundWork(message, {
    external: false,
    canStop: true,
    nativeSummary: () => ({ count: 1 }),
  });
  if (legacy.type !== "agent.background_work.update") throw new Error("Wrong message");
  expect(legacy.payload.items.map((item) => item.id)).toEqual(["native"]);
  const reader = projectBackgroundWork(message, {
    external: true,
    canStop: false,
    nativeSummary: () => ({ count: 1 }),
  });
  if (reader.type !== "agent.background_work.update") throw new Error("Wrong message");
  expect(reader.payload.items).toHaveLength(2);
  expect(
    reader.payload.items.every(
      (item) => item.canStop === undefined && item.stopToken === undefined,
    ),
  ).toBe(true);
});
