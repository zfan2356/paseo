import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.describe("Conversation display surface", () => {
  test("shows the TUI switch for a mock agent and keeps one composer", async ({ page }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "conversation-surface-",
      title: "Conversation surface",
      initialPrompt: "Reply with exactly SURFACE_SENTINEL.",
    });

    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page, { timeout: 30_000 });
      await expect(page.getByTestId("conversation-surface-agent")).toBeVisible({
        timeout: 30_000,
      });

      const viewToggle = page.getByTestId("workspace-toggle-agent-conversation-view");
      await expect(viewToggle).toBeVisible({ timeout: 30_000 });
      await viewToggle.click();

      await expect(page.getByTestId("conversation-surface-tui")).toBeVisible({ timeout: 10_000 });
      await expectComposerVisible(page);
      await expect(page.getByTestId("terminal-surface")).toHaveCount(0);

      await viewToggle.click();
      await expect(page.getByTestId("conversation-surface-agent")).toBeVisible({ timeout: 10_000 });
      await expectComposerVisible(page);
      await expect(page.getByTestId("terminal-surface")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
