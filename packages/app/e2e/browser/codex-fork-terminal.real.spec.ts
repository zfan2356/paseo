import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedProviderConfiguration } from "../support/helpers/agent-profiles";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalSurfaceVisible, navigateToTerminal } from "../support/helpers/terminal-perf";

async function getCodexConversationTerminal(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  return getConversationTerminal(workspace, "Codex Conversation");
}

async function getConversationTerminal(
  workspace: Awaited<ReturnType<typeof seedWorkspace>>,
  name: string,
) {
  const result = await workspace.client.listTerminals(workspace.repoPath, undefined, {
    workspaceId: workspace.workspaceId,
  });
  return result.terminals.find((terminal) => terminal.name === name) ?? null;
}

function conversationTerminalTab(
  page: Parameters<typeof expectTerminalSurfaceVisible>[0],
  terminalId: string,
) {
  return page.getByTestId(`workspace-tab-terminal_${terminalId}`).first();
}

function workspaceRow(
  page: Parameters<typeof expectTerminalSurfaceVisible>[0],
  workspaceId: string,
) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`).first();
}

async function expectActiveTerminalSurface(
  page: Parameters<typeof expectTerminalSurfaceVisible>[0],
) {
  await expect(page.locator('[data-testid="terminal-surface"]:visible').first()).toBeVisible({
    timeout: 20_000,
  });
}

async function createActivityFocusTerminal(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  const result = await workspace.client.createTerminal(
    workspace.repoPath,
    "Activity focus",
    undefined,
    { workspaceId: workspace.workspaceId },
  );
  if (!result.terminal) {
    throw new Error(result.error ?? "Failed to create activity focus terminal");
  }
  return result.terminal;
}

async function pastePngIntoTerminal(page: Parameters<typeof expectTerminalSurfaceVisible>[0]) {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await page
    .locator('[data-testid="terminal-surface"]:visible')
    .first()
    .evaluate((surface, base64) => {
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

      const viewToggle = page.getByTestId("workspace-toggle-agent-conversation-view");
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
      let codexStartupText = "";
      await expect
        .poll(
          async () => {
            codexStartupText = (
              await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })
            ).lines.join("\n");
            return (
              codexStartupText.includes("Hooks need review") ||
              codexStartupText.includes("AGENT_SIDE_SENTINEL")
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      if (codexStartupText.includes("Hooks need review")) {
        workspace.client.sendTerminalInput(terminal.id, { type: "input", data: "\x1b[B\r" });
      }
      await expect
        .poll(
          async () =>
            (await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })).lines.join(
              "\n",
            ),
          { timeout: 30_000 },
        )
        .toContain("AGENT_SIDE_SENTINEL");

      const activityFocusTerminal = await createActivityFocusTerminal(workspace);

      const terminalSurface = page.getByTestId("terminal-surface").first();
      await terminalSurface.click();
      await terminalSurface.pressSequentially("Reply with exactly TUI_SIDE_SENTINEL.", {
        delay: 15,
      });
      await page.keyboard.press("Enter");
      await expect(
        conversationTerminalTab(page, terminal.id).locator('[data-status-bucket="running"]'),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        workspaceRow(page, workspace.workspaceId).getByTestId("workspace-status-indicator-running"),
      ).toBeVisible({ timeout: 30_000 });
      await navigateToTerminal(page, {
        workspaceId: workspace.workspaceId,
        terminalId: activityFocusTerminal.id,
      });
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

      await expect(
        conversationTerminalTab(page, terminal.id).locator('[data-status-bucket="attention"]'),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        workspaceRow(page, workspace.workspaceId).getByTestId(
          "workspace-status-indicator-attention",
        ),
      ).toBeVisible({ timeout: 30_000 });
      await conversationTerminalTab(page, terminal.id).click();
      await expectTerminalSurfaceVisible(page);

      await viewToggle.click();
      await expect(page.getByText("TUI_SIDE_SENTINEL", { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(async () => await getCodexConversationTerminal(workspace), { timeout: 30_000 })
        .toBeNull();

      const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
      await composer.fill("Reply with exactly AGENT_RETURN_SENTINEL.");
      const returnStarted = workspace.client.waitForAgentUpsert(
        agent.id,
        (snapshot) => snapshot.status === "running",
        30_000,
      );
      await composer.press("Enter");
      await returnStarted;
      const returned = await workspace.client.waitForFinish(agent.id, 90_000);
      expect(returned.status).toBe("idle");
      await expect(page.getByText("AGENT_RETURN_SENTINEL", { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });

      await viewToggle.click();
      await expectActiveTerminalSurface(page);
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

test.describe("Claude Code and Cursor conversation view switch", () => {
  test.setTimeout(300_000);
  test.describe.configure({ mode: "serial" });

  for (const providerCase of [
    {
      provider: "claude",
      terminalName: "Claude Code Conversation",
      modeId: "bypassPermissions",
      featureValues: undefined,
    },
    {
      provider: "cursor",
      terminalName: "Cursor Conversation",
      modeId: "agent",
      featureValues: { auto_accept: true },
    },
  ] as const) {
    test(`round-trips one ${providerCase.provider} session between Agent and terminal views`, async ({
      page,
    }) => {
      const workspace = await seedWorkspace({
        repoPrefix: `${providerCase.provider}-conversation-terminal-`,
      });
      const initialSentinel = `${providerCase.provider.toUpperCase()}_AGENT_SIDE_SENTINEL`;
      const terminalSentinel = `${providerCase.provider.toUpperCase()}_TUI_SIDE_SENTINEL`;
      const returnSentinel = `${providerCase.provider.toUpperCase()}_AGENT_RETURN_SENTINEL`;
      let providerSeed: Awaited<ReturnType<typeof seedProviderConfiguration>> | null = null;

      try {
        providerSeed =
          providerCase.provider === "cursor"
            ? await seedProviderConfiguration("cursor", {
                extends: "acp",
                label: "Cursor",
                enabled: true,
                command: ["cursor-agent", "acp"],
              })
            : null;
        const agent = await workspace.client.createAgent({
          provider: providerCase.provider,
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: `${providerCase.provider} conversation switch`,
          modeId: providerCase.modeId,
          featureValues: providerCase.featureValues,
          initialPrompt: `Reply with exactly ${initialSentinel}.`,
        });
        const finished = await workspace.client.waitForFinish(agent.id, 120_000);
        expect(finished.status).toBe("idle");
        expect(finished.final?.lastError).toBeFalsy();
        await openAgentRoute(page, {
          workspaceId: workspace.workspaceId,
          agentId: agent.id,
        });

        const viewToggle = page.getByTestId("workspace-toggle-agent-conversation-view");
        await expect(viewToggle).toBeVisible({ timeout: 30_000 });
        await viewToggle.click();
        await expectTerminalSurfaceVisible(page);

        await expect
          .poll(() => getConversationTerminal(workspace, providerCase.terminalName), {
            timeout: 30_000,
          })
          .not.toBeNull();
        const linkedTerminal = await getConversationTerminal(workspace, providerCase.terminalName);
        if (!linkedTerminal) {
          throw new Error(`${providerCase.terminalName} disappeared after the view switch`);
        }
        expect(linkedTerminal.linkedAgentId).toBe(agent.id);
        if (providerCase.provider === "claude") {
          await expect
            .poll(
              async () =>
                (
                  await workspace.client.captureTerminal(linkedTerminal.id, { stripAnsi: true })
                ).lines.join("\n"),
              { timeout: 30_000 },
            )
            .toContain("Yes, I trust this folder");
          workspace.client.sendTerminalInput(linkedTerminal.id, { type: "input", data: "\r" });
        }
        await expect
          .poll(
            async () =>
              (
                await workspace.client.captureTerminal(linkedTerminal.id, { stripAnsi: true })
              ).lines.join("\n"),
            { timeout: 45_000 },
          )
          .toContain(initialSentinel);

        const activityFocusTerminal = await createActivityFocusTerminal(workspace);

        workspace.client.sendTerminalInput(linkedTerminal.id, {
          type: "input",
          data: `Reply with exactly ${terminalSentinel}.`,
        });
        await page.waitForTimeout(100);
        workspace.client.sendTerminalInput(linkedTerminal.id, { type: "input", data: "\r" });
        await expect(
          conversationTerminalTab(page, linkedTerminal.id).locator(
            '[data-status-bucket="running"]',
          ),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          workspaceRow(page, workspace.workspaceId).getByTestId(
            "workspace-status-indicator-running",
          ),
        ).toBeVisible({ timeout: 30_000 });
        await navigateToTerminal(page, {
          workspaceId: workspace.workspaceId,
          terminalId: activityFocusTerminal.id,
        });
        await expect
          .poll(
            async () => {
              const text = (
                await workspace.client.captureTerminal(linkedTerminal.id, { stripAnsi: true })
              ).lines.join("\n");
              return text.match(new RegExp(terminalSentinel, "g"))?.length ?? 0;
            },
            { timeout: 120_000 },
          )
          .toBeGreaterThanOrEqual(2);
        await expect
          .poll(() => getConversationTerminal(workspace, providerCase.terminalName), {
            timeout: 30_000,
          })
          .not.toMatchObject({ activity: { state: "working" } });

        await expect(
          conversationTerminalTab(page, linkedTerminal.id).locator(
            '[data-status-bucket="attention"]',
          ),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          workspaceRow(page, workspace.workspaceId).getByTestId(
            "workspace-status-indicator-attention",
          ),
        ).toBeVisible({ timeout: 30_000 });
        await conversationTerminalTab(page, linkedTerminal.id).click();
        await expectTerminalSurfaceVisible(page);

        await viewToggle.click();
        await expect(page.getByText(terminalSentinel, { exact: true }).last()).toBeVisible({
          timeout: 45_000,
        });
        await expect(viewToggle).toBeEnabled({ timeout: 1_000 });
        await expect
          .poll(() => getConversationTerminal(workspace, providerCase.terminalName), {
            timeout: 30_000,
          })
          .toBeNull();

        const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
        await composer.fill(`Reply with exactly ${returnSentinel}.`);
        const returnStarted = workspace.client.waitForAgentUpsert(
          agent.id,
          (snapshot) => snapshot.status === "running",
          30_000,
        );
        await composer.press("Enter");
        await returnStarted;
        const returned = await workspace.client.waitForFinish(agent.id, 120_000);
        expect(returned.status).toBe("idle");
        await expect(page.getByText(returnSentinel, { exact: true }).last()).toBeVisible({
          timeout: 30_000,
        });

        await viewToggle.click();
        await expectActiveTerminalSurface(page);
        await expect
          .poll(async () => {
            const terminal = await getConversationTerminal(workspace, providerCase.terminalName);
            if (!terminal) return "";
            return (
              await workspace.client.captureTerminal(terminal.id, { stripAnsi: true })
            ).lines.join("\n");
          })
          .toContain(returnSentinel);
        await viewToggle.click();
      } finally {
        await workspace.cleanup();
        await providerSeed?.restore();
      }
    });
  }
});
