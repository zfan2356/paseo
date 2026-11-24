import { randomBytes } from "node:crypto";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, screen, type Rectangle } from "electron";
import { z } from "zod";
import type { AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import type { MenuBarSnapshot } from "./state.js";
import { dashboardDocument } from "./dashboard-document.js";
import {
  menuBarQuotaItems,
  MagpieActionSchema,
  type MagpieAction,
  type MenuBarQuotaItem,
} from "./quotas.js";

export interface DashboardSnapshot extends MenuBarSnapshot {
  quotaItems: MenuBarQuotaItem[];
}

const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("hide") }),
  z.object({ kind: z.literal("show") }),
  z.object({ kind: z.literal("task"), serverId: z.string(), agentId: z.string() }),
  ...MagpieActionSchema.options,
]);

export function dashboardBounds(anchor: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(392, area.width - 16);
  const height = Math.min(600, area.height - 16);
  const x = Math.max(
    area.x + 8,
    Math.min(anchor.x + anchor.width / 2 - width / 2, area.x + area.width - width - 8),
  );
  const y = Math.max(
    area.y + 8,
    Math.min(anchor.y + anchor.height + 8, area.y + area.height - height - 8),
  );
  return { x: Math.round(x), y: Math.round(y), width, height };
}

interface DashboardOptions {
  snapshot: () => MenuBarSnapshot | null;
  anchor: () => Rectangle;
  onShow: () => void | Promise<void>;
  onOpenAgent: (target: AgentDeepLinkTarget) => void | Promise<void>;
  onMagpie: (action: MagpieAction) => Promise<void>;
}

export function createDashboard(options: DashboardOptions) {
  let window: BrowserWindow | null = null;
  let loading: Promise<void> | null = null;
  let wanted = false;
  let serialized = "";
  function publish(force = false) {
    if (!window || window.isDestroyed()) return;
    const source = options.snapshot();
    const snapshot: DashboardSnapshot | null = source
      ? {
          ...source,
          quotaItems: menuBarQuotaItems(source.quotaReports ?? [], Date.now()),
        }
      : null;
    const next = JSON.stringify(snapshot);
    if (!force && serialized === next) return;
    serialized = next;
    window.webContents.send("paseo:board:snapshot", snapshot);
  }
  function hide() {
    wanted = false;
    window?.hide();
  }
  ipcMain.handle("paseo:board:action", async (event, raw: unknown) => {
    const trusted =
      window && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame;
    if (!trusted) throw new Error("Only the task board may invoke this action");
    const action = ActionSchema.parse(raw);
    if (action.kind === "ready") {
      publish(true);
      return;
    }
    if (action.kind === "hide") {
      hide();
      return;
    }
    if (
      action.kind === "refresh" ||
      action.kind === "source" ||
      action.kind === "ultra" ||
      action.kind === "magpie"
    ) {
      await options.onMagpie(action);
      if (action.kind === "magpie") hide();
      return;
    }
    if (action.kind === "show") await options.onShow();
    else {
      const task = options
        .snapshot()
        ?.tasks.find(
          (item) => item.serverId === action.serverId && item.agentId === action.agentId,
        );
      if (!task) throw new Error("Task is no longer available; refresh host status");
      await options.onOpenAgent({ serverId: task.serverId, agentId: task.agentId });
    }
    hide();
  });
  async function toggle() {
    wanted = !wanted;
    if (!wanted) {
      hide();
      return;
    }
    if (!window) {
      window = new BrowserWindow({
        title: "Paseo · 任务看板",
        width: 392,
        height: 600,
        show: false,
        frame: false,
        transparent: true,
        vibrancy: "popover",
        visualEffectState: "active",
        roundedCorners: true,
        hasShadow: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: "#00000000",
        webPreferences: {
          preload: path.join(__dirname, "dashboard-preload.js"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      window.on("blur", hide);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("before-input-event", (event, input) => {
        if (input.key === "Escape") {
          event.preventDefault();
          hide();
        }
      });
      window.on("closed", () => {
        window = null;
        loading = null;
        wanted = false;
      });
      const document = dashboardDocument(randomBytes(18).toString("base64"));
      loading = window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
    }
    try {
      await loading;
      if (!wanted || !window) return;
      const anchor = options.anchor();
      window.setBounds(dashboardBounds(anchor, screen.getDisplayMatching(anchor).workArea));
      publish(true);
      window.show();
      window.focus();
    } catch {
      window?.destroy();
      dialog.showErrorBox("无法打开任务看板", "请从右键菜单打开 Paseo，或稍后重试。");
    }
  }
  return {
    toggle,
    hide,
    publish,
    isDashboard: (candidate: BrowserWindow) => candidate === window,
    dispose() {
      ipcMain.removeHandler("paseo:board:action");
      window?.destroy();
    },
  };
}
