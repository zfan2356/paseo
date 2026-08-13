import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  getCursorConversationStorePathsForTest,
  prepareCursorConversationTerminalStore,
  resolveCursorConfigDirectory,
  syncCursorConversationTerminalStore,
} from "./cursor-conversation-store.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "cursor-conversation-store-"));
  cleanupRoots.push(root);
  const cwd = join(root, "workspace");
  const configDir = join(root, "cursor-config");
  const sessionId = "610786d6-3ec9-4ac8-b9a8-5db7535c785e";
  await mkdir(cwd, { recursive: true });
  const paths = await getCursorConversationStorePathsForTest({ cwd, configDir, sessionId });
  await mkdir(paths.acpSessionDir, { recursive: true });
  await writeFile(join(paths.acpSessionDir, "store.db"), "agent-history", "utf8");
  await writeFile(
    join(paths.acpSessionDir, "meta.json"),
    JSON.stringify({ schemaVersion: 1, cwd }),
    "utf8",
  );
  return { cwd, configDir, paths, sessionId };
}

describe("resolveCursorConfigDirectory", () => {
  test("matches Cursor's config environment precedence", () => {
    expect(
      resolveCursorConfigDirectory("/work/repo", {
        CURSOR_CONFIG_DIR: "relative-config",
        XDG_CONFIG_HOME: "/ignored",
      }),
    ).toBe(resolve("/work/repo", "relative-config"));
    expect(resolveCursorConfigDirectory("/work/repo", { XDG_CONFIG_HOME: "/xdg" })).toBe(
      "/xdg/cursor",
    );
  });
});

describe("Cursor conversation store handoff", () => {
  test("copies Agent history to the TUI and returns TUI history to ACP", async () => {
    const fixture = await createFixture();
    const options = {
      cwd: fixture.cwd,
      configDir: fixture.configDir,
      sessionId: fixture.sessionId,
    };

    await prepareCursorConversationTerminalStore(options);
    expect(await readFile(join(fixture.paths.terminalSessionDir, "store.db"), "utf8")).toBe(
      "agent-history",
    );

    await writeFile(join(fixture.paths.terminalSessionDir, "store.db"), "tui-history", "utf8");
    await writeFile(join(fixture.paths.terminalSessionDir, "prompt_history.json"), "[]", "utf8");

    await expect(syncCursorConversationTerminalStore(options)).resolves.toBe(true);
    expect(await readFile(join(fixture.paths.acpSessionDir, "store.db"), "utf8")).toBe(
      "tui-history",
    );
    expect(await readFile(join(fixture.paths.acpSessionDir, "prompt_history.json"), "utf8")).toBe(
      "[]",
    );
    await expect(
      readFile(join(fixture.paths.acpSessionDir, ".paseo-agent-terminal.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(fixture.paths.terminalSessionDir, "store.db")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("refuses to overwrite an existing unmanaged TUI session", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.paths.terminalSessionDir, { recursive: true });
    await writeFile(join(fixture.paths.terminalSessionDir, "store.db"), "unmanaged", "utf8");

    await expect(
      prepareCursorConversationTerminalStore({
        cwd: fixture.cwd,
        configDir: fixture.configDir,
        sessionId: fixture.sessionId,
      }),
    ).rejects.toThrow("outside Paseo handoff control");
    expect(await readFile(join(fixture.paths.terminalSessionDir, "store.db"), "utf8")).toBe(
      "unmanaged",
    );
  });

  test("ignores unmanaged TUI storage when releasing an Agent lease", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.paths.terminalSessionDir, { recursive: true });
    await writeFile(join(fixture.paths.terminalSessionDir, "store.db"), "unmanaged", "utf8");

    await expect(
      syncCursorConversationTerminalStore({
        cwd: fixture.cwd,
        configDir: fixture.configDir,
        sessionId: fixture.sessionId,
      }),
    ).resolves.toBe(false);
    expect(await readFile(join(fixture.paths.acpSessionDir, "store.db"), "utf8")).toBe(
      "agent-history",
    );
  });
});
