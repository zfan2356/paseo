import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { pluginRequirements } from "../support/helpers/plugin-fixture";

test("Magpie shows subscriptions and API sources without inventing fallback routes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-magpie-sources-"));
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
    await writeFile(
      path.join(directory, "index.server.ts"),
      `
      import { snapshotRpc } from "./shared/magpie.js";
      export default function(server) {
        server.handle(snapshotRpc, () => ({
          available: true, checkedAt: "2026-10-24T00:00:00Z", signIn: null,
          providers: [
            { id: "codex", name: "ChatGPT", ready: true, modelCount: 3, accounts: [{ user: "owner@example.com", plan: "Pro", enabled: true, needsLogin: false }] },
            { id: "cursor", name: "Cursor", ready: true, modelCount: 24, accounts: [] },
            { id: "ichat", name: "iChat", ready: true, modelCount: 116, accounts: [] },
            { id: "deepseek", name: "DeepSeek", ready: true, modelCount: 2, accounts: [] }
          ], groups: [], quotas: []
        }));
        return () => {};
      }
    `,
    );
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Magpie", exact: true }).click();
    await expect(page.getByText("4 个来源可用 · 0 条个人优先路由", { exact: true })).toBeVisible();
    for (const name of ["ChatGPT / Codex", "Cursor", "iChat", "DeepSeek"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("24 个模型可用", { exact: true })).toBeVisible();
    await expect(page.getByText("116 个模型可用", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录 Claude", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /登录.*(Cursor|DeepSeek|iChat)/ })).toHaveCount(
      0,
    );
    await expect(page.getByText("目前由 ichat 回答", { exact: false })).toHaveCount(0);
  } finally {
    await client.removePlugin("magpie").catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
