import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

test.use({ e2eForkProviders: ["antigravity"] });

test("Antigravity preserves side history and the same conversation across its real TUI", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const workspace = await seedWorkspace({ repoPrefix: "antigravity-conversation-" });
  try {
    const agent = await workspace.client.createAgent({
      provider: "antigravity",
      model: "gemini-3.8-flash",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Antigravity conversation switch",
      initialPrompt:
        "Remember AGY_MAIN_CONTEXT. Reply with exactly AGY_MAIN_CONTEXT. Do not use tools.",
    });
    expect((await workspace.client.waitForFinish(agent.id, 90_000)).status).toBe("idle");
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    await expectComposerVisible(page, { timeout: 30_000 });

    const sideToggle = page.getByTestId("workspace-toggle-side-chat");
    await expect(sideToggle).toBeVisible({ timeout: 30_000 });
    await sideToggle.click();
    await page.getByTestId("side-chat-new").click();
    const panel = page.getByTestId("side-chat-panel");
    const composer = panel.getByRole("textbox", { name: "Message agent..." });
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await expect(panel.getByText("AGY_MAIN_CONTEXT", { exact: true })).toHaveCount(0);
    await composer.fill(
      "What exact code did I ask you to remember? Reply with that code only. Do not use tools.",
    );
    await composer.press("Enter");
    await expect(panel.getByText("AGY_MAIN_CONTEXT", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByTestId("side-chat-back").click();
    const history = page.getByTestId("side-chat-history");
    const rows = history.locator('[data-testid^="side-chat-history-"]');
    await expect(rows).toHaveCount(1);
    const rowId = await rows.first().getAttribute("data-testid");
    if (!rowId) throw new Error("Side conversation has no stable history identity");
    await page.reload();
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(rows).toHaveCount(1);
    await page.getByTestId(rowId).click();
    await expect(panel.getByText("AGY_MAIN_CONTEXT", { exact: true })).toBeVisible();
    await page.getByTestId(`workspace-tab-side_chat_${agent.id}`).hover();
    await page.getByTestId(`workspace-side-chat-close-${agent.id}`).click();
    await page.getByTestId(`workspace-tab-agent_${agent.id}`).click();

    const toggle = page.getByTestId("workspace-toggle-agent-conversation-view");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expectTerminalSurfaceVisible(page);
    const terminals = await workspace.client.listTerminals(workspace.repoPath, undefined, {
      workspaceId: workspace.workspaceId,
    });
    const terminal = terminals.terminals.find((entry) => entry.linkedAgentId === agent.id);
    if (!terminal) throw new Error("Antigravity conversation terminal was not linked");
    const terminalText = async () => {
      const capture = await workspace.client.captureTerminal(terminal.id, { stripAnsi: true });
      return capture.lines.join("\n");
    };
    await expect
      .poll(terminalText, { timeout: 30_000 })
      .toContain("Do you trust the contents of this project?");
    await expect.poll(terminalText).toContain(workspace.repoPath);
    workspace.client.sendTerminalInput(terminal.id, { type: "input", data: "\r" });
    await expect.poll(terminalText, { timeout: 30_000 }).toContain("AGY_MAIN_CONTEXT");
    workspace.client.sendTerminalInput(terminal.id, {
      type: "input",
      data: "Reply with AGY_TUI_ followed immediately by SENTINEL. Do not use tools.",
    });
    await expect.poll(terminalText).toContain("Reply with AGY_TUI_");
    workspace.client.sendTerminalInput(terminal.id, { type: "input", data: "\r" });
    await expect.poll(terminalText, { timeout: 90_000 }).toContain("AGY_TUI_SENTINEL");
    await toggle.click();
    await expectComposerVisible(page, { timeout: 30_000 });
    await expect(
      page.getByTestId("conversation-surface-agent").getByText("AGY_TUI_SENTINEL", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await workspace.cleanup();
  }
});
