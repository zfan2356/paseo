import type { ManagedAgent } from "../agent-manager.js";
import type { AgentSubagentDefaults } from "../agent-sdk-types.js";
import { resolveRequiredProviderModel } from "../mcp-shared.js";
import { PaseoToolInputError } from "./types.js";

interface SubagentSelectionInput {
  caller: ManagedAgent | null;
  detached: boolean;
  provider?: string;
  thinkingOptionId?: string;
}

interface SubagentSelection {
  provider: string;
  thinkingOptionId?: string;
}

export async function resolveSubagentSelection(
  input: SubagentSelectionInput,
): Promise<SubagentSelection> {
  const { caller } = input;
  let selectedProvider = caller?.provider;
  if (input.provider) {
    selectedProvider = resolveRequiredProviderModel(input.provider).provider;
  }
  const useCallerDefaults =
    !input.detached &&
    caller?.provider === selectedProvider &&
    (!input.provider || !input.thinkingOptionId);
  let defaults: AgentSubagentDefaults | undefined;
  if (useCallerDefaults) {
    defaults = await caller?.session?.getSubagentDefaults?.();
  }
  let provider = input.provider;
  if (!provider && defaults?.model && selectedProvider) {
    provider = `${selectedProvider}/${defaults.model}`;
  }
  if (!provider) {
    throw new PaseoToolInputError(
      "No configured subagent model is available. Specify provider/model or configure the caller provider's subagent defaults.",
    );
  }
  return { provider, thinkingOptionId: input.thinkingOptionId ?? defaults?.thinkingOptionId };
}
