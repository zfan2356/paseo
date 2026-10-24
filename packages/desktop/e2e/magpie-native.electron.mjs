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
  const view = page.locator('[data-magpie-host][aria-hidden="false"] webview[title="Magpie"]');
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
  const providers = await view.evaluate((element) =>
    element.executeJavaScript(
      'fetch("/api/providers").then(async response => ({ status: response.status, count: (await response.json()).providers.length }))',
    ),
  );
  expect(providers.status).toBe(200);
  expect(providers.count).toBeGreaterThan(0);
  await view.evaluate((element) =>
    element.executeJavaScript("document.querySelector('[data-view=\"providers\"]').click()"),
  );
  await expect
    .poll(() =>
      view.evaluate((element) =>
        element.executeJavaScript('document.getElementById("providers").children.length'),
      ),
    )
    .toBeGreaterThan(0);
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

async function pageIdentity(page) {
  return page
    .locator('[data-magpie-host][aria-hidden="false"] webview[title="Magpie"]')
    .evaluate(async (element) => ({
      guestId: element.getWebContentsId(),
      birth: await element.executeJavaScript("performance.timeOrigin"),
      current: await element.executeJavaScript(
        'document.querySelector("#nav [aria-current=page]").getAttribute("data-view")',
      ),
      viewport: await element.executeJavaScript("({ width: innerWidth, height: innerHeight })"),
    }));
}

async function verifyRouteResidency(page) {
  const identity = await pageIdentity(page);
  const count = await page.locator('webview[title="Magpie"]').count();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.getByTestId("plugin-surface-close").click();
    await expect(page.locator('webview[title="Magpie"]')).toHaveCount(count);
    await expect(page.locator('[data-magpie-host][aria-hidden="false"]')).toHaveCount(0);
    expect(
      await page
        .locator("[data-magpie-host]")
        .evaluateAll((elements) =>
          elements.every((element) => element.inert && element.style.pointerEvents === "none"),
        ),
    ).toBe(true);
    await page.getByRole("button", { name: "Magpie", exact: true }).click();
    await expect(page.getByText("正在打开 Magpie 原生管理页面…", { exact: true })).toHaveCount(0);
    await expect.poll(() => pageIdentity(page)).toEqual(identity);
  }
  return identity;
}

async function selectHost(page, label) {
  await page.getByTestId("plugin-host-filter-trigger").click();
  await page.getByRole("button", { name: label, exact: true }).click();
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
    const remoteIdentity = await verifyRouteResidency(page);
    const localId = decodeURIComponent(new URL(localUrl).pathname.split("/")[2]);
    const localLabel = await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("@paseo:daemon-registry")).find(
          (host) => host.serverId === id,
        ).label,
      localId,
    );
    // These are SPA host switches, not full renderer reloads.
    await selectHost(page, localLabel);
    await verifyNativePage(page, "http://127.0.0.1:3430", "magpie-local-return.png");
    const localIdentity = await verifyRouteResidency(page);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await selectHost(page, "CVM Magpie");
      await expect.poll(() => pageIdentity(page)).toEqual(remoteIdentity);
      await selectHost(page, localLabel);
      await expect.poll(() => pageIdentity(page)).toEqual(localIdentity);
      await expect(page.locator('webview[title="Magpie"]')).toHaveCount(2);
    }
    console.log("CVM/local page residency, SPA switching and cookie isolation passed.");
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
      await verifyRouteResidency(page);
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
