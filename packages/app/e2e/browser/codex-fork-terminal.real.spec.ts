import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

async function getCodexConversationTerminal(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.find((terminal) => terminal.name === "Codex Conversation") ?? null;
}

test.describe("Codex conversation view switch", () => {
  test.setTimeout(300_000);

  test("round-trips one Codex thread between Agent and terminal views", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "codex-fork-terminal-" });

    try {
      const agent = await workspace.client.createAgent({
        provider: "codex",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Codex conversation switch",
        modeId: "full-access",
        initialPrompt: "Reply with exactly AGENT_SIDE_SENTINEL.",
      });
      const finished = await workspace.client.waitForFinish(agent.id, 90_000);
      expect(finished.status).toBe("idle");
      expect(finished.final?.lastError).toBeFalsy();
      await openAgentRoute(page, {
        workspaceId: workspace.workspaceId,
        agentId: agent.id,
      });

      await expectComposerVisible(page, { timeout: 30_000 });
      await expect(page.getByTestId("conversation-surface-agent")).toBeVisible();

      const viewToggle = page.getByTestId("workspace-toggle-agent-conversation-view");
      await expect(viewToggle).toBeVisible({ timeout: 30_000 });
      await viewToggle.click();

      await expectTerminalSurfaceVisible(page);
      await expect
        .poll(async () => await getCodexConversationTerminal(workspace), {
          timeout: 30_000,
        })
        .not.toBeNull();
      const terminal = await getCodexConversationTerminal(workspace);
      if (!terminal) {
        throw new Error("Codex conversation terminal disappeared after the view switch");
      }
      expect(terminal.linkedAgentId).toBe(agent.id);
      await expect(page.getByTestId("conversation-surface-agent")).toHaveCount(0);

      await viewToggle.click();
      await expectComposerVisible(page, { timeout: 30_000 });
      await expect(page.getByTestId("conversation-surface-agent")).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => await getCodexConversationTerminal(workspace)).toBeNull();
    } finally {
      await workspace.cleanup();
    }
  });
});
