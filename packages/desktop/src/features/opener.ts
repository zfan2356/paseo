import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { shell, type BrowserWindow } from "electron";

const execFile = promisify(execFileCallback);
const GOOGLE_CHROME_BUNDLE_ID = "com.google.chrome";
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

interface ExternalUrlOwner {
  open(url: string): Promise<void>;
}

export type MainWindowLinkKind = "navigate" | "window-open";

export type MainWindowLinkAction =
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "open-external"; url: string };

const asExternalUrl = (input: unknown): URL | undefined => {
  if (typeof input !== "string" || !URL.canParse(input)) return undefined;
  const candidate = new URL(input);
  return EXTERNAL_PROTOCOLS.has(candidate.protocol) ? candidate : undefined;
};

export function isAllowedExternalUrl(value: unknown): value is string {
  return asExternalUrl(value) !== undefined;
}

export function createChromeAwareExternalUrlOwner(
  owner: ExternalUrlOwner = { open: (url) => shell.openExternal(url) },
): ExternalUrlOwner {
  return {
    async open(url: string) {
      if (process.platform === "darwin") {
        try {
          await execFile("open", ["-b", GOOGLE_CHROME_BUNDLE_ID, "--", url]);
          return;
        } catch {
          // Chrome is missing or Launch Services cannot resolve the bundle id.
        }
      }
      await owner.open(url);
    },
  };
}

export function createExternalUrlOpener(owner: ExternalUrlOwner) {
  return async (candidate: unknown): Promise<void> => {
    const url = asExternalUrl(candidate);
    if (url === undefined) {
      throw new Error("Only HTTP(S) URLs can open externally.");
    }
    return owner.open(url.href);
  };
}

export async function openAllowedExternalUrl(url: unknown): Promise<void> {
  return createExternalUrlOpener(createChromeAwareExternalUrlOwner())(url);
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
