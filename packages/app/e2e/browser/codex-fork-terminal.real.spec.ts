import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

async function getCodexConversationTerminal(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.find((terminal) => terminal.name === "Codex Conversation") ?? null;
}

async function pastePngIntoTerminal(page: Parameters<typeof expectTerminalSurfaceVisible>[0]) {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await page.getByTestId("terminal-surface").evaluate((surface, base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    const target = surface.querySelector("textarea") ?? surface;
    target.dispatchEvent(event);
  }, pngBase64);
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

      await page.getByTestId("workspace-header-menu-trigger").click();
      await expect(page.getByTestId("workspace-header-new-terminal")).toBeVisible();
      await page.keyboard.press("Escape");

      const viewToggle = page.getByTestId("workspace-toggle-codex-conversation-view");
      await expect(viewToggle).toBeVisible({ timeout: 30_000 });
      await viewToggle.click();

      await expectTerminalSurfaceVisible(page);
      await expect
        .poll(
          async () => (await getCodexConversationTerminal(workspace))?.capabilities?.imagePaste,
          {
            timeout: 30_000,
          },
        )
        .toBe(true);
      const terminal = await getCodexConversationTerminal(workspace);
      if (!terminal) {
        throw new Error("Codex conversation terminal disappeared after the view switch");
      }
      expect(terminal.linkedAgentId).toBe(agent.id);
      await expect
        .poll(
          async () =>
            (await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })).lines.join(
              "\n",
            ),
          { timeout: 30_000 },
        )
        .toContain("AGENT_SIDE_SENTINEL");

      const terminalSurface = page.getByTestId("terminal-surface").first();
      await terminalSurface.click();
      await terminalSurface.pressSequentially("Reply with exactly TUI_SIDE_SENTINEL.", {
        delay: 15,
      });
      await page.keyboard.press("Enter");
      await expect
        .poll(
          async () => {
            const text = (
              await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })
            ).lines.join("\n");
            return text.match(/TUI_SIDE_SENTINEL/g)?.length ?? 0;
          },
          { timeout: 90_000 },
        )
        .toBeGreaterThanOrEqual(2);
      await expect
        .poll(async () => (await getCodexConversationTerminal(workspace))?.activity?.state, {
          timeout: 30_000,
        })
        .not.toBe("working");

      await viewToggle.click();
      await expect(page.getByText("TUI_SIDE_SENTINEL", { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(async () => await getCodexConversationTerminal(workspace), { timeout: 30_000 })
        .toBeNull();

      const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
      await composer.fill("Reply with exactly AGENT_RETURN_SENTINEL.");
      await composer.press("Enter");
      const returned = await workspace.client.waitForFinish(agent.id, 90_000);
      expect(returned.status).toBe("idle");
      await expect(page.getByText("AGENT_RETURN_SENTINEL", { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });

      await viewToggle.click();
      await expectTerminalSurfaceVisible(page);
      await expect
        .poll(async () => await getCodexConversationTerminal(workspace), { timeout: 30_000 })
        .not.toBeNull();
      const secondTerminal = await getCodexConversationTerminal(workspace);
      if (!secondTerminal) {
        throw new Error("Codex conversation terminal did not reopen");
      }
      await expect
        .poll(
          async () =>
            (
              await workspace.client.captureTerminal(secondTerminal.id, { stripAnsi: true })
            ).lines.join("\n"),
          { timeout: 30_000 },
        )
        .toContain("AGENT_RETURN_SENTINEL");

      await pastePngIntoTerminal(page);

      await expect(page.getByTestId("terminal-image-paste-complete")).toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(
          async () =>
            (
              await workspace.client.captureTerminal(secondTerminal.id, { stripAnsi: true })
            ).lines.join("\n"),
          { timeout: 15_000 },
        )
        .toContain("[Image #1]");

      await viewToggle.click();
    } finally {
      await workspace.cleanup();
    }
  });
});
