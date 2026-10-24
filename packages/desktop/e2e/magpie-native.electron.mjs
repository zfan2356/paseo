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

function connectClient(endpoint) {
  return new DaemonClient({
    url: `ws://${endpoint}/ws`,
    clientId: "magpie-native-desktop",
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
  });
}

async function verifyNativePage(page, expectedOrigin, artifactName) {
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
    element.executeJavaScript(
      "({ node: typeof require, title: document.title, origin: location.origin })",
    ),
  );
  expect(frame).toEqual({ node: "undefined", title: "magpie", origin: expectedOrigin });
  const bounds = await view.boundingBox();
  expect(bounds.width).toBeGreaterThan(400);
  expect(bounds.height).toBeGreaterThan(250);
  const artifacts = process.env.PASEO_DESKTOP_SMOKE_ARTIFACT_DIR;
  if (artifacts) {
    await page.screenshot({ path: path.join(artifacts, artifactName) });
  }
}

async function verifyRemotePage(page, endpoint, localUrl) {
  const remote = connectClient(endpoint);
  try {
    await remote.connect();
    const serverId = remote.getLastServerInfoMessage().serverId;
    const link = await remote.invokePluginRpc("magpie", "magpie.web.open", {});
    const remoteOrigin = new URL(link.url).origin;
    expect(remoteOrigin).not.toBe("http://127.0.0.1:3430");
    await page.evaluate(
      ({ address, id }) => {
        const key = "@paseo:daemon-registry";
        const registry = JSON.parse(localStorage.getItem(key));
        const connection = { id: `direct:${address}`, type: "directTcp", endpoint: address };
        const now = new Date().toISOString();
        registry.push({
          serverId: id,
          label: "CVM Magpie",
          connections: [connection],
          preferredConnectionId: connection.id,
          createdAt: now,
          updatedAt: now,
        });
        localStorage.setItem(key, JSON.stringify(registry));
      },
      { address: endpoint, id: serverId },
    );
    const url = new URL(localUrl);
    url.pathname = `/h/${encodeURIComponent(serverId)}/plugin/magpie/surface/main`;
    await page.goto(url.href);
    await verifyNativePage(page, remoteOrigin, "magpie-cvm.png");
    // Returning to local Magpie must keep its independent cookie valid.
    await page.goto(localUrl);
    await verifyNativePage(page, "http://127.0.0.1:3430", "magpie-local-return.png");
    console.log("CVM native page and local/remote cookie isolation passed.");
  } finally {
    await remote.close();
  }
}

// Uses isolated local state; optional remote checks only read the deployed plugin.
await smokePackagedDesktopApp({
  appPath: process.argv[2] || "/Applications/Paseo.app",
  async verifyRenderer(page) {
    const status = await page.evaluate(() => window.paseoDesktop.invoke("desktop_daemon_status"));
    const state = path.join(status.home, ".local/state/magpie");
    await mkdir(state, { recursive: true });
    await symlink(path.join(homedir(), ".local/state/magpie/web-key"), path.join(state, "web-key"));
    const client = connectClient(status.listen);
    try {
      await client.connect();
      await client.patchDaemonConfig({ pluginsEnabled: true });
      await client.installDirectoryPlugin(path.join(root, "plugins/magpie"));
      await page.getByRole("button", { name: "Magpie", exact: true }).click();
      await verifyNativePage(page, "http://127.0.0.1:3430", "magpie-native.png");
      console.log("Magpie native desktop page, sign-in, navigation and sandbox passed.");
      const remoteEndpoint = process.env.PASEO_MAGPIE_REMOTE_ENDPOINT;
      if (remoteEndpoint) {
        await verifyRemotePage(page, remoteEndpoint, page.url());
      }
    } finally {
      await client.removePlugin("magpie");
      await client.close();
    }
  },
});
