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
        autoExpandReasoning: true,
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
    const processToggle = process.getByRole("button").first();
    await expect(process).toBeVisible({ timeout: 30_000 });
    await expect(process.getByTestId("assistant-message").first()).toBeVisible();
    await expect(process.getByTestId("tool-call-badge").first()).toBeVisible();

    await processToggle.click();
    await expect(process.getByTestId("assistant-message")).toHaveCount(0);
    await processToggle.click();
    await expect(process.getByTestId("assistant-message").first()).toBeVisible();

    await expectAgentIdle(page, 30_000);
    await expect(process.getByTestId("assistant-message")).toHaveCount(0);
    await expect(process.getByTestId("tool-call-badge")).toHaveCount(0);
    await expect(
      page
        .getByTestId("assistant-message")
        .filter({ hasText: "The change should keep scroll-to-bottom working" }),
    ).toBeVisible();

    await processToggle.click();
    await expect(process.getByTestId("assistant-message").first()).toBeVisible();
    await expect(process.getByTestId("tool-call-badge").first()).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test("renders the assistant boundary as one compact Markdown block", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "pureBlack" }));
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "compact-assistant-boundary-",
    title: "Compact assistant boundary",
    featureValues: {
      mockStreamingAssistantResponse: "---\nFinal answer",
      mockStreamingAssistantIntervalMs: 1,
    },
  });

  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Render the compact boundary.");
    await expectAgentIdle(page, 30_000);

    const assistantMessage = page.getByTestId("assistant-message").last();
    const boundary = assistantMessage.locator('[data-paseo-markdown-tag="hr"]');
    await expect(assistantMessage.locator(":scope > *")).toHaveCount(1);
    await expect(boundary).toBeVisible();
    await expect(boundary).toHaveCSS("background-color", "rgb(113, 113, 122)");
    await expect(boundary).toHaveCSS("height", "1px");
    await expect(boundary).toHaveCSS("margin-top", "8px");
    await expect(boundary).toHaveCSS("margin-bottom", "8px");
    await expect(assistantMessage).toContainText("Final answer");
  } finally {
    await agent.cleanup();
  }
});
