import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const HANDOFF_MARKER = ".paseo-agent-terminal.json";
const HANDOFF_VERSION = 1;

interface CursorConversationStoreOptions {
  cwd: string;
  sessionId: string;
  configDir?: string;
}

interface CursorConversationStorePaths {
  acpSessionDir: string;
  configDir: string;
  terminalSessionDir: string;
  workspaceChatsDir: string;
  workspaceHash: string;
}

interface CursorConversationHandoffMarker {
  version: number;
  provider: "cursor";
  sessionId: string;
  workspaceHash: string;
}

function resolveConfigRoot(cwd: string, configuredPath: string): string {
  return isAbsolute(configuredPath) ? configuredPath : resolve(cwd, configuredPath);
}

export function resolveCursorConfigDirectory(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.CURSOR_CONFIG_DIR?.trim();
  if (configured) return resolveConfigRoot(cwd, configured);

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) return resolveConfigRoot(cwd, join(xdgConfigHome, "cursor"));

  return join(homedir(), ".cursor");
}

function assertSafeSessionId(sessionId: string): void {
  if (!sessionId || basename(sessionId) !== sessionId || sessionId === "." || sessionId === "..") {
    throw new Error("Cursor conversation session id is not a safe path segment");
  }
}

async function resolveStorePaths(
  options: CursorConversationStoreOptions,
): Promise<CursorConversationStorePaths> {
  assertSafeSessionId(options.sessionId);
  const physicalCwd = await realpath(options.cwd);
  const configDir = options.configDir
    ? resolveConfigRoot(physicalCwd, options.configDir)
    : resolveCursorConfigDirectory(physicalCwd);
  const workspaceHash = createHash("md5").update(physicalCwd).digest("hex");
  const workspaceChatsDir = join(configDir, "chats", workspaceHash);
  return {
    acpSessionDir: join(configDir, "acp-sessions", options.sessionId),
    configDir,
    terminalSessionDir: join(workspaceChatsDir, options.sessionId),
    workspaceChatsDir,
    workspaceHash,
  };
}

async function pathKind(path: string): Promise<"directory" | "missing" | "other"> {
  try {
    const entry = await lstat(path);
    return entry.isDirectory() ? "directory" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function atomicSiblingPath(target: string, suffix: string): string {
  return join(dirname(target), `.${basename(target)}.paseo-${suffix}`);
}

async function recoverAtomicReplacement(target: string): Promise<void> {
  const backup = atomicSiblingPath(target, "backup");
  const staging = atomicSiblingPath(target, "staging");
  const [targetKind, backupKind] = await Promise.all([pathKind(target), pathKind(backup)]);

  if (targetKind === "missing" && backupKind === "directory") {
    await rename(backup, target);
  } else if (targetKind !== "missing" && backupKind !== "missing") {
    await rm(backup, { recursive: true, force: true });
  } else if (backupKind === "other") {
    throw new Error(`Cursor handoff backup is not a directory: ${backup}`);
  }

  await rm(staging, { recursive: true, force: true });
}

async function replaceDirectoryAtomically(
  source: string,
  target: string,
  prepareStaging?: (staging: string) => Promise<void>,
): Promise<void> {
  if ((await pathKind(source)) !== "directory") {
    throw new Error(`Cursor conversation store is missing: ${source}`);
  }

  await mkdir(dirname(target), { recursive: true });
  await recoverAtomicReplacement(target);

  const backup = atomicSiblingPath(target, "backup");
  const staging = atomicSiblingPath(target, "staging");
  await cp(source, staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  await prepareStaging?.(staging);

  const targetKind = await pathKind(target);
  if (targetKind === "other") {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`Cursor conversation store target is not a directory: ${target}`);
  }

  let movedTarget = false;
  try {
    if (targetKind === "directory") {
      await rename(target, backup);
      movedTarget = true;
    }
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (movedTarget && (await pathKind(target)) === "missing") {
      await rename(backup, target).catch(() => undefined);
    }
    throw error;
  }

  if (movedTarget) {
    await rm(backup, { recursive: true, force: true });
  }
}

function expectedMarker(
  options: CursorConversationStoreOptions,
  paths: CursorConversationStorePaths,
): CursorConversationHandoffMarker {
  return {
    version: HANDOFF_VERSION,
    provider: "cursor",
    sessionId: options.sessionId,
    workspaceHash: paths.workspaceHash,
  };
}

async function readMarker(
  terminalSessionDir: string,
): Promise<CursorConversationHandoffMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(join(terminalSessionDir, HANDOFF_MARKER), "utf8"));
    if (
      parsed?.version === HANDOFF_VERSION &&
      parsed?.provider === "cursor" &&
      typeof parsed?.sessionId === "string" &&
      typeof parsed?.workspaceHash === "string"
    ) {
      return parsed as CursorConversationHandoffMarker;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function markerMatches(
  actual: CursorConversationHandoffMarker | null,
  expected: CursorConversationHandoffMarker,
): boolean {
  return (
    actual?.version === expected.version &&
    actual.provider === expected.provider &&
    actual.sessionId === expected.sessionId &&
    actual.workspaceHash === expected.workspaceHash
  );
}

export async function prepareCursorConversationTerminalStore(
  options: CursorConversationStoreOptions,
): Promise<void> {
  const paths = await resolveStorePaths(options);
  const marker = expectedMarker(options, paths);
  await recoverAtomicReplacement(paths.terminalSessionDir);

  const existingKind = await pathKind(paths.terminalSessionDir);
  if (existingKind === "other") {
    throw new Error(
      `Cursor conversation store target is not a directory: ${paths.terminalSessionDir}`,
    );
  }
  if (existingKind === "directory") {
    const existingMarker = await readMarker(paths.terminalSessionDir);
    if (!markerMatches(existingMarker, marker)) {
      throw new Error(
        `Cursor TUI session already exists outside Paseo handoff control: ${paths.terminalSessionDir}`,
      );
    }
    await syncCursorConversationTerminalStore(options);
  }

  await replaceDirectoryAtomically(
    paths.acpSessionDir,
    paths.terminalSessionDir,
    async (staging) => {
      await writeFile(join(staging, HANDOFF_MARKER), JSON.stringify(marker), "utf8");
    },
  );
}

export async function syncCursorConversationTerminalStore(
  options: CursorConversationStoreOptions,
): Promise<boolean> {
  const paths = await resolveStorePaths(options);
  await recoverAtomicReplacement(paths.terminalSessionDir);
  if ((await pathKind(paths.terminalSessionDir)) === "missing") return false;

  const marker = expectedMarker(options, paths);
  if (!markerMatches(await readMarker(paths.terminalSessionDir), marker)) return false;

  await replaceDirectoryAtomically(
    paths.terminalSessionDir,
    paths.acpSessionDir,
    async (staging) => {
      await rm(join(staging, HANDOFF_MARKER), { force: true });
    },
  );
  await rm(paths.terminalSessionDir, { recursive: true, force: true });
  await rmdir(paths.workspaceChatsDir).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOENT") throw error;
  });
  return true;
}

export async function getCursorConversationStorePathsForTest(
  options: CursorConversationStoreOptions,
): Promise<CursorConversationStorePaths> {
  return resolveStorePaths(options);
}
