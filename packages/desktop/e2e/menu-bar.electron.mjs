import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { expect } from "playwright/test";

export async function runMenuBarRegression() {
  if (process.platform !== "darwin") return;
  const root = await mkdtemp(path.join(tmpdir(), "paseo-menu-bar-"));
  const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
  const entry = path.join(root, "main.cjs");
  let desktop;
  try {
    await writeFile(
      entry,
      `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(root, "user-data"))});
app.on("window-all-closed", () => {});
app.whenReady().then(() => {
  const { setupMenuBar } = require(${JSON.stringify(path.join(desktopRoot, "dist/features/menu-bar.js"))});
  const { createDesktopWindowOwner } = require(${JSON.stringify(path.join(desktopRoot, "dist/window/desktop-window-owner.js"))});
  function owned(win) {
    return {
      webContentsId: win.webContents.id,
      isDestroyed: () => win.isDestroyed(),
      isVisible: () => win.isVisible(),
      isMinimized: () => win.isMinimized(),
      restore: () => win.restore(), show: () => win.show(), focus: () => win.focus(),
      sendAgent: () => {},
    };
  }
  const owner = createDesktopWindowOwner({
    async create() {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: ${JSON.stringify(path.join(desktopRoot, "dist/preload.js"))} },
      });
      global.menuBar.attach(win);
      await win.loadURL("data:text/html,<title>Menu bar test</title>");
      win.show();
      return owned(win);
    },
    windows: () => BrowserWindow.getAllWindows().filter(win => !global.menuBar.isDashboard(win)).map(owned),
    focusedWindow: () => {
      const win = BrowserWindow.getFocusedWindow();
      return win && !global.menuBar.isDashboard(win) ? owned(win) : null;
    },
    agentRoute: () => "/", deliverAgent: () => null,
  });
  global.shown = Promise.resolve();
  global.show = () => { global.shown = owner.restoreWhenActivated(); };
  global.opened = null;
  global.menuBar = setupMenuBar({
    onShow: () => { global.show(); return global.shown; },
    onOpenAgent: async (target) => {
      if (global.failOpen) throw new Error("Host unavailable");
      global.opened = target;
      global.show();
      await global.shown;
    },
  });
  global.tray = global.menuBar.tray;
  // Capture the real menu passed to the native popup so its actions can be exercised.
  const popup = global.tray.popUpContextMenu.bind(global.tray);
  global.tray.popUpContextMenu = (menu) => {
    global.menu = menu;
    popup(menu);
  };
  global.quitRequests = 0;
  app.on("before-quit", (event) => {
    event.preventDefault();
    global.quitRequests++;
  });
});
`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("PASEO_") && key !== "ELECTRON_RUN_AS_NODE",
      ),
    );
    desktop = await electron.launch({ args: [entry], env });
    await expect
      .poll(() => desktop.evaluate(() => global.tray?.getBounds().width ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(0);

    await desktop.evaluate(async () => {
      global.show();
      await global.shown;
    });
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    const page = await desktop.firstWindow();
    const snapshot = {
      hosts: [
        { serverId: "local", label: "Mac", status: "ready" },
        { serverId: "remote", label: "GPU", status: "offline" },
      ],
      running: 2,
      waiting: 1,
      failed: 0,
      finished: 1,
      tasks: [
        { serverId: "local", agentId: "approve-me", title: "Review changes", status: "waiting" },
      ],
    };
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), snapshot);
    assert.equal(await desktop.evaluate(() => global.tray.getTitle()), "—%  ! 1  ▶ 2  ✓ 1  ?");
    await assert.rejects(page.evaluate(() => window.paseoDesktop.menuBar.update({ running: -1 })));
    // A webview or another unregistered window cannot overwrite status.
    const rejected = await desktop.evaluate(async ({ BrowserWindow }) => {
      const rogue = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      });
      try {
        await rogue.loadURL("data:text/html,Rogue");
        return await rogue.webContents.executeJavaScript(
          'require("electron").ipcRenderer.invoke("paseo:menu-bar:update", null).then(() => false, () => true)',
        );
      } finally {
        rogue.destroy();
      }
    });
    assert.equal(rejected, true);
    await desktop.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].hide();
      global.show();
      await global.shown;
    });
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      true,
    );
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await desktop.evaluate(() => global.tray.isDestroyed()), false);
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false,
    );
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
      ...snapshot,
      running: 0,
    });
    assert.equal(await desktop.evaluate(() => global.tray.getTitle()), "—%  ! 1  ✓ 1  ?");
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
      ),
      false,
    );
    await desktop.evaluate(async () => {
      global.show();
      await global.shown;
    });
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );

    await desktop.evaluate(() => global.tray.emit("right-click"));
    const labels = await desktop.evaluate(() => {
      global.tray.closeContextMenu();
      return global.menu.items.map((item) => item.label);
    });
    assert.deepEqual(labels, [
      "1 waiting for approval · 1 finished, unread · 1 host(s) offline or syncing",
      "",
      "Approval: Review changes — Mac",
      "1 more — open Paseo",
      "",
      "Hosts",
      "Show Paseo",
      "",
      "Quit Paseo",
    ]);
    await desktop.evaluate(async () => {
      global.menu.items.find((item) => item.label.startsWith("Approval:")).click();
      await global.shown;
    });
    assert.deepEqual(await desktop.evaluate(() => global.opened), {
      serverId: "local",
      agentId: "approve-me",
    });
    await desktop.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].hide();
      global.menu.items.find((item) => item.label === "Show Paseo").click();
      await global.shown;
    });
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      true,
    );
    await page.reload();
    assert.equal(await desktop.evaluate(() => global.tray.getTitle()), "—%  ?");
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), snapshot);
    // Two windows report the same directory, not two copies of each task.
    await desktop.evaluate(async ({ BrowserWindow }) => {
      const second = new BrowserWindow({ show: false });
      global.menuBar.attach(second);
      second.close();
    });
    assert.equal(await desktop.evaluate(() => global.tray.getTitle()), "—%  ! 1  ▶ 2  ✓ 1  ?");
    await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
    assert.equal(await desktop.evaluate(() => global.tray.getTitle()), "—%  ?");
    const boardSnapshot = {
      ...snapshot,
      running: 1,
      waiting: 1,
      failed: 1,
      finished: 1,
      tasks: [
        {
          serverId: "local",
          agentId: "approve-me",
          title: "更新部署配置",
          summary: "codex · deployment · 等待审批后继续",
          status: "waiting",
          updatedAt: Date.now(),
        },
        {
          serverId: "local",
          agentId: "running",
          title: "优化推理服务性能",
          summary: "codex · inference-service",
          status: "running",
          updatedAt: Date.now() - 120000,
        },
        {
          serverId: "local",
          agentId: "finished",
          title: "完成菜单栏状态功能",
          summary: "codex · paseo",
          status: "finished",
          updatedAt: Date.now() - 300000,
        },
        {
          serverId: "local",
          agentId: "failed",
          title: "远程测试连接失败",
          summary: "SSH connection refused · 请检查远程主机连接",
          status: "failed",
          updatedAt: Date.now() - 600000,
        },
      ],
    };
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), boardSnapshot);
    await desktop.evaluate(() => global.tray.emit("click"));
    await expect.poll(() => desktop.windows().length).toBe(2);
    const board = desktop.windows().find((candidate) => candidate !== page);
    assert.ok(board);
    await expect(board.locator("h1")).toContainText("任务看板");
    await expect(board.locator("#count-running")).toHaveText("2");
    await expect(board.locator("#section-finished .task")).toHaveCount(1);
    await expect(board.locator("#section-failed .summary")).toContainText("SSH connection refused");
    await expect(board.locator(".badge")).toHaveText("待审批");
    await expect(board.locator(".notice")).toContainText("GPU");
    const quotaReport = {
      hostId: "local",
      hostLabel: "Mac",
      state: "ready",
      checkedAt: Date.now(),
      speedControlReady: true,
      groups: [
        {
          id: "gpt-6-astra",
          name: "GPT-6 Astra",
          source: "auto",
          controllable: true,
          ultraAvailable: true,
          ultraEnabled: false,
        },
        {
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          source: "auto",
          controllable: true,
          ultraAvailable: false,
          ultraEnabled: false,
        },
      ],
      accounts: [
        {
          provider: "codex",
          name: "ChatGPT",
          user: "person@example.com",
          plan: "Pro",
          balance: "",
          error: "",
          readAt: new Date().toISOString(),
          windows: [
            { name: "Weekly", remaining: 18, unlimited: false, resetsAt: "2026-10-30T00:00:00Z" },
          ],
        },
      ],
    };
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
      ...boardSnapshot,
      quotaReports: [quotaReport],
    });
    assert.equal(await desktop.evaluate(() => global.tray.getTitle()), "18%  ! 2  ▶ 1  ✓ 1  ?");
    for (const [display, expected] of [
      ["used", "82%  ! 2  ▶ 1  ✓ 1  ?"],
      ["hidden", "! 2  ▶ 1  ✓ 1  ?"],
      ["remaining", "18%  ! 2  ▶ 1  ✓ 1  ?"],
    ]) {
      await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
        ...boardSnapshot,
        quotaReports: [quotaReport],
        quotaPreference: { accountId: null, display },
      });
      assert.equal(await desktop.evaluate(() => global.tray.getTitle()), expected);
    }
    assert.deepEqual(
      await board
        .locator("main > section")
        .evaluateAll((sections) => sections.map((section) => section.id)),
      ["section-running", "section-finished", "section-failed", "section-quotas"],
    );
    await expect(board.locator("#section-quotas")).toContainText("剩余 18%");
    await expect(board.locator("#section-quotas")).not.toContainText("person@example.com");
    await expect(board.locator("#section-quotas progress")).toHaveAttribute("value", "18");
    await expect(board.locator("#section-quotas .quota.low")).toHaveCount(1);
    await page.evaluate(
      (input) => {
        globalThis.controlSnapshot = input;
        globalThis.controlActions = [];
        window.paseoDesktop.menuBar.onAction(async ({ requestId, action }) => {
          globalThis.controlActions.push(action);
          if (globalThis.rejectControls) {
            window.paseoDesktop.menuBar.actionResult({
              requestId,
              ok: false,
              error: "测试：无法保存设置",
            });
            return;
          }
          const report = globalThis.controlSnapshot.quotaReports[0];
          const group = report.groups.find((item) => item.id === action.groupId);
          if (action.kind === "source") group.source = action.source;
          if (action.kind === "ultra") group.ultraEnabled = action.enabled;
          await window.paseoDesktop.menuBar.update(globalThis.controlSnapshot);
          window.paseoDesktop.menuBar.actionResult({ requestId, ok: true });
        });
      },
      { ...boardSnapshot, quotaReports: [quotaReport] },
    );
    await expect(board.locator("#section-controls")).toHaveCount(0);
    await expect(board.getByRole("checkbox", { name: "个人 Ultra fast" })).toHaveCount(0);
    await expect(board.getByRole("button", { name: "切换来源 / Ultra fast" })).toHaveCount(0);
    await page.evaluate(() => {
      globalThis.rejectControls = true;
    });
    await board.getByRole("button", { name: "刷新额度", exact: true }).click();
    await expect(board.getByRole("alert")).toContainText("无法保存设置");
    await page.evaluate(() => {
      globalThis.rejectControls = false;
    });
    await board.getByRole("button", { name: "刷新额度", exact: true }).click();
    await expect(board.locator(".success")).toContainText("额度已刷新");
    assert.equal(await page.evaluate(() => globalThis.controlActions.at(-1).kind), "refresh");
    await board.locator("#section-quotas summary").click();
    await expect(board.locator("#section-quotas details")).toContainText("重置：2026-10-30");
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
      ...boardSnapshot,
      quotaReports: [{ ...quotaReport, checkedAt: Date.now() - 180000 }],
    });
    await expect(board.locator("#section-quotas")).toContainText("缓存");
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
      ...boardSnapshot,
      quotaReports: [{ ...quotaReport, state: "unavailable", accounts: [] }],
    });
    await expect(board.locator("#section-quotas")).toContainText("额度暂不可用");
    await expect(board.locator("#section-quotas progress")).toHaveCount(0);
    const livePath = process.env.PASEO_MENU_BAR_QUOTA_FIXTURE;
    const displayReport = livePath ? JSON.parse(await readFile(livePath, "utf8")) : quotaReport;
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
      ...boardSnapshot,
      quotaReports: [displayReport],
    });
    await expect(board.locator("#section-quotas .quota")).toHaveCount(
      displayReport.accounts.length,
    );
    await expect(board.locator(".board")).toHaveCSS("background-color", /rgba\(/);
    await board.getByRole("button", { name: "报错 1" }).click();
    await expect(board.locator("#section-failed .task")).toBeInViewport();
    await board.getByRole("button", { name: "运行中 2" }).click();
    const screenshotDir = process.env.PASEO_MENU_BAR_SCREENSHOT_DIR;
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await board.locator("main").evaluate((element) => {
        element.scrollTop = 0;
      });
      await board.emulateMedia({ colorScheme: "dark" });
      await board.screenshot({ path: path.join(screenshotDir, "dashboard-dark.png") });
      await board.emulateMedia({ colorScheme: "light" });
      await board.screenshot({ path: path.join(screenshotDir, "dashboard-light.png") });
    }
    await desktop.evaluate(() => {
      global.failOpen = true;
    });
    await board.getByRole("button", { name: "打开任务：更新部署配置" }).click();
    await expect(board.getByRole("alert")).toContainText("打开失败");
    await desktop.evaluate(() => {
      global.failOpen = false;
    });
    await board.getByRole("button", { name: "打开任务：更新部署配置" }).click();
    assert.deepEqual(await desktop.evaluate(() => global.opened), {
      serverId: "local",
      agentId: "approve-me",
    });
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => global.menuBar.isDashboard(win))
            .isVisible(),
        ),
      )
      .toBe(false);
    await desktop.evaluate(() => global.tray.emit("click"));
    await board.keyboard.press("Escape");
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => global.menuBar.isDashboard(win))
            .isVisible(),
        ),
      )
      .toBe(false);
    await desktop.evaluate(() => global.tray.emit("click"));
    await page.evaluate(() => window.paseoDesktop.menuBar.update(null));
    await expect(board.locator(".notice")).toContainText("状态暂不可用");
    await expect(board.locator(".task")).toHaveCount(0);
    await board.getByRole("button", { name: "关闭看板" }).click();
    await page.evaluate((value) => window.paseoDesktop.menuBar.update(value), {
      ...boardSnapshot,
      tasks: [
        {
          ...boardSnapshot.tasks[0],
          title: "<img src=x onerror=alert(1)>",
          summary: "<script>bad()</script>",
        },
      ],
    });
    await desktop.evaluate(() => global.tray.emit("click"));
    await expect(board.locator(".title")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(board.locator("img")).toHaveCount(0);
    await desktop.evaluate(() => global.tray.emit("click"));
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => global.menuBar.isDashboard(win))
            .isVisible(),
        ),
      )
      .toBe(false);
    await desktop.evaluate(() => global.tray.emit("click"));
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => global.menuBar.isDashboard(win))
        .emit("blur"),
    );
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => global.menuBar.isDashboard(win))
            .isVisible(),
        ),
      )
      .toBe(false);
    await desktop.evaluate(() =>
      global.menu.items.find((item) => item.label === "Quit Paseo").click(),
    );
    assert.equal(await desktop.evaluate(() => global.quitRequests), 1);
    assert.equal(await desktop.evaluate(() => global.tray.isDestroyed()), false);
    await desktop.evaluate(({ app }) => app.emit("will-quit", { preventDefault() {} }));
    assert.equal(await desktop.evaluate(() => global.tray.isDestroyed()), true);
    console.log("Menu bar: native icon, click, popup, restore, reopen, quit and cleanup passed");
  } finally {
    if (desktop && desktop.process().exitCode === null) {
      try {
        const exited = once(desktop.process(), "exit");
        // The fixture manually emits quit events while a native menu exists.
        // Tear down only this isolated process; do not re-enter Cocoa's quit loop.
        desktop.process().kill("SIGKILL");
        await exited;
      } catch (error) {
        console.error("Menu bar test cleanup failed:", error);
        desktop.process().kill();
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}
