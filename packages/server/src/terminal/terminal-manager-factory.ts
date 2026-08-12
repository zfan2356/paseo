import type { TerminalManager } from "./terminal-manager.js";
import { createWorkerTerminalManager } from "./worker-terminal-manager.js";

export interface ConfiguredTerminalManagerOptions {
  paseoHome: string;
  getTerminalActivityUrl?: () => string | null;
}

export async function createConfiguredTerminalManager(
  options: ConfiguredTerminalManagerOptions,
): Promise<TerminalManager> {
  return createWorkerTerminalManager(options);
}
