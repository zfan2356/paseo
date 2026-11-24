// This hook runs separately for each upstream attempt. It must never promote
// an ichat fallback to the personal subscription's requested service tier.
export function onProvider(body, ctx) {
  if (ctx.protocol !== "responses" && ctx.protocol !== "chat") return;
  const provider = ctx.provider;
  if (!provider) return;
  const selected = ctx.options && ctx.options.ultrafastModels;
  if (provider.id === "codex" && Array.isArray(selected) && selected.includes(provider.model)) {
    return { ...body, service_tier: "ultrafast" };
  }
  if (provider.id === "ichat" && body.service_tier === "ultrafast") {
    return { ...body, service_tier: "priority" };
  }
}
