import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, test as base } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { pluginRequirements } from "../support/helpers/plugin-fixture";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import {
  mobileMessage,
  mobilePageRpc,
  mobileRequestRpc,
} from "../../../../plugins/magpie/shared/mobile";

const test = base.extend<{}, { magpieHome: string }>({
  magpieHome: [
    async ({ browserName }, provide) => {
      const home = await mkdtemp(path.join(tmpdir(), `paseo-magpie-${browserName}-`));
      try {
        const state = path.join(home, ".local/state/magpie");
        await mkdir(state, { recursive: true });
        await symlink(
          path.join(homedir(), ".local/state/magpie/web-key"),
          path.join(state, "web-key"),
        );
        await provide(home);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  e2eDaemonEnvironment: [
    async ({ magpieHome }, provide) => {
      // Keep the real service key, without adopting a desktop-only forwarded origin.
      await provide({ HOME: magpieHome });
    },
    { scope: "worker" },
  ],
});

// Requires the user's running Magpie management server, like other real-provider tests.
test("Magpie opens its upstream page and navigates the native management views", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-magpie-native-"));
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = await client.getDaemonConfig();
  try {
    await cp(path.resolve(__dirname, "../../../../plugins/magpie"), directory, {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id: "magpie", requirements: pluginRequirements }),
    );
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Magpie", exact: true }).click();
    const frame = page.frameLocator('iframe[title="Magpie"]');
    await expect(frame.locator("#nav")).toBeVisible();
    await frame.locator('#nav [data-view="providers"]').click();
    await expect(frame.locator('#nav [data-view="providers"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await frame.locator('#nav [data-view="routing"]').click();
    await expect(frame.locator('#nav [data-view="routing"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    const embedded = page.frames().find((entry) => entry.url().includes(":3430/"));
    expect(embedded).toBeDefined();
    expect(new URL(embedded!.url()).searchParams.has("k")).toBe(false);
    await expect(page.getByText("个人优先路由", { exact: true })).toHaveCount(0);
    const origin = await embedded!.evaluate(() => performance.timeOrigin);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.getByTestId("plugin-surface-close").click();
      await expect(page.locator('iframe[title="Magpie"]')).toHaveCount(1);
      await page.getByRole("button", { name: "Magpie", exact: true }).click();
      await expect(page.getByText("正在打开 Magpie 原生管理页面…", { exact: true })).toHaveCount(0);
      await expect(frame.locator("#nav")).toBeVisible();
      expect(await embedded!.evaluate(() => performance.timeOrigin)).toBe(origin);
      await expect(frame.locator('#nav [data-view="routing"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  } finally {
    await client.removePlugin("magpie").catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("mobile Magpie uses the real page and management API over plugin RPC", async ({ page }) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-magpie-mobile-"));
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "magpie-mobile" });
  const previous = await client.getDaemonConfig();
  const server = createServer();
  const calls: string[] = [];
  const errors: string[] = [];
  try {
    await cp(path.resolve(__dirname, "../../../../plugins/magpie"), directory, { recursive: true });
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id: "magpie", requirements: pluginRequirements }),
    );
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const document = mobilePageRpc.output.parse(
      await client.invokePluginRpc("magpie", mobilePageRpc.name, {}),
    );
    server.on("request", (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(document.html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing mobile page listener");
    await page.setViewportSize({ width: 390, height: 844 });
    page.on("pageerror", (error) => errors.push(error.message));
    // The browser port replaces WKWebView's JS boundary; RPC and Magpie remain real.
    await page.exposeBinding("__paseoMobileSend", async ({ page: target }, data: string) => {
      const message = mobileMessage.parse(JSON.parse(data));
      if (message.type === "error") errors.push(message.message);
      if (message.type !== "request") return;
      calls.push(message.request.path);
      const response = await client.invokePluginRpc(
        "magpie",
        mobileRequestRpc.name,
        message.request,
      );
      await target.evaluate(
        `window.__paseoMagpieReceive(${JSON.stringify({ id: message.id, response })});`,
      );
    });
    await page.addInitScript(`window.ReactNativeWebView = {
      postMessage: (data) => { void window.__paseoMobileSend(data); }
    };`);
    await page.goto(`http://127.0.0.1:${address.port}/?view=providers`);
    await expect(page.locator("#view-providers .row").first()).toBeVisible();
    expect(calls).toContain("/api/providers");
    for (const view of ["routing", "usage"]) {
      await page.locator(`#nav [data-view="${view}"]`).click();
      await expect(page.locator(`#nav [data-view="${view}"]`)).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page.locator("#prefs").click();
    await expect(page.locator("#view-settings")).toBeVisible();
    await expect.poll(() => calls.includes("/api/settings")).toBe(true);
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/paseo-mobile-not-found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probe: true }),
      });
      return response.status;
    });
    expect(status).toBe(404);
    const blocked = await page.evaluate(async () => {
      try {
        await fetch("https://example.com/api/state");
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await client.removePlugin("magpie").catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
