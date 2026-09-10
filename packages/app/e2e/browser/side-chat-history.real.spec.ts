import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";

test.use({ e2eForkProviders: ["codex"] });

test("side chat history survives close, refresh and continuation without implicit forks", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const workspace = await seedWorkspace({ repoPrefix: "side-chat-history-" });
  try {
    const agent = await workspace.client.createAgent({
      provider: "codex",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Side chat history parent",
      modeId: "full-access",
      initialPrompt: "Reply with exactly MAIN_HISTORY_READY.",
    });
    expect((await workspace.client.waitForFinish(agent.id, 90_000)).status).toBe("idle");
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    const toggle = page.getByTestId("workspace-toggle-side-chat");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await toggle.click();
    const history = page.getByTestId("side-chat-history");
    const rows = history.locator('[data-testid^="side-chat-history-"]');
    await expect(history).toContainText("No side conversations yet");
    await expect(rows).toHaveCount(0);
    await page.getByTestId("side-chat-new").click();
    const panel = page.getByTestId("side-chat-panel");
    const composer = panel.getByRole("textbox", { name: "Message agent..." });
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await composer.fill("Reply with exactly SIDE_HISTORY_ONE.");
    await composer.press("Enter");
    await expect(panel.getByText("SIDE_HISTORY_ONE", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(panel.getByText("MAIN_HISTORY_READY", { exact: true })).toHaveCount(0);
    await page.getByTestId("side-chat-back").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Reply with exactly SIDE_HISTORY_ONE.");
    const originalRowId = await rows.first().getAttribute("data-testid");
    expect(originalRowId).toBeTruthy();
    await rows.first().click();
    await expect(panel.getByText("SIDE_HISTORY_ONE", { exact: true })).toBeVisible();
    const sideAgentId = originalRowId!.slice("side-chat-history-".length);
    await expect(page.getByTestId(`workspace-tab-agent_${sideAgentId}`)).toHaveCount(0);
    await page.getByTestId(`workspace-tab-side_chat_${agent.id}`).hover();
    await page.getByTestId(`workspace-side-chat-close-${agent.id}`).click({ timeout: 10_000 });
    await expect(panel).toHaveCount(0);
    await toggle.click();
    await expect(rows).toHaveCount(1);
    await page.getByTestId(originalRowId!).click();
    await expect(panel.getByText("SIDE_HISTORY_ONE", { exact: true })).toBeVisible();
    await page.reload();
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(rows).toHaveCount(1);
    await page.getByTestId(originalRowId!).click();
    await expect(panel.getByText("SIDE_HISTORY_ONE", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(composer).toBeEditable();
    await composer.fill(
      "Repeat the exact reply you gave in this side conversation, with no other text.",
    );
    await composer.press("Enter");
    await expect(panel.getByText("SIDE_HISTORY_ONE", { exact: true })).toHaveCount(2, {
      timeout: 90_000,
    });
    await page.getByTestId("side-chat-back").click();
    await expect(rows).toHaveCount(1);
    await page.getByTestId("side-chat-new").click();
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await expect(panel.getByText("SIDE_HISTORY_ONE", { exact: true })).toHaveCount(0);
    await page.getByTestId("side-chat-back").click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId(originalRowId!)).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});
