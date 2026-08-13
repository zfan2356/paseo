import { describe, expect, test } from "vitest";
import { buildCodexForkTerminalLaunch } from "./codex-fork-terminal.js";

describe("buildCodexForkTerminalLaunch", () => {
  test("inherits the active model, thinking, full-access, and fast settings", () => {
    expect(
      buildCodexForkTerminalLaunch({
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
      name: "Codex Fork",
      command: "codex",
      args: [
        "fork",
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

  test("lets validated provider options override the permission preset", () => {
    expect(
      buildCodexForkTerminalLaunch({
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
      "fork",
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
      buildCodexForkTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        persistence: { provider: "codex", sessionId: "thread-default" },
        currentModeId: "auto-review",
        config: {},
      }).args,
    ).toEqual(["fork", "--cd", "/work/paseo", "thread-default"]);
  });

  test("rejects non-Codex agents and missing thread ids", () => {
    expect(() =>
      buildCodexForkTerminalLaunch({
        provider: "claude",
        cwd: "/work/paseo",
        persistence: { provider: "claude", sessionId: "session-1" },
      }),
    ).toThrow("Only Codex conversations");

    expect(() =>
      buildCodexForkTerminalLaunch({
        provider: "codex",
        cwd: "/work/paseo",
        persistence: null,
      }),
    ).toThrow("forkable thread id");
  });
});
