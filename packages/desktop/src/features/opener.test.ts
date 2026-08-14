import { execFile } from "node:child_process";
import { ipcMain, shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decideMainWindowLinkAction, isAllowedExternalUrl, registerOpenerHandlers } from "./opener";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(
      (
        _file: string,
        _args: readonly string[],
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "", "");
        return undefined;
      },
    ),
  };
});

function getRegisteredOpenUrlHandler(): (_event: unknown, url: unknown) => Promise<void> {
  registerOpenerHandlers();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => {
    return channel === "paseo:opener:openUrl";
  })?.[1];
  if (typeof handler !== "function") {
    throw new Error("open URL handler was not registered");
  }
  return handler as (_event: unknown, url: unknown) => Promise<void>;
}

describe("desktop opener", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(shell.openExternal).mockReset();
    vi.mocked(execFile).mockReset();
    vi.mocked(execFile).mockImplementation(((
      _file: string,
      _args: readonly string[],
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
      return undefined;
    }) as typeof execFile);
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
  });

  it("allows only http and https external URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/path")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:8081")).toBe(true);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("paseo://settings")).toBe(false);
    expect(isAllowedExternalUrl("/relative/path")).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
  });

  it("opens allowed URLs in Google Chrome on macOS", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const handler = getRegisteredOpenUrlHandler();

    await handler({}, "https://example.com");

    expect(execFile).toHaveBeenCalledWith(
      "open",
      ["-b", "com.google.chrome", "--", "https://example.com"],
      expect.any(Function),
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the system browser when Chrome is unavailable", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.mocked(execFile).mockImplementation(((
      _file: string,
      _args: readonly string[],
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(new Error("Unable to find application"), "", "");
      return undefined;
    }) as typeof execFile);
    const handler = getRegisteredOpenUrlHandler();

    await handler({}, "https://example.com");

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("opens allowed URLs through Electron shell off macOS", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const handler = getRegisteredOpenUrlHandler();

    await handler({}, "https://example.com");

    expect(execFile).not.toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("rejects blocked URLs before invoking Chrome or Electron shell", async () => {
    const handler = getRegisteredOpenUrlHandler();

    await expect(handler({}, "file:///etc/passwd")).rejects.toThrow("Unsupported external URL");

    expect(execFile).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

describe("decideMainWindowLinkAction", () => {
  const host = {
    appScheme: "paseo",
    devServerOrigin: "http://localhost:8081",
  };

  it("keeps packaged and Expo host navigations inside the app", () => {
    expect(
      decideMainWindowLinkAction({
        ...host,
        kind: "navigate",
        url: "paseo://app/settings",
      }),
    ).toEqual({ kind: "allow" });
    expect(
      decideMainWindowLinkAction({
        ...host,
        kind: "navigate",
        url: "http://localhost:8081/workspace",
      }),
    ).toEqual({ kind: "allow" });
  });

  it("opens chat and renderer http(s) links outside Paseo", () => {
    expect(
      decideMainWindowLinkAction({
        ...host,
        kind: "navigate",
        url: "http://wandb.example.com:8080/welm/mmq_ci",
      }),
    ).toEqual({
      kind: "open-external",
      url: "http://wandb.example.com:8080/welm/mmq_ci",
    });
    expect(
      decideMainWindowLinkAction({
        ...host,
        kind: "window-open",
        url: "https://example.com/docs",
      }),
    ).toEqual({ kind: "open-external", url: "https://example.com/docs" });
  });

  it("blocks file drops and unsupported window-open schemes", () => {
    expect(
      decideMainWindowLinkAction({
        ...host,
        kind: "navigate",
        url: "file:///tmp/notes.md",
      }),
    ).toEqual({ kind: "deny" });
    expect(
      decideMainWindowLinkAction({
        ...host,
        kind: "window-open",
        url: "javascript:alert(1)",
      }),
    ).toEqual({ kind: "deny" });
  });
});
