import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHooksAreInstalled,
  installAgentHooks,
  uninstallAgentHooks,
} from "../agent-hook-installer.js";
import { cursorAgentHookProvider } from "./cursor.js";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

interface TestCursorHooksFile {
  version?: number;
  hooks?: Record<string, unknown>;
}

function readHooksFile(configDir: string): TestCursorHooksFile {
  return JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8")) as TestCursorHooksFile;
}

function hookCommands(config: TestCursorHooksFile, event: string): string[] {
  const entries = config.hooks?.[event];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.command !== "string") return [];
    return [entry.command];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Cursor terminal agent hooks", () => {
  it("installs Cursor hooks without replacing unrelated user hooks", () => {
    const configDir = createTempDir("paseo-cursor-config-");
    writeFileSync(
      join(configDir, "hooks.json"),
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            stop: [{ command: "say cursor done", timeout: 5 }],
          },
        },
        null,
        2,
      )}\n`,
    );

    installAgentHooks(cursorAgentHookProvider, { configDir });
    const secondInstall = installAgentHooks(cursorAgentHookProvider, { configDir });

    const config = readHooksFile(configDir);
    expect(config.version).toBe(1);
    expect(hookCommands(config, "stop")).toEqual([
      "say cursor done",
      'if [ -n "$PASEO_TERMINAL_ID" ]; then "${PASEO_HOOK_CLI:-paseo}" hooks cursor stop; fi',
    ]);
    expect(secondInstall.changed).toBe(false);
    expect(agentHooksAreInstalled(cursorAgentHookProvider, { configDir })).toBe(true);
  });

  it("uninstalls only Paseo Cursor hooks", () => {
    const configDir = createTempDir("paseo-cursor-config-uninstall-");
    installAgentHooks(cursorAgentHookProvider, { configDir });
    const config = readHooksFile(configDir);
    config.hooks = {
      ...config.hooks,
      stop: [
        ...(Array.isArray(config.hooks?.stop) ? config.hooks.stop : []),
        { command: "say still-here", timeout: 5 },
      ],
    };
    writeFileSync(join(configDir, "hooks.json"), `${JSON.stringify(config, null, 2)}\n`);

    uninstallAgentHooks(cursorAgentHookProvider, { configDir });

    expect(hookCommands(readHooksFile(configDir), "stop")).toEqual(["say still-here"]);
    expect(agentHooksAreInstalled(cursorAgentHookProvider, { configDir })).toBe(false);
  });

  it.each([
    ["beforeSubmitPrompt", "running"],
    ["preToolUse", "running"],
    ["postToolUse", "running"],
    ["stop", "idle"],
    ["sessionEnd", "idle"],
  ] as const)("maps %s to %s", async (event, state) => {
    await expect(
      cursorAgentHookProvider.resolveActivity({
        event,
        input: { read: async () => null },
      }),
    ).resolves.toBe(state);
  });
});
