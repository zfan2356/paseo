import { test } from "vitest";
import assert from "node:assert/strict";
import { withPersonalTiers, personalUltraModels } from "./codex-catalog.js";

test("advertises the supported tier without changing model identity or context", () => {
  const input = {
    models: [
      {
        slug: "gpt-6-astra",
        context_window: 1000000,
        supported_reasoning_levels: [{ effort: "max" }],
        service_tiers: [{ id: "priority", name: "Fast", description: "Existing" }],
      },
    ],
  };
  const result = withPersonalTiers(input, new Set(["codex/gpt-6-astra"]));
  assert.deepEqual(
    result.models[0].service_tiers.map((x) => x.id),
    ["priority", "ultrafast"],
  );
  assert.deepEqual(
    { ...result.models[0], service_tiers: undefined },
    { ...input.models[0], service_tiers: undefined },
  );
  assert.equal(input.models[0].service_tiers.length, 1);
});

test("does not invent ultrafast for unsupported models and is stable across refreshes", () => {
  const input = {
    models: [
      {
        slug: "gpt-5.6-sol",
        service_tiers: [{ id: "ultrafast", name: "Ultrafast", description: "Old" }],
      },
    ],
  };
  const once = withPersonalTiers(input, new Set());
  assert.deepEqual(once.models[0].service_tiers, []);
  assert.deepEqual(withPersonalTiers(once, new Set()), once);
});

test("capability extraction uses explicit personal-account flags only", () => {
  const supported = personalUltraModels({
    agents: [
      {
        fields: [
          {
            options: [
              { ref: "codex/gpt-6-astra", ultraOk: true },
              { ref: "ichat/gpt-6-astra", ultraOk: true },
              { ref: "codex/gpt-5.6-sol" },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual([...supported], ["codex/gpt-6-astra"]);
});

test("adds missing eligible models from the actual native catalog only", () => {
  const result = withPersonalTiers(
    { models: [{ slug: "gpt-6-astra" }] },
    new Set(["codex/gpt-6-astra", "codex/gpt-6.1-sol"]),
    {
      models: [
        { slug: "codex/gpt-6.1-sol", context_window: 272000 },
        { slug: "ichat/gpt-unknown" },
      ],
    },
  );
  assert.deepEqual(
    result.models.map((model) => model.slug),
    ["gpt-6-astra", "gpt-6.1-sol"],
  );
  assert.deepEqual(result.models[1], {
    slug: "gpt-6.1-sol",
    context_window: 272000,
    service_tiers: [
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "Eligible personal accounts; increased usage",
      },
    ],
  });
});
