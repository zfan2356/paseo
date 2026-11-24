import type { CodexServiceTier } from "../codex-feature-definitions.js";

const ICHAT_FAST_MODELS = new Set([
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
]);

export function resolveIchatServiceTiers(
  modelId: string,
  advertised: CodexServiceTier[] | undefined,
  environment: Record<string, string> | undefined,
): CodexServiceTier[] | undefined {
  if (advertised?.length || !environment?.ICHAT_PROXY_PY || !ICHAT_FAST_MODELS.has(modelId)) {
    return advertised;
  }
  return [{ id: "fast", name: "Fast", description: "Priority inference at increased usage" }];
}
