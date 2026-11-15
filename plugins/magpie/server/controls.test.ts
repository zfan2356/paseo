import { test } from "vitest";
import assert from "node:assert/strict";
import { Controls, sourceOf, type SpeedStore } from "./controls.js";
import { onProvider } from "./personal-speed.middleware.js";

function fixture(personalReady = true, ultraSupported = true) {
  const group = {
    id: "gpt-test",
    name: "GPT",
    members: ["codex/gpt-test", "ichat/gpt-test"],
    routing: "order",
    affinity: "off",
    pick: "",
    firstToken: 25,
    memberInfo: [
      { id: "codex/gpt-test", ready: personalReady },
      { id: "ichat/gpt-test", ready: true },
    ],
  };
  const saves: unknown[] = [];
  let settings = { ready: true, models: ["gpt-other"], spec: "/test/personal-speed.middleware.js" };
  const store: SpeedStore = {
    read: async () => settings,
    save: async (s) => {
      settings = s;
    },
  };
  const controls = new Controls(async (path, body) => {
    if (path === "/api/groups") return { groups: [group] };
    if (path === "/api/state")
      return {
        agents: [{ fields: [{ options: [{ ref: "codex/gpt-test", ultraOk: ultraSupported }] }] }],
      };
    assert.equal(path, "/api/groups/save");
    saves.push(body);
    return {};
  }, store);
  return { controls, saves, group, store };
}

test("source switches preserve model identity and unrelated policy", async () => {
  const f = fixture();
  f.group.affinity = "session";
  await f.controls.source("gpt-test", "personal");
  assert.deepEqual(f.saves[0], { ...f.group, routing: "manual", pick: "codex/gpt-test" });
  await f.controls.source("gpt-test", "ichat");
  assert.deepEqual(f.saves[1], { ...f.group, routing: "manual", pick: "ichat/gpt-test" });
  await f.controls.source("gpt-test", "auto");
  assert.deepEqual(f.saves[2], f.group);
  assert.equal(sourceOf({ ...f.group, routing: "manual", pick: "ichat/gpt-test" }), "ichat");
});

test("official manual routes default to their first member and unrelated routes stay custom", () => {
  assert.equal(sourceOf({ members: ["codex/m", "ichat/m"], routing: "manual" }), "personal");
  assert.equal(
    sourceOf({ members: ["codex/m", "ichat/m", "other/m"], routing: "order" }),
    "custom",
  );
  assert.equal(sourceOf({ members: ["other/m", "ichat/m"], routing: "order" }), "custom");
});

test("unavailable personal source is refused before any save", async () => {
  const f = fixture(false);
  await assert.rejects(f.controls.source("gpt-test", "personal"), /不可用/);
  await assert.rejects(f.controls.ultra("gpt-test", true), /登录/);
  assert.equal(f.saves.length, 0);
});

test("ultrafast persists per model and preserves other selections", async () => {
  const f = fixture();
  await f.controls.ultra("gpt-test", true);
  assert.deepEqual((await f.store.read()).models, ["gpt-other", "gpt-test"]);
  await f.controls.ultra("gpt-test", false);
  assert.deepEqual((await f.store.read()).models, ["gpt-other"]);
});

test("models without advertised ultrafast cannot enable the setting", async () => {
  const f = fixture(true, false);
  await assert.rejects(f.controls.ultra("gpt-test", true), /未提供/);
  assert.deepEqual((await f.store.read()).models, ["gpt-other"]);
});

test("ultrafast modifies only selected personal attempts, never leaks into fallback", () => {
  const body = { model: "group/gpt-test", service_tier: "priority", input: "hello" };
  const ctx = {
    protocol: "responses",
    provider: { id: "codex", model: "gpt-test" },
    options: { ultrafastModels: ["gpt-test"] },
  };
  assert.deepEqual(onProvider(body, ctx), { ...body, service_tier: "ultrafast" });
  assert.equal(body.service_tier, "priority");
  assert.equal(
    onProvider(body, { ...ctx, provider: { id: "ichat", model: "gpt-test" } }),
    undefined,
  );
  assert.deepEqual(
    onProvider(
      { ...body, service_tier: "ultrafast" },
      { ...ctx, provider: { id: "ichat", model: "gpt-test" } },
    ),
    body,
  );
  assert.equal(onProvider(body, { ...ctx, protocol: "anthropic" }), undefined);
  assert.equal(
    onProvider(body, { ...ctx, provider: { id: "codex", model: "gpt-other" } }),
    undefined,
  );
});
