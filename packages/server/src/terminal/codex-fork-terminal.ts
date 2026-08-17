import type {
  AgentFeature,
  AgentPersistenceHandle,
  AgentRuntimeInfo,
} from "../server/agent/agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../server/agent/provider-launch-config.js";
import { resolveCursorConfigDirectory } from "./cursor-conversation-store.js";

interface AgentConversationTerminalConfig {
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
  featureValues?: Record<string, unknown> | null;
  providerOptions?: Record<string, unknown> | null;
}

export interface AgentConversationTerminalSource {
  provider: string;
  cwd: string;
  workspaceId?: string;
  persistence: AgentPersistenceHandle | null;
  runtimeInfo?: AgentRuntimeInfo | null;
  currentModeId?: string | null;
  config?: AgentConversationTerminalConfig | null;
  features?: AgentFeature[] | null;
  runtimeSettings?: ProviderRuntimeSettings;
}

export interface AgentConversationTerminalLaunch {
  provider: AgentConversationTerminalProvider;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export const CODEX_CONVERSATION_TERMINAL_NAME = "Codex Conversation";
export type AgentConversationTerminalProvider = "codex" | "claude" | "cursor";

const AGENT_CONVERSATION_TERMINAL_NAMES: Record<AgentConversationTerminalProvider, string> = {
  codex: CODEX_CONVERSATION_TERMINAL_NAME,
  claude: "Claude Code Conversation",
  cursor: "Cursor Conversation",
};
const AGENT_CONVERSATION_TERMINAL_PREFIX = "__paseo_agent_conversation__:";
const CODEX_CONVERSATION_TERMINAL_PREFIX = "__paseo_codex_conversation__:";

export type CodexConversationTerminalSource = AgentConversationTerminalSource;
export type CodexConversationTerminalLaunch = AgentConversationTerminalLaunch;

export function isAgentConversationTerminalProvider(
  provider: string,
): provider is AgentConversationTerminalProvider {
  return provider === "codex" || provider === "claude" || provider === "cursor";
}

export function getAgentConversationTerminalDisplayName(
  provider: AgentConversationTerminalProvider,
): string {
  return AGENT_CONVERSATION_TERMINAL_NAMES[provider];
}

export function buildAgentConversationTerminalName(
  agentId: string,
  provider: AgentConversationTerminalProvider,
): string {
  return `${AGENT_CONVERSATION_TERMINAL_PREFIX}${provider}:${encodeURIComponent(agentId)}`;
}

export function parseAgentConversationTerminalLink(
  name: string,
): { agentId: string; provider: AgentConversationTerminalProvider } | null {
  if (name.startsWith(AGENT_CONVERSATION_TERMINAL_PREFIX)) {
    const encodedLink = name.slice(AGENT_CONVERSATION_TERMINAL_PREFIX.length);
    const separatorIndex = encodedLink.indexOf(":");
    if (separatorIndex <= 0) return null;
    const provider = encodedLink.slice(0, separatorIndex);
    if (!isAgentConversationTerminalProvider(provider)) return null;
    const encodedAgentId = encodedLink.slice(separatorIndex + 1).trim();
    if (!encodedAgentId) return null;
    try {
      const agentId = decodeURIComponent(encodedAgentId).trim();
      return agentId ? { agentId, provider } : null;
    } catch {
      return null;
    }
  }

  const legacyCodexAgentId = parseCodexConversationTerminalAgentId(name);
  return legacyCodexAgentId ? { agentId: legacyCodexAgentId, provider: "codex" } : null;
}

export function getAgentConversationTerminalProvider(
  name: string,
): AgentConversationTerminalProvider | null {
  const linkedProvider = parseAgentConversationTerminalLink(name)?.provider;
  if (linkedProvider) return linkedProvider;
  for (const provider of Object.keys(
    AGENT_CONVERSATION_TERMINAL_NAMES,
  ) as AgentConversationTerminalProvider[]) {
    if (AGENT_CONVERSATION_TERMINAL_NAMES[provider] === name) return provider;
  }
  return null;
}

export function buildCodexConversationTerminalName(agentId: string): string {
  return `${CODEX_CONVERSATION_TERMINAL_PREFIX}${agentId}`;
}

export function parseCodexConversationTerminalAgentId(name: string): string | null {
  if (!name.startsWith(CODEX_CONVERSATION_TERMINAL_PREFIX)) {
    return null;
  }
  const agentId = name.slice(CODEX_CONVERSATION_TERMINAL_PREFIX.length).trim();
  return agentId.length > 0 ? agentId : null;
}

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

function resolveFeatureToggle(
  source: AgentConversationTerminalSource,
  featureId: string,
): boolean | null {
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

function appendModelAndPerformanceArgs(
  args: string[],
  source: AgentConversationTerminalSource,
): void {
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

function appendPermissionArgs(args: string[], source: AgentConversationTerminalSource): void {
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

export function resolveAgentConversationSessionId(
  source: AgentConversationTerminalSource,
): string | null {
  return nonEmptyString(
    source.persistence?.nativeHandle ??
      source.persistence?.sessionId ??
      source.runtimeInfo?.sessionId,
  );
}

function buildCodexLaunch(
  source: AgentConversationTerminalSource,
  threadId: string,
): AgentConversationTerminalLaunch {
  const args = ["resume", "--include-non-interactive"];
  appendModelAndPerformanceArgs(args, source);
  appendPermissionArgs(args, source);

  args.push("--cd", source.cwd, threadId);
  return {
    provider: "codex",
    name: CODEX_CONVERSATION_TERMINAL_NAME,
    command: "codex",
    args,
  };
}

function resolveActiveMode(source: AgentConversationTerminalSource): string | null {
  return nonEmptyString(
    source.currentModeId ?? source.runtimeInfo?.modeId ?? source.config?.modeId,
  );
}

const CLAUDE_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CLAUDE_PERMISSION_MODES = new Set([
  "plan",
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
]);

function buildClaudeLaunch(
  source: AgentConversationTerminalSource,
  sessionId: string,
): AgentConversationTerminalLaunch {
  const args = ["--resume", sessionId];
  const model = nonEmptyString(source.runtimeInfo?.model ?? source.config?.model);
  if (model) {
    args.push("--model", model);
  }

  const effort = nonEmptyString(
    source.runtimeInfo?.thinkingOptionId ?? source.config?.thinkingOptionId,
  );
  if (effort && CLAUDE_EFFORT_LEVELS.has(effort)) {
    args.push("--effort", effort);
  }

  const mode = resolveActiveMode(source);
  if (mode && CLAUDE_PERMISSION_MODES.has(mode)) {
    args.push("--permission-mode", mode);
  }

  return {
    provider: "claude",
    name: AGENT_CONVERSATION_TERMINAL_NAMES.claude,
    command: "claude",
    args,
  };
}

function buildCursorLaunch(
  source: AgentConversationTerminalSource,
  sessionId: string,
): AgentConversationTerminalLaunch {
  const args = ["--resume", sessionId, "--workspace", source.cwd, "--trust"];
  const model = nonEmptyString(source.runtimeInfo?.model ?? source.config?.model);
  if (model) {
    args.push("--model", model);
  }

  const mode = resolveActiveMode(source);
  if (mode === "plan" || mode === "ask") {
    args.push("--mode", mode);
  }

  if (source.config?.featureValues?.auto_accept === true) {
    args.push("--yolo");
  }

  return {
    provider: "cursor",
    name: AGENT_CONVERSATION_TERMINAL_NAMES.cursor,
    command: "cursor-agent",
    args,
    env: { CURSOR_CONFIG_DIR: resolveCursorConfigDirectory(source.cwd) },
  };
}

function applyProviderRuntimeSettings(
  launch: AgentConversationTerminalLaunch,
  runtimeSettings: ProviderRuntimeSettings | undefined,
): AgentConversationTerminalLaunch {
  const commandConfig = runtimeSettings?.command;
  const command = commandConfig?.mode === "replace" ? commandConfig.argv[0] : launch.command;
  let prefixArgs: string[] = [];
  if (commandConfig?.mode === "replace") {
    prefixArgs = commandConfig.argv.slice(1);
  } else if (commandConfig?.mode === "append") {
    prefixArgs = commandConfig.args ?? [];
  }
  const env = { ...launch.env, ...runtimeSettings?.env };
  return {
    ...launch,
    command,
    args: [...prefixArgs, ...launch.args],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function buildAgentConversationTerminalLaunch(
  source: AgentConversationTerminalSource,
): AgentConversationTerminalLaunch {
  if (!isAgentConversationTerminalProvider(source.provider)) {
    throw new Error(`Provider '${source.provider}' does not support a conversation terminal`);
  }

  const sessionId = resolveAgentConversationSessionId(source);
  if (!sessionId) {
    throw new Error(`The ${source.provider} conversation does not have a resumable session id yet`);
  }

  let launch: AgentConversationTerminalLaunch;
  switch (source.provider) {
    case "codex":
      launch = buildCodexLaunch(source, sessionId);
      break;
    case "claude":
      launch = buildClaudeLaunch(source, sessionId);
      break;
    case "cursor":
      launch = buildCursorLaunch(source, sessionId);
      break;
  }
  return applyProviderRuntimeSettings(launch, source.runtimeSettings);
}

export function buildCodexConversationTerminalLaunch(
  source: CodexConversationTerminalSource,
): CodexConversationTerminalLaunch {
  if (source.provider !== "codex") {
    throw new Error("Only Codex conversations can be opened in a Codex terminal");
  }

  const threadId = resolveAgentConversationSessionId(source);
  if (!threadId) {
    throw new Error("The Codex conversation does not have a resumable thread id yet");
  }
  return applyProviderRuntimeSettings(buildCodexLaunch(source, threadId), source.runtimeSettings);
}
