import { type AgentHookConfigFormat, buildAgentHookCommand } from "../agent-hook-installer.js";

interface CursorCommandHook {
  command?: unknown;
  type?: unknown;
  timeout?: unknown;
}

export interface CursorHooksFile {
  version?: unknown;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export const cursorHooksFormat: AgentHookConfigFormat<CursorHooksFile> = {
  empty() {
    return { version: 1 };
  },
  parse(raw) {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : { version: 1 };
  },
  stringify(config) {
    return `${JSON.stringify(config, null, 2)}\n`;
  },
  install(config, provider) {
    const hooks = normalizeHooks(config.hooks);
    for (const event of provider.events) {
      hooks[event.event] = [
        ...removePaseoHooks(hooks[event.event], provider.install.hookMarker),
        {
          type: "command",
          command: buildAgentHookCommand(provider, event),
          timeout: 10,
        },
      ];
    }
    return { ...config, version: 1, hooks };
  },
  uninstall(config, provider) {
    const hooks = normalizeHooks(config.hooks);
    for (const event of provider.events) {
      const entries = removePaseoHooks(hooks[event.event], provider.install.hookMarker);
      if (entries.length > 0) hooks[event.event] = entries;
      else delete hooks[event.event];
    }
    return { ...config, hooks };
  },
  isInstalled(config, provider) {
    const hooks = normalizeHooks(config.hooks);
    return provider.events.every((event) =>
      normalizeCommandHooks(hooks[event.event]).some((hook) =>
        commandContainsMarker(hook, provider.install.hookMarker),
      ),
    );
  },
};

function normalizeHooks(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeCommandHooks(value: unknown): CursorCommandHook[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function removePaseoHooks(value: unknown, marker: string): CursorCommandHook[] {
  return normalizeCommandHooks(value).filter((hook) => !commandContainsMarker(hook, marker));
}

function commandContainsMarker(hook: CursorCommandHook, marker: string): boolean {
  return typeof hook.command === "string" && hook.command.includes(marker);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
