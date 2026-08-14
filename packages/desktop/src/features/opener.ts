import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain, shell, type BrowserWindow } from "electron";

const execFile = promisify(execFileCallback);

const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);
const GOOGLE_CHROME_BUNDLE_ID = "com.google.chrome";

export type MainWindowLinkKind = "navigate" | "window-open";

export type MainWindowLinkAction =
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "open-external"; url: string };

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function decideMainWindowLinkAction(input: {
  url: string;
  appScheme: string;
  devServerOrigin: string | null;
  kind: MainWindowLinkKind;
}): MainWindowLinkAction {
  if (input.kind === "window-open") {
    if (isAllowedExternalUrl(input.url)) {
      return { kind: "open-external", url: input.url };
    }
    return { kind: "deny" };
  }

  if (input.url.startsWith("file://")) {
    return { kind: "deny" };
  }
  if (isAppOwnedNavigation(input.url, input.appScheme, input.devServerOrigin)) {
    return { kind: "allow" };
  }
  if (isAllowedExternalUrl(input.url)) {
    return { kind: "open-external", url: input.url };
  }
  return { kind: "deny" };
}

export async function openAllowedExternalUrl(url: unknown): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error("Unsupported external URL");
  }
  if (process.platform === "darwin") {
    try {
      await execFile("open", ["-b", GOOGLE_CHROME_BUNDLE_ID, "--", url]);
      return;
    } catch {
      // Chrome is missing or Launch Services cannot resolve the bundle id.
    }
  }
  await shell.openExternal(url);
}

export function registerOpenerHandlers(): void {
  ipcMain.handle("paseo:opener:openUrl", async (_event, url: unknown) => {
    await openAllowedExternalUrl(url);
  });
}

export function installMainWindowExternalLinkHandling(input: {
  window: BrowserWindow;
  appScheme: string;
  devServerOrigin: string | null;
}): void {
  const { window: win, appScheme, devServerOrigin } = input;

  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideMainWindowLinkAction({
      url,
      appScheme,
      devServerOrigin,
      kind: "window-open",
    });
    if (decision.kind === "open-external") {
      void openAllowedExternalUrl(decision.url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const decision = decideMainWindowLinkAction({
      url,
      appScheme,
      devServerOrigin,
      kind: "navigate",
    });
    if (decision.kind === "allow") {
      return;
    }
    event.preventDefault();
    if (decision.kind === "open-external") {
      void openAllowedExternalUrl(decision.url);
    }
  });
}

function isAppOwnedNavigation(
  url: string,
  appScheme: string,
  devServerOrigin: string | null,
): boolean {
  if (url.startsWith(`${appScheme}:`)) {
    return true;
  }
  if (!devServerOrigin) {
    return false;
  }
  try {
    return new URL(url).origin === devServerOrigin;
  } catch {
    return false;
  }
}
