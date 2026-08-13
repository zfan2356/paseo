import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

async function getCodexForkTerminal(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.find((terminal) => terminal.name === "Codex Fork") ?? null;
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
        initialPrompt: "Reply with the single word ready.",
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

      const forkButton = page.getByTestId("workspace-fork-codex-terminal");
      await expect(forkButton).toBeVisible({ timeout: 30_000 });
      await forkButton.click();

      await expectTerminalSurfaceVisible(page);
      await expect
        .poll(async () => (await getCodexForkTerminal(workspace))?.capabilities?.imagePaste, {
          timeout: 30_000,
        })
        .toBe(true);
      const terminal = await getCodexForkTerminal(workspace);
      if (!terminal) {
        throw new Error("Codex fork terminal disappeared before image paste");
      }
      await expect
        .poll(
          async () =>
            (await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })).lines.join(
              "\n",
            ),
          { timeout: 30_000 },
        )
        .toContain("Thread forked from");

      await pastePngIntoTerminal(page);

      await expect(page.getByTestId("terminal-image-paste-complete")).toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(
          async () =>
            (await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })).lines.join(
              "\n",
            ),
          { timeout: 15_000 },
        )
        .toContain("[Image #1]");
    } finally {
      await workspace.cleanup();
    }
  });
});
