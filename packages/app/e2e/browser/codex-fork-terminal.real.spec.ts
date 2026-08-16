import { expect, test } from "../support/fixtures";
import { expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";

async function getCodexConversationTerminal(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.find((terminal) => terminal.name === "Codex Conversation") ?? null;
}

test.describe("Codex conversation view switch", () => {
  test.setTimeout(300_000);

  test("keeps one Agent session and composer when flipping the TUI display", async ({ page }) => {
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
      await expect(page.getByText("AGENT_SIDE_SENTINEL", { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });

      const viewToggle = page.getByTestId("workspace-toggle-agent-conversation-view");
      await expect(viewToggle).toBeVisible({ timeout: 30_000 });
      await viewToggle.click();

      await expect(page.getByTestId("conversation-surface-tui")).toBeVisible({ timeout: 10_000 });
      await expectComposerVisible(page);
      await expect(page.getByTestId("terminal-surface")).toHaveCount(0);
      await expect.poll(async () => await getCodexConversationTerminal(workspace)).toBeNull();
      await expect(page.getByText("AGENT_SIDE_SENTINEL", { exact: true }).last()).toBeVisible();

      const returnStarted = workspace.client.waitForAgentUpsert(
        agent.id,
        (snapshot) => snapshot.status === "running",
        30_000,
      );
      await submitMessage(page, "Reply with exactly AGENT_RETURN_SENTINEL.");
      await returnStarted;
      const returned = await workspace.client.waitForFinish(agent.id, 90_000);
      expect(returned.status).toBe("idle");
      await expect(page.getByText("AGENT_RETURN_SENTINEL", { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });

      await viewToggle.click();
      await expect(page.getByTestId("conversation-surface-agent")).toBeVisible({ timeout: 10_000 });
      await expectComposerVisible(page);
      await expect(page.getByTestId("terminal-surface")).toHaveCount(0);
      await expect.poll(async () => await getCodexConversationTerminal(workspace)).toBeNull();
    } finally {
      await workspace.cleanup();
    }
  });
});
