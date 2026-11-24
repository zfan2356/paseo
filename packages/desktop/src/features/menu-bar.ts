import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  Tray,
} from "electron";
import type { AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import { MenuBarReports, MenuBarSnapshotSchema, menuBarPresentation } from "./menu-bar/state.js";
import { createDashboard } from "./menu-bar/dashboard.js";
import { menuBarQuotaItems, type MagpieAction } from "./menu-bar/quotas.js";
import { menuBarQuotaBadge } from "./menu-bar/quota-preference.js";

interface MenuBarOptions {
  onShow: () => void | Promise<void>;
  onOpenAgent: (target: AgentDeepLinkTarget) => void | Promise<void>;
}

export function setupMenuBar({ onShow, onOpenAgent }: MenuBarOptions) {
  if (process.platform !== "darwin") return null;

  const image = nativeImage.createFromPath(
    path.resolve(__dirname, "../../assets/menu-barTemplate.png"),
  );
  if (image.isEmpty()) throw new Error("Paseo menu bar icon is missing");
  image.setTemplateImage(true);
  const tray = new Tray(image);
  const reports = new MenuBarReports();
  const windows = new Set<BrowserWindow>();
  interface PendingAction {
    senderId: number;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
  const pending = new Map<string, PendingAction>();
  async function onMagpie(action: MagpieAction) {
    const windowId = reports.latestWindow(Date.now());
    const window = [...windows].find((candidate) => candidate.id === windowId);
    if (!window || window.isDestroyed()) throw new Error("没有可用的 Paseo 连接，请先打开主窗口。");
    const snapshot = reports.current(Date.now());
    if (!snapshot?.hosts.some((host) => host.serverId === action.hostId))
      throw new Error("主机已移除。");
    if (action.kind === "source" || action.kind === "ultra") {
      const group = snapshot.quotaReports
        ?.find((report) => report.hostId === action.hostId)
        ?.groups?.find((item) => item.id === action.groupId);
      if (!group?.controllable) throw new Error("模型路由不可操作，请刷新。");
      if (
        action.kind === "ultra" &&
        action.enabled &&
        (!group.ultraAvailable || group.source === "ichat")
      )
        throw new Error("此模型或来源不支持个人 Ultra fast。");
    }
    const requestId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("操作超时，请刷新确认设置后再试。"));
      }, 35_000);
      pending.set(requestId, { senderId: window.webContents.id, resolve, reject, timer });
      window.webContents.send("paseo:menu-bar:action", { requestId, action });
    });
    if (action.kind === "magpie") await onShow();
  }
  const ResultSchema = z.object({
    requestId: z.string(),
    ok: z.boolean(),
    error: z.string().max(2000).optional(),
  });
  const handleResult = (event: Electron.IpcMainEvent, raw: unknown) => {
    const result = ResultSchema.safeParse(raw);
    if (!result.success) return;
    const entry = pending.get(result.data.requestId);
    if (
      !entry ||
      event.sender.id !== entry.senderId ||
      event.senderFrame !== event.sender.mainFrame
    )
      return;
    clearTimeout(entry.timer);
    pending.delete(result.data.requestId);
    if (result.data.ok) entry.resolve();
    else entry.reject(new Error(result.data.error || "操作失败，请重试。"));
  };
  ipcMain.on("paseo:menu-bar:action-result", handleResult);
  const dashboard = createDashboard({
    snapshot: () => reports.current(Date.now()),
    anchor: () => tray.getBounds(),
    onShow,
    onOpenAgent,
    onMagpie,
  });
  let quitting = false;
  let lastPresentation = "";
  const taskLabels = {
    waiting: "Approval",
    failed: "Failed",
    running: "Running",
    finished: "Finished",
  };
  function menuAction(action: () => void | Promise<void>) {
    return () => {
      void Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          dialog.showErrorBox(
            "无法打开 Paseo 任务",
            error instanceof Error ? error.message : String(error),
          );
        });
    };
  }
  function render() {
    dashboard.publish();
    const now = Date.now();
    const snapshot = reports.current(now);
    const status = menuBarPresentation(snapshot);
    const quota = menuBarQuotaBadge(
      menuBarQuotaItems(snapshot?.quotaReports ?? [], now),
      snapshot?.quotaPreference,
    );
    const presentation = {
      title: [quota.title, status.title].filter(Boolean).join("  "),
      summary: [quota.summary, status.summary].filter(Boolean).join(" · "),
    };
    const serialized = JSON.stringify(presentation);
    if (serialized === lastPresentation) return;
    lastPresentation = serialized;
    tray.setTitle(presentation.title, { fontType: "monospacedDigit" });
    tray.setToolTip(`Paseo: ${presentation.summary}`);
  }
  function buildMenu() {
    const snapshot = reports.current(Date.now());
    const presentation = menuBarPresentation(snapshot);
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: presentation.summary, enabled: false },
      { type: "separator" },
    ];
    if (snapshot) {
      const quotaItems = menuBarQuotaItems(snapshot.quotaReports ?? [], Date.now());
      if (quotaItems.length) {
        template.push(
          {
            label: "账号额度",
            submenu: quotaItems.map((item) => ({
              label: `${item.title} · ${item.summary}`,
              submenu: item.details.map((line) => ({ label: line, enabled: false })),
              enabled: item.details.length > 0,
            })),
          },
          { type: "separator" },
        );
      }
      const hosts = new Map(snapshot.hosts.map((host) => [host.serverId, host.label]));
      for (const task of snapshot.tasks.slice(0, 12)) {
        template.push({
          label: `${taskLabels[task.status]}: ${task.title} — ${hosts.get(task.serverId)}`,
          click: menuAction(() => onOpenAgent({ serverId: task.serverId, agentId: task.agentId })),
        });
      }
      const total = snapshot.running + snapshot.waiting + snapshot.failed + snapshot.finished;
      const shown = Math.min(snapshot.tasks.length, 12);
      if (total > shown) {
        template.push({
          label: `${total - shown} more — open Paseo`,
          click: menuAction(onShow),
        });
      }
      if (snapshot.tasks.length > 0) template.push({ type: "separator" });
      template.push({
        label: "Hosts",
        enabled: snapshot.hosts.length > 0,
        submenu: snapshot.hosts.map((host) => ({
          label: `${host.label}: ${host.status}`,
          enabled: false,
        })),
      });
    }
    template.push(
      { label: "Show Paseo", click: menuAction(onShow) },
      { type: "separator" },
      { label: "Quit Paseo", click: () => app.quit() },
    );
    return Menu.buildFromTemplate(template);
  }
  ipcMain.handle("paseo:menu-bar:update", (event, raw: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const trusted = window && windows.has(window) && event.senderFrame === event.sender.mainFrame;
    if (!trusted) throw new Error("Only Paseo main windows may report task status");
    if (raw === null) reports.remove(window.id);
    else reports.update(window.id, MenuBarSnapshotSchema.parse(raw), Date.now());
    render();
  });
  function attach(window: BrowserWindow) {
    if (windows.has(window)) return;
    windows.add(window);
    // Keep the final renderer's existing local and remote connections alive while hidden.
    window.webContents.setBackgroundThrottling(false);
    window.on("close", (event) => {
      if (quitting || windows.size > 1) return;
      event.preventDefault();
      window.hide();
    });
    const clear = () => {
      reports.remove(window.id);
      render();
    };
    window.webContents.on("did-start-navigation", (_event, _url, sameDocument, mainFrame) => {
      if (mainFrame && !sameDocument) clear();
    });
    window.webContents.on("render-process-gone", clear);
    window.on("unresponsive", clear);
    window.once("closed", () => {
      windows.delete(window);
      clear();
    });
  }
  const clearAll = () => {
    dashboard.hide();
    reports.clear();
    render();
  };
  powerMonitor.on("suspend", clearAll);
  powerMonitor.on("resume", clearAll);
  const heartbeat = setInterval(render, 5_000);
  app.on("before-quit", () => {
    quitting = true;
  });
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => {
    void dashboard.toggle();
  });
  // A fixed context menu consumes left clicks on macOS. Open it only on right click.
  tray.on("right-click", () => {
    dashboard.hide();
    render();
    tray.popUpContextMenu(buildMenu());
  });
  // Keep a strong reference until actual exit, not a cancellable before-quit event.
  app.once("will-quit", () => {
    ipcMain.removeListener("paseo:menu-bar:action-result", handleResult);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Paseo 正在退出。"));
    }
    pending.clear();
    clearInterval(heartbeat);
    ipcMain.removeHandler("paseo:menu-bar:update");
    powerMonitor.removeListener("suspend", clearAll);
    powerMonitor.removeListener("resume", clearAll);
    tray.destroy();
    dashboard.dispose();
  });
  render();
  return { tray, attach, isDashboard: dashboard.isDashboard };
}
