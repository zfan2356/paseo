import { execFile } from "node:child_process";
import { shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createChromeAwareExternalUrlOwner,
  createExternalUrlOpener,
  decideMainWindowLinkAction,
} from "./opener";

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

function createChromeAwareOpener() {
  return createExternalUrlOpener(
    createChromeAwareExternalUrlOwner({ open: (url) => shell.openExternal(url) }),
  );
}

describe("desktop opener", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
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

  it("passes a canonical web URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("https://example.com/docs#install");

    expect(opened).toEqual(["https://example.com/docs#install"]);
  });

  it("does not hand non-web or relative URLs to the external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    for (const input of [
      "file:///private/data",
      "javascript:alert(1)",
      "paseo://settings",
      "/docs",
      null,
    ]) {
      await expect(open(input)).rejects.toThrow("Only HTTP(S) URLs can open externally.");
    }

    expect(opened).toEqual([]);
  });

  it("opens allowed URLs in Google Chrome on macOS", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const open = createChromeAwareOpener();

    await open("https://example.com");

    expect(execFile).toHaveBeenCalledWith(
      "open",
      ["-b", "com.google.chrome", "--", "https://example.com/"],
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
    const open = createChromeAwareOpener();

    await open("https://example.com");

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/");
  });

  it("opens allowed URLs through Electron shell off macOS", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const open = createChromeAwareOpener();

    await open("https://example.com");

    expect(execFile).not.toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/");
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
