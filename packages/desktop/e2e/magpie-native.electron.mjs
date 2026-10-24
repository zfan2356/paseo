import { mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { WebSocket } from "ws";

const require = createRequire(import.meta.url);
const { smokePackagedDesktopApp } = require("./packaged-app-smoke.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Exercises a running local Magpie inside an isolated copy of the desktop profile.
await smokePackagedDesktopApp({
  appPath: process.argv[2] || "/Applications/Paseo.app",
  async verifyRenderer(page) {
    const status = await page.evaluate(() => window.paseoDesktop.invoke("desktop_daemon_status"));
    const state = path.join(status.home, ".local/state/magpie");
    await mkdir(state, { recursive: true });
    await symlink(path.join(homedir(), ".local/state/magpie/web-key"), path.join(state, "web-key"));
    const client = new DaemonClient({
      url: `ws://${status.listen}/ws`,
      clientId: "magpie-native-desktop",
      webSocketFactory: (url, options) =>
        new WebSocket(url, options?.protocols, { headers: options?.headers }),
    });
    try {
      await client.connect();
      await client.patchDaemonConfig({ pluginsEnabled: true });
      await client.installDirectoryPlugin(path.join(root, "plugins/magpie"));
      await page.getByRole("button", { name: "Magpie", exact: true }).click();
      const view = page.locator('webview[title="Magpie"]');
      await expect(view).toBeVisible();
      await expect
        .poll(() =>
          view.evaluate((element) =>
            element
              .executeJavaScript(
                'document.title === "magpie" && !!document.querySelector("#nav") && !new URL(location.href).searchParams.has("k")',
              )
              .catch(() => false),
          ),
        )
        .toBe(true);
      for (const viewName of ["providers", "routing"]) {
        await view.evaluate(
          (element, name) =>
            element.executeJavaScript(`document.querySelector('[data-view="${name}"]').click()`),
          viewName,
        );
        await expect
          .poll(() =>
            view.evaluate(
              (element, name) =>
                element.executeJavaScript(
                  `document.querySelector('[data-view="${name}"]').getAttribute("aria-current")`,
                ),
              viewName,
            ),
          )
          .toBe("page");
      }
      const frame = await view.evaluate((element) =>
        element.executeJavaScript("({ node: typeof require, title: document.title })"),
      );
      expect(frame).toEqual({ node: "undefined", title: "magpie" });
      const bounds = await view.boundingBox();
      expect(bounds.width).toBeGreaterThan(400);
      expect(bounds.height).toBeGreaterThan(250);
      const artifacts = process.env.PASEO_DESKTOP_SMOKE_ARTIFACT_DIR;
      if (artifacts) {
        await page.screenshot({ path: path.join(artifacts, "magpie-native.png") });
      }
      console.log("Magpie native desktop page, sign-in, navigation and sandbox passed.");
    } finally {
      await client.removePlugin("magpie");
      await client.close();
    }
  },
});
