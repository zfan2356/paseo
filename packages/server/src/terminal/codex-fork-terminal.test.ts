import { describe, expect, test } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildAgentConversationTerminalLaunch,
  buildAgentConversationTerminalName,
  buildCodexConversationTerminalLaunch,
  buildCodexConversationTerminalName,
  getAgentConversationTerminalDisplayName,
  parseAgentConversationTerminalLink,
  parseCodexConversationTerminalAgentId,
} from "./codex-fork-terminal.js";

describe("agent conversation terminal metadata", () => {
  test.each([
    ["codex", "Codex Conversation"],
    ["claude", "Claude Code Conversation"],
    ["cursor", "Cursor Conversation"],
  ] as const)("round-trips a %s terminal link", (provider, displayName) => {
    const name = buildAgentConversationTerminalName("agent-1", provider);
    expect(parseAgentConversationTerminalLink(name)).toEqual({ agentId: "agent-1", provider });
    expect(getAgentConversationTerminalDisplayName(provider)).toBe(displayName);
  });

  test("recognizes legacy Codex terminal names", () => {
    expect(
      parseAgentConversationTerminalLink(buildCodexConversationTerminalName("agent-1")),
    ).toEqual({
      agentId: "agent-1",
      provider: "codex",
    });
  });
});

describe("buildAgentConversationTerminalLaunch", () => {
  test("resumes a Claude Code session with its active model, effort, and permission mode", () => {
    expect(
      buildAgentConversationTerminalLaunch({
        provider: "claude",
        cwd: "/work/paseo",
        persistence: {
          provider: "claude",
          sessionId: "session-1",
          nativeHandle: "session-native",
        },
        runtimeInfo: {
          provider: "claude",
          sessionId: "session-native",
          model: "claude-opus-5[1m]",
          thinkingOptionId: "xhigh",
          modeId: "bypassPermissions",
        },
        currentModeId: "bypassPermissions",
        config: {
          model: "stale-model",
          thinkingOptionId: "medium",
          modeId: "bypassPermissions",
        },
      }),
    ).toEqual({
      provider: "claude",
      name: "Claude Code Conversation",
      command: "claude",
      args: [
        "--resume",
        "session-native",
        "--model",
        "claude-opus-5[1m]",
        "--effort",
        "xhigh",
        "--permission-mode",
        "bypassPermissions",
      ],
    });
  });

  test("resumes a Cursor chat with its workspace, model, mode, and auto-accept setting", () => {
    expect(
      buildAgentConversationTerminalLaunch({
        provider: "cursor",
        cwd: "/work/paseo",
        persistence: {
          provider: "cursor",
          sessionId: "chat-1",
        },
        runtimeInfo: {
          provider: "cursor",
          sessionId: "chat-1",
          model: "grok-4.6",
          thinkingOptionId: "high",
          modeId: "plan",
        },
        currentModeId: "plan",
        config: {
          model: "stale-model",
          modeId: "plan",
          featureValues: { auto_accept: true },
        },
      }),
    ).toEqual({
      provider: "cursor",
      name: "Cursor Conversation",
      command: "cursor-agent",
      env: { CURSOR_CONFIG_DIR: join(homedir(), ".cursor") },
      args: [
        "--resume",
        "chat-1",
        "--workspace",
        "/work/paseo",
        "--trust",
        "--model",
        "grok-4.6",
        "--mode",
        "plan",
        "--yolo",
      ],
    });
  });

  test("rejects unsupported providers and missing persistence handles", () => {
    expect(() =>
      buildAgentConversationTerminalLaunch({
        provider: "opencode",
        cwd: "/work/paseo",
        persistence: { provider: "opencode", sessionId: "session-1" },
      }),
    ).toThrow("does not support a conversation terminal");

    expect(() =>
      buildAgentConversationTerminalLaunch({
        provider: "claude",
        cwd: "/work/paseo",
        persistence: null,
      }),
    ).toThrow("resumable session id");
  });
});

describe("buildCodexConversationTerminalLaunch", () => {
  test("round-trips the linked Agent id through the persistent terminal name", () => {
    const name = buildCodexConversationTerminalName("agent-1");
    expect(parseCodexConversationTerminalAgentId(name)).toBe("agent-1");
    expect(parseCodexConversationTerminalAgentId("Codex Conversation")).toBeNull();
  });

  test("inherits the active model, thinking, full-access, and fast settings", () => {
    expect(
      buildCodexConversationTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        workspaceId: "workspace-1",
        persistence: {
          provider: "codex",
          sessionId: "thread-1",
          nativeHandle: "thread-native",
        },
        runtimeInfo: {
          provider: "codex",
          sessionId: "thread-native",
          model: "gpt-5.6-sol",
          thinkingOptionId: "xhigh",
          modeId: "full-access",
        },
        currentModeId: "full-access",
        config: {
          modeId: "full-access",
          model: "stale-model",
          thinkingOptionId: "medium",
          featureValues: { fast_mode: false },
        },
        features: [
          {
            type: "toggle",
            id: "fast_mode",
            label: "Fast",
            value: true,
          },
        ],
      }),
    ).toEqual({
      provider: "codex",
      name: "Codex Conversation",
      command: "codex",
      args: [
        "resume",
        "--include-non-interactive",
        "--model",
        "gpt-5.6-sol",
        "--config",
        'model_reasoning_effort="xhigh"',
        "--config",
        'service_tier="fast"',
        "--ask-for-approval",
        "never",
        "--sandbox",
        "danger-full-access",
        "--cd",
        "/work/paseo",
        "thread-native",
      ],
    });
  });

  test("inherits the configured Codex command and environment", () => {
    expect(
      buildCodexConversationTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        persistence: { provider: "codex", sessionId: "thread-1" },
        runtimeSettings: {
          command: {
            mode: "replace",
            argv: ["/opt/codex-wrapper", "--ichat"],
          },
          env: { CODEX_HOME: "/work/codex-home" },
        },
      }),
    ).toEqual({
      provider: "codex",
      name: "Codex Conversation",
      command: "/opt/codex-wrapper",
      args: ["--ichat", "resume", "--include-non-interactive", "--cd", "/work/paseo", "thread-1"],
      env: { CODEX_HOME: "/work/codex-home" },
    });
  });

  test("lets validated provider options override the permission preset", () => {
    expect(
      buildCodexConversationTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        persistence: { provider: "codex", sessionId: "thread-2" },
        currentModeId: "full-access",
        config: {
          providerOptions: {
            approval_policy: "on-request",
            sandbox_mode: "workspace-write",
            sandbox_workspace_write: {
              writable_roots: ["/tmp/shared"],
              network_access: true,
            },
          },
        },
      }).args,
    ).toEqual([
      "resume",
      "--include-non-interactive",
      "--ask-for-approval",
      "on-request",
      "--sandbox",
      "workspace-write",
      "--config",
      'sandbox_workspace_write.writable_roots=["/tmp/shared"]',
      "--config",
      "sandbox_workspace_write.network_access=true",
      "--cd",
      "/work/paseo",
      "thread-2",
    ]);
  });

  test("does not turn a provider default mode into an explicit CLI override", () => {
    expect(
      buildCodexConversationTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        persistence: { provider: "codex", sessionId: "thread-default" },
        currentModeId: "auto-review",
        config: {},
      }).args,
    ).toEqual(["resume", "--include-non-interactive", "--cd", "/work/paseo", "thread-default"]);
  });

  test("rejects non-Codex agents and missing thread ids", () => {
    expect(() =>
      buildCodexConversationTerminalLaunch({
        provider: "claude",
        cwd: "/work/paseo",
        persistence: { provider: "claude", sessionId: "session-1" },
      }),
    ).toThrow("Only Codex conversations");

    expect(() =>
      buildCodexConversationTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        persistence: null,
      }),
    ).toThrow("resumable thread id");
  });
});
