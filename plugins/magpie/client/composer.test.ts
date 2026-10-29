import { expect, test } from "vitest";
import { snapshotSchema } from "../shared/magpie.js";
import { composerGroup, composerSpeed } from "./composer.js";

const snapshot = snapshotSchema.parse({
  available: true,
  checkedAt: "2026-10-29",
  providers: [],
  quotas: [],
  signIn: null,
  groups: [
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      routing: "order",
      affinity: "session",
      ready: true,
      members: [],
      source: "auto",
      controllable: true,
      ultraAvailable: true,
      ultraEnabled: false,
    },
  ],
});

test("composer controls match the exact host snapshot, provider and model", () => {
  expect(composerGroup(snapshot, { provider: "codex", model: "codex/gpt-6-astra" })?.id).toBe(
    "gpt-6-astra",
  );
  expect(composerGroup(snapshot, { provider: "claude", model: "gpt-6-astra" })).toBeNull();
  expect(composerGroup(snapshot, { provider: "codex", model: "gpt-6.1-sol" })).toBeNull();
  expect(
    composerGroup({ ...snapshot, available: false }, { provider: "codex", model: "gpt-6-astra" }),
  ).toBeNull();
});

test("native speed tiers and legacy Fast preferences remain visible", () => {
  const group = snapshot.groups[0]!;
  expect(composerSpeed({ featureValues: {} }, group)).toBe("默认速度");
  expect(composerSpeed({ featureValues: { fast_mode: true } }, group)).toBe("Fast");
  expect(composerSpeed({ featureValues: { service_tier: "priority" } }, group)).toBe("Fast");
  expect(composerSpeed({ featureValues: {} }, { ...group, ultraEnabled: true })).toBe("Ultra fast");
  expect(
    composerSpeed({ featureValues: {} }, { ...group, source: "ichat", ultraEnabled: true }),
  ).toBe("默认速度");
});
