import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

async function hasCodexForkTerminal(
  workspace: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<boolean> {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.some((terminal) => terminal.name === "Codex Fork");
}

test.describe("Codex conversation terminal fork", () => {
  test.setTimeout(180_000);

  test("keeps new terminal intact and opens a dedicated Codex fork terminal", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "codex-fork-terminal-" });

    try {
      const agent = await workspace.client.createAgent({
        provider: "codex",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Codex terminal fork",
        modeId: "full-access",
      });
      await openAgentRoute(page, {
        workspaceId: workspace.workspaceId,
        agentId: agent.id,
      });

      await page.getByTestId("workspace-header-menu-trigger").click();
      await expect(page.getByTestId("workspace-header-new-terminal")).toBeVisible();
      await page.keyboard.press("Escape");

      const forkButton = page.getByTestId("workspace-fork-codex-terminal");
      await expect(forkButton).toBeVisible({ timeout: 30_000 });
      await forkButton.click();

      await expectTerminalSurfaceVisible(page);
      await expect.poll(() => hasCodexForkTerminal(workspace), { timeout: 30_000 }).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });
});
