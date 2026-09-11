import { describe, expect, test } from "vitest";
import { resolveSharedCodexSocket } from "./shared-app-server.js";

describe("shared Codex configuration", () => {
  test("keeps the independent process as the default", () => {
    expect(resolveSharedCodexSocket(undefined)).toBeNull();
    expect(resolveSharedCodexSocket({ env: { CODEX_HOME: "/custom/home" } })).toBeNull();
  });

  test("accepts an explicitly configured absolute socket", () => {
    expect(
      resolveSharedCodexSocket({ env: { PASEO_CODEX_APP_SERVER_SOCKET: "/tmp/codex.sock" } }),
    ).toBe("/tmp/codex.sock");
  });

  test("rejects ambiguous launch overrides instead of silently dropping them", () => {
    expect(() =>
      resolveSharedCodexSocket({ env: { PASEO_CODEX_APP_SERVER_SOCKET: "relative.sock" } }),
    ).toThrow("absolute Unix socket");
    expect(() =>
      resolveSharedCodexSocket({
        command: { mode: "replace", argv: ["custom-codex"] },
        env: { PASEO_CODEX_APP_SERVER_SOCKET: "/tmp/codex.sock" },
      }),
    ).toThrow("command");
    expect(() =>
      resolveSharedCodexSocket({
        env: {
          PASEO_CODEX_APP_SERVER_SOCKET: "/tmp/codex.sock",
          OPENAI_API_KEY: "test-placeholder",
        },
      }),
    ).toThrow("environment");
  });
});
