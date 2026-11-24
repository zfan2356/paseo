import type {
  AgentConversationTerminalLaunch,
  AgentConversationTerminalSource,
} from "./codex-fork-terminal.js";

export function buildAntigravityLaunch(
  source: AgentConversationTerminalSource,
  sessionId: string,
): AgentConversationTerminalLaunch {
  const args = ["--tui", sessionId];
  const model = source.runtimeInfo?.model ?? source.config?.model;
  if (model) args.push("--model", model);
  const mode = source.currentModeId ?? source.runtimeInfo?.modeId ?? source.config?.modeId;
  const autoAccept = source.config?.featureValues?.auto_accept === true;
  if (mode === "yolo" || autoAccept) {
    args.push("--dangerously-skip-permissions");
  } else if (mode === "auto_edit") {
    args.push("--mode", "accept-edits");
  }
  return {
    provider: "antigravity",
    name: "Antigravity Conversation",
    command: "antigravity-acp-ichat",
    args,
  };
}
