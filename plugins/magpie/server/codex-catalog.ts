import { z } from "zod";

const tier = z.object({ id: z.string(), name: z.string(), description: z.string() }).passthrough();
const catalogSchema = z
  .object({
    models: z.array(
      z
        .object({
          slug: z.string(),
          service_tiers: z.array(tier).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

// Codex filters service_tier against this catalog before sending any request.
// Preserve the user's model choices, contexts, and reasoning levels; derive
// Ultrafast availability from Magpie's current personal-account capabilities.
export function withPersonalTiers(
  input: unknown,
  supported: ReadonlySet<string>,
  native: unknown = { models: [] },
) {
  const catalog = catalogSchema.parse(input);
  const additions = catalogSchema.parse(native);
  const models = [...catalog.models];
  for (const entry of additions.models) {
    if (!entry.slug.startsWith("codex/") || !supported.has(entry.slug)) continue;
    const slug = entry.slug.slice("codex/".length);
    if (!models.some((model) => model.slug === slug)) models.push({ ...entry, slug });
  }
  return {
    ...catalog,
    models: models.map((model) => {
      const available = supported.has(`codex/${model.slug}`);
      const original = model.service_tiers ?? [];
      const tiers = original.filter((entry) => entry.id !== "ultrafast");
      if (available)
        tiers.push(
          original.find((entry) => entry.id === "ultrafast") ?? {
            id: "ultrafast",
            name: "Ultrafast",
            description: "Eligible personal accounts; increased usage",
          },
        );
      return Object.assign({}, model, { service_tiers: tiers });
    }),
  };
}

export function personalUltraModels(input: unknown): Set<string> {
  const option = z.object({ ref: z.string().optional(), ultraOk: z.boolean().optional() });
  const state = z.object({
    agents: z.array(
      z.object({ fields: z.array(z.object({ options: z.array(option).optional() })).optional() }),
    ),
  });
  const data = state.parse(input);
  const models = new Set<string>();
  for (const agent of data.agents)
    for (const field of agent.fields ?? [])
      for (const entry of field.options ?? []) {
        if (entry.ultraOk && entry.ref?.startsWith("codex/")) models.add(entry.ref);
      }
  return models;
}
