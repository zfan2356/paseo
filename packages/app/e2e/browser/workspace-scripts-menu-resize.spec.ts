import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { seedWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { ensureExplorerSidebar } from "../support/helpers/workspace-tabs";
import { test, expect } from "../support/fixtures";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  connectWorkspaceSetupClient,
  setupCommandOutput,
  createWorkspaceThroughDaemon,
  openWorkspaceScriptsMenu,
  seedProjectForWorkspaceSetup,
  startWorkspaceScriptFromMenu,
  waitForWorkspaceSetupProgress,
} from "../support/helpers/workspace-setup";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { getServerId } from "../support/helpers/server-id";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";

test("scripts menu resizes when a service row grows after launch", async ({ page }) => {
  const client = await connectWorkspaceSetupClient();
  const repo = await createTempGitRepo("script-menu-resize-", {
    paseoConfig: {
      worktree: {
        setup: ["sh -c 'echo setup complete'"],
      },
      scripts: {
        web: {
          type: "service",
          command:
            "node -e \"const http = require('http'); const s = http.createServer((q,r) => r.end('ok')); s.listen(process.env.PORT || 3000, () => console.log('listening on ' + s.address().port))\"",
        },
      },
    },
  });

  try {
    await seedProjectForWorkspaceSetup(client, repo.path);
    const completed = waitForWorkspaceSetupProgress(
      client,
      (payload) =>
        payload.status === "completed" &&
        setupCommandOutput(payload.detail).includes("setup complete"),
    );
    const workspace = await createWorkspaceThroughDaemon(client, {
      cwd: repo.path,
      worktreeSlug: `script-menu-resize-${Date.now()}`,
    });
    await completed;

    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
    await expect(page.getByTestId("workspace-resources-sheet")).not.toBeVisible();
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);

    const menu = page.getByTestId("workspace-scripts-menu");
    const before = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });

    await startWorkspaceScriptFromMenu(page, "web");
    await expect(menu).toContainText("localhost:", { timeout: 15_000 });

    const after = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const firstChild = element.firstElementChild;
      const childRect = firstChild?.getBoundingClientRect();
      return {
        height: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        childHeight: childRect?.height ?? 0,
      };
    });

    expect(after.height).toBeGreaterThan(before.height);
    expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight + 1);
    expect(after.childHeight).toBeGreaterThan(before.height);
  } finally {
    await client.close();
    await repo.cleanup();
  }
});

test("workspace resources reopen the existing service and terminal without creating a session", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const chat = await seedMockAgentWorkspace({
    repoPrefix: "resource-chat-",
    title: "Keep this conversation",
  });
  const resource = await seedWorkspace({
    repoPrefix: "resource-service-",
    title: "Independent service",
    repo: {
      paseoConfig: {
        scripts: {
          web: {
            type: "service",
            command:
              "node -e \"const http = require('http'); const s = http.createServer((q,r) => r.end('ok')); s.listen(process.env.PORT || 3000, () => console.log('listening on ' + s.address().port))\"",
          },
        },
      },
    },
  });
  try {
    await page.goto("/open-project");
    await page.getByTestId("open-project-workspace-resources").click();
    await page
      .getByTestId("workspace-resource-list")
      .getByTestId(`sidebar-workspace-title-${getServerId()}:${resource.workspaceId}`)
      .click();
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);
    await startWorkspaceScriptFromMenu(page, "web");
    const menu = page.getByTestId("workspace-scripts-menu");
    await expect(menu).toContainText("localhost:", { timeout: 15_000 });
    const before = (
      await resource.client.listTerminals(undefined, undefined, {
        workspaceId: resource.workspaceId,
      })
    ).terminals.map(({ id }) => id);
    expect(before.length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await openAgentRoute(page, chat);
    const explorer = await ensureExplorerSidebar(page);
    await explorer.getByTestId("workspace-resources-open").click();
    await selectSidebarStatusGrouping(page);
    await page
      .getByTestId("workspace-resource-list")
      .getByTestId(`sidebar-workspace-title-${getServerId()}:${resource.workspaceId}`)
      .click();
    await expect(page.getByTestId("workspace-resources-sheet")).not.toBeVisible();
    await openWorkspaceScriptsMenu(page);
    await expect(menu).toContainText("localhost:");
    expect(
      (
        await resource.client.listTerminals(undefined, undefined, {
          workspaceId: resource.workspaceId,
        })
      ).terminals.map(({ id }) => id),
    ).toEqual(before);
    expect(
      (await resource.client.fetchAgents({ scope: "active" })).entries.some(
        ({ agent }) => agent.workspaceId === resource.workspaceId,
      ),
    ).toBe(false);
    expect(
      (await chat.client.fetchAgents({ scope: "active" })).entries.find(
        ({ agent }) => agent.id === chat.agentId,
      )?.agent.cwd,
    ).toBe(chat.cwd);
    await page.screenshot({
      path: info.outputPath("workspace-resource-service-1200.png"),
      fullPage: true,
    });
    await page.getByTestId("workspace-scripts-stop-web").click();
    await expect(page.getByTestId("workspace-scripts-start-web")).toBeVisible();
    await page.keyboard.press("Escape");
    const currentExplorer = await ensureExplorerSidebar(page);
    await currentExplorer.getByTestId("workspace-resources-open").click();
    await page
      .getByTestId("workspace-resource-list")
      .getByTestId(`sidebar-workspace-title-${getServerId()}:${resource.workspaceId}`)
      .click();
    await expect(page.getByTestId("workspace-resources-sheet")).not.toBeVisible();
  } catch (error) {
    await page.screenshot({ path: info.outputPath("failure-before-cleanup.png"), fullPage: true });
    throw error;
  } finally {
    await resource.cleanup();
    await chat.cleanup();
  }
});
