import { expect, test } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("expands the live intermediate process and folds it after the final answer", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({
        autoExpandReasoning: false,
        toolCallDetailLevel: "detailed",
      }),
    );
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "intermediate-process-collapse-",
    title: "Intermediate process collapse",
    model: "ten-second-stream",
  });

  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Show the intermediate process lifecycle.");

    const process = page.getByTestId("intermediate-process-group");
    await expect(process).toBeVisible({ timeout: 30_000 });
    await expect(process.getByTestId("assistant-message").first()).toBeVisible();
    await expect(process.getByTestId("tool-call-badge").first()).toBeVisible();

    await expectAgentIdle(page, 30_000);
    await expect(process.getByTestId("assistant-message")).toHaveCount(0);
    await expect(process.getByTestId("tool-call-badge")).toHaveCount(0);
    await expect(
      page
        .getByTestId("assistant-message")
        .filter({ hasText: "The change should keep scroll-to-bottom working" }),
    ).toBeVisible();

    await process.click();
    await expect(process.getByTestId("assistant-message").first()).toBeVisible();
    await expect(process.getByTestId("tool-call-badge").first()).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});
