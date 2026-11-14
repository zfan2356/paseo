import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { pluginRequirements } from "../support/helpers/plugin-fixture";

test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/catalog-codex.mjs")],
        },
      },
    },
  },
});

test("Magpie pills use plugin RPC and remain available after reload on compact layouts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), "magpie-composer-"));
  const source = path.resolve(__dirname, "../../../..", "plugins/magpie");
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const workspace = await seedWorkspace({ repoPrefix: "magpie-composer-" });
  const id = "magpie-composer-e2e";
  try {
    await cp(path.join(source, "client"), path.join(directory, "client"), { recursive: true });
    await cp(path.join(source, "shared"), path.join(directory, "shared"), { recursive: true });
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id, requirements: pluginRequirements }),
    );
    await writeFile(
      path.join(directory, "index.client.ts"),
      `
      import { registerComposerControls } from "./client/composer-extension";
      export default function contribute(client) { return registerComposerControls(client); }
    `,
    );
    await writeFile(
      path.join(directory, "index.server.ts"),
      `
      import { snapshotRpc, sourceRpc, ultraRpc } from "./shared/magpie";
      const snapshot = { available: true, checkedAt: "2026-10-29", speedControlReady: true,
        providers: [], quotas: [], signIn: null, groups: [{
          id: "gpt-6.1-sol", name: "GPT-6.1 Sol", routing: "order", affinity: "session",
          ready: true, members: [], source: "auto", controllable: true,
          ultraAvailable: true, ultraEnabled: false,
        }] };
      export default function(server) {
        server.handle(snapshotRpc, () => snapshot);
        server.handle(sourceRpc, ({source}) => { snapshot.groups[0].source=source; return snapshot; });
        server.handle(ultraRpc, ({enabled}) => { snapshot.groups[0].ultraEnabled=enabled; return snapshot; });
        return () => {};
      }
    `,
    );
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await workspace.client.createAgent({
      provider: "codex",
      model: "gpt-6.1-sol",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      initialPrompt: "Ready",
    });
    await workspace.client.waitForFinish(agent.id, 30_000);
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    const sourcePill = page.getByRole("button", { name: "Magpie 账号来源", exact: true });
    await expect(sourcePill).toBeVisible();
    await sourcePill.click();
    await page.getByText("个人账号", { exact: true }).click();
    await expect(sourcePill).toContainText("个人账号");
    const speedPill = page.getByRole("button", { name: "Magpie 推理速度", exact: true });
    await speedPill.click();
    await page.getByText("开启 Ultra fast", { exact: true }).click();
    await expect(speedPill).toContainText("Ultra fast");
    await page.getByTestId("workspace-toggle-side-chat").click();
    await page.getByTestId("side-chat-new").click();
    await expect(
      page.getByTestId("side-chat-panel").getByRole("button", {
        name: "Magpie 账号来源",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByTestId(`workspace-tab-side_chat_${agent.id}`).hover();
    await page.getByTestId(`workspace-side-chat-close-${agent.id}`).click();
    await page.reload();
    await expect(speedPill).toContainText("Ultra fast");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(sourcePill).toBeVisible();
    await sourcePill.click();
    await expect(page.getByText("iChat", { exact: true })).toBeVisible();
  } finally {
    await client.removePlugin(id).catch(() => {});
    await workspace.cleanup();
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
