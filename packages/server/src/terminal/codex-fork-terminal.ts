import type {
  AgentFeature,
  AgentPersistenceHandle,
  AgentRuntimeInfo,
} from "../server/agent/agent-sdk-types.js";

interface CodexForkConfig {
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
  featureValues?: Record<string, unknown> | null;
  providerOptions?: Record<string, unknown> | null;
}

export interface CodexForkTerminalSource {
  provider: string;
  cwd: string;
  workspaceId?: string;
  persistence: AgentPersistenceHandle | null;
  runtimeInfo?: AgentRuntimeInfo | null;
  currentModeId?: string | null;
  config?: CodexForkConfig | null;
  features?: AgentFeature[] | null;
}

export interface CodexForkTerminalLaunch {
  name: string;
  command: string;
  args: string[];
}

export const CODEX_FORK_TERMINAL_NAME = "Codex Fork";

const CODEX_MODE_PRESETS: Record<
  string,
  { approvalPolicy: string; sandboxMode: string; approvalsReviewer?: string }
> = {
  "read-only": {
    approvalPolicy: "on-request",
    sandboxMode: "read-only",
  },
  auto: {
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  },
  "auto-review": {
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
    approvalsReviewer: "auto_review",
  },
  "full-access": {
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  },
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatTomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function formatTomlValue(value: unknown): string | null {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const entries = value.map(formatTomlValue);
    return entries.every((entry): entry is string => entry !== null)
      ? `[${entries.join(", ")}]`
      : null;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).flatMap(([key, entryValue]) => {
      const formatted = formatTomlValue(entryValue);
      return formatted === null ? [] : [`${formatTomlKey(key)} = ${formatted}`];
    });
    return `{ ${entries.join(", ")} }`;
  }
  return null;
}

function pushConfigArg(args: string[], key: string, value: unknown): void {
  const formatted = formatTomlValue(value);
  if (formatted !== null) {
    args.push("--config", `${key}=${formatted}`);
  }
}

function resolveFeatureToggle(source: CodexForkTerminalSource, featureId: string): boolean | null {
  if (source.features !== null && source.features !== undefined) {
    const liveFeature = source.features.find(
      (feature): feature is Extract<AgentFeature, { type: "toggle" }> =>
        feature.type === "toggle" && feature.id === featureId,
    );
    return liveFeature?.value ?? null;
  }
  const configuredValue = source.config?.featureValues?.[featureId];
  return typeof configuredValue === "boolean" ? configuredValue : null;
}

function appendProviderOptions(args: string[], providerOptions: Record<string, unknown>): void {
  const approvalPolicy = providerOptions.approval_policy;
  if (typeof approvalPolicy === "string") {
    args.push("--ask-for-approval", approvalPolicy);
  } else if (approvalPolicy !== undefined) {
    pushConfigArg(args, "approval_policy", approvalPolicy);
  }

  const sandboxMode = providerOptions.sandbox_mode;
  if (typeof sandboxMode === "string") {
    args.push("--sandbox", sandboxMode);
  }

  const workspaceWrite = providerOptions.sandbox_workspace_write;
  if (isRecord(workspaceWrite)) {
    for (const [key, value] of Object.entries(workspaceWrite)) {
      pushConfigArg(args, `sandbox_workspace_write.${key}`, value);
    }
  }

  if (providerOptions.web_search !== undefined) {
    pushConfigArg(args, "web_search", providerOptions.web_search);
  }

  const features = providerOptions.features;
  if (isRecord(features)) {
    for (const [key, value] of Object.entries(features)) {
      pushConfigArg(args, `features.${key}`, value);
    }
  }
}

function appendModelAndPerformanceArgs(args: string[], source: CodexForkTerminalSource): void {
  const model = nonEmptyString(source.runtimeInfo?.model ?? source.config?.model);
  if (model) {
    args.push("--model", model);
  }

  const thinkingOptionId = nonEmptyString(
    source.runtimeInfo?.thinkingOptionId ?? source.config?.thinkingOptionId,
  );
  if (thinkingOptionId) {
    pushConfigArg(args, "model_reasoning_effort", thinkingOptionId);
  }

  const fastMode = resolveFeatureToggle(source, "fast_mode");
  if (fastMode !== null) {
    pushConfigArg(args, "service_tier", fastMode ? "fast" : "default");
  }
}

function appendPermissionArgs(args: string[], source: CodexForkTerminalSource): void {
  const providerOptions = source.config?.providerOptions;
  const modeId = nonEmptyString(source.config ? source.config.modeId : source.currentModeId);
  const modePreset = modeId ? CODEX_MODE_PRESETS[modeId] : undefined;
  if (modePreset && providerOptions?.approval_policy === undefined) {
    args.push("--ask-for-approval", modePreset.approvalPolicy);
  }
  if (modePreset && providerOptions?.sandbox_mode === undefined) {
    args.push("--sandbox", modePreset.sandboxMode);
  }
  if (modePreset?.approvalsReviewer) {
    pushConfigArg(args, "approvals_reviewer", modePreset.approvalsReviewer);
  }
  if (providerOptions) {
    appendProviderOptions(args, providerOptions);
  }
}

export function buildCodexForkTerminalLaunch(
  source: CodexForkTerminalSource,
): CodexForkTerminalLaunch {
  if (source.provider !== "codex") {
    throw new Error("Only Codex conversations can be forked into a Codex terminal");
  }

  const threadId = nonEmptyString(
    source.persistence?.nativeHandle ??
      source.persistence?.sessionId ??
      source.runtimeInfo?.sessionId,
  );
  if (!threadId) {
    throw new Error("The Codex conversation does not have a forkable thread id yet");
  }

  const args = ["fork"];
  appendModelAndPerformanceArgs(args, source);
  appendPermissionArgs(args, source);

  args.push("--cd", source.cwd, threadId);
  return {
    name: CODEX_FORK_TERMINAL_NAME,
    command: "codex",
    args,
  };
}
