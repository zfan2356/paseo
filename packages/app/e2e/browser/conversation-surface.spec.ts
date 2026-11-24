import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.describe("Conversation display surface", () => {
  test("does not fake a TUI overlay on a mock Agent conversation", async ({ page }) => {
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
      await expect(page.getByTestId("workspace-toggle-agent-conversation-view")).toHaveCount(0);
      await expect(page.getByTestId("terminal-surface")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
