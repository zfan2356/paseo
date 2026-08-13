import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_HOOK_PROVIDERS,
  installAgentConversationHooks,
  installRegisteredAgentHooks,
} from "./provider-registry.js";
import {
  AGENT_CONVERSATION_TERMINAL_ENV,
  type AgentHookProvider,
  uninstallAgentHooks,
} from "./agent-hook-installer.js";

const temporaryDirs: string[] = [];

interface WarningLogEntry {
  bindings: Record<string, unknown>;
  message: string;
}

interface WarningLogger {
  entries: WarningLogEntry[];
  warn(bindings: Record<string, unknown>, message: string): void;
}

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

function createWarningLogger(): WarningLogger {
  return {
    entries: [],
    warn(bindings, message) {
      this.entries.push({ bindings, message });
    },
  };
}

describe("terminal agent hook provider registry", () => {
  it("continues installing provider hooks after one provider fails", () => {
    const root = createTempDir("paseo-agent-hook-registry-");
    const badClaudeConfigDir = join(root, "not-a-directory");
    const codexHome = join(root, "codex");
    const opencodeConfigDir = join(root, "opencode");
    const homeDir = join(root, "home");
    const logger = createWarningLogger();
    writeFileSync(badClaudeConfigDir, "");

    const results = installRegisteredAgentHooks({
      env: {
        CLAUDE_CONFIG_DIR: badClaudeConfigDir,
        CODEX_HOME: codexHome,
        OPENCODE_CONFIG_DIR: opencodeConfigDir,
      },
      homeDir,
      logger,
    });

    expect(results.map((result) => result.configPath)).toEqual([
      join(codexHome, "hooks.json"),
      join(homeDir, ".cursor", "hooks.json"),
      join(opencodeConfigDir, "plugins", "paseo-terminal-activity.js"),
    ]);
    expect(existsSync(join(codexHome, "hooks.json"))).toBe(true);
    expect(existsSync(join(opencodeConfigDir, "plugins", "paseo-terminal-activity.js"))).toBe(true);
    expect(logger.entries).toEqual([
      {
        bindings: expect.objectContaining({ err: expect.any(Error), provider: "claude" }),
        message: "Failed to install terminal activity hook provider",
      },
    ]);
  });

  it.each([
    ["claude", "settings.json"],
    ["codex", "hooks.json"],
    ["cursor", "hooks.json"],
  ] as const)("installs %s hooks gated to conversation terminals", (provider, configFile) => {
    const configDir = createTempDir(`paseo-${provider}-conversation-hooks-`);

    const result = installAgentConversationHooks(provider, { configDir });

    expect(result?.configPath).toBe(join(configDir, configFile));
    const raw = readFileSync(join(configDir, configFile), "utf8");
    expect(raw).toContain(AGENT_CONVERSATION_TERMINAL_ENV);
    expect(raw).toContain(`hooks ${provider}`);
  });

  it("pins conversation hooks to the current daemon CLI for older terminal workers", () => {
    const configDir = createTempDir("paseo-cursor-conversation-cli-");
    const hookCliPath = "/Applications/Paseo.app/Contents/Resources/bin/paseo";

    installAgentConversationHooks("cursor", { configDir, hookCliPath });

    const raw = readFileSync(join(configDir, "hooks.json"), "utf8");
    expect(raw).toContain(`${hookCliPath} hooks cursor`);
    expect(raw).not.toContain("PASEO_HOOK_CLI");
  });

  it.each(["claude", "codex", "cursor"] as const)(
    "keeps %s conversation hooks when ordinary terminal hooks are removed",
    (providerId) => {
      const configDir = createTempDir(`paseo-${providerId}-conversation-preserve-`);

      installAgentConversationHooks(providerId, { configDir });
      uninstallAgentHooks(AGENT_HOOK_PROVIDERS[providerId] as AgentHookProvider, { configDir });

      expect(
        readFileSync(join(configDir, AGENT_HOOK_PROVIDERS[providerId].install.configFile), "utf8"),
      ).toContain(AGENT_CONVERSATION_TERMINAL_ENV);
    },
  );
});
