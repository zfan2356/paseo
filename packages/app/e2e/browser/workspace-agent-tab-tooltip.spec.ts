import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";

const TITLE_MAX_LENGTH = 80;

function normalizedTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function expectedTooltipTitle(title: string): string {
  const singleLineTitle = normalizedTitle(title);
  return singleLineTitle.length <= TITLE_MAX_LENGTH
    ? singleLineTitle
    : `${singleLineTitle.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

async function openAgent(page: Page, agent: { id: string; workspaceId: string }): Promise<void> {
  await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, agent.workspaceId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
  await waitForWorkspaceTabsVisible(page);
}

async function openAgentTabTooltip(page: Page, agentId: string, title: string): Promise<Locator> {
  await page.getByRole("button", { name: normalizedTitle(title), exact: true }).hover();
  const tooltip = page.getByTestId(`workspace-tab-tooltip-agent_${agentId}`);
  await expect(tooltip).toBeVisible({ timeout: 10_000 });
  return tooltip;
}

async function expectTwoRowAgentSummary(
  tooltip: Locator,
  input: { title: string; agentId: string },
): Promise<void> {
  const title = tooltip.getByText(expectedTooltipTitle(input.title), { exact: true });
  const id = tooltip.getByText(input.agentId.slice(0, 7), { exact: true });
  const activity = tooltip.getByText(/^(just now|\d+[mhd] ago|[A-Z][a-z]{2} \d{1,2})$/);

  await expect(title).toBeVisible();
  await expect(id).toBeVisible();
  await expect(tooltip.getByText("·", { exact: true })).toBeVisible();
  await expect(activity).toBeVisible();
  expect((await title.boundingBox())?.y).toBeLessThan((await id.boundingBox())?.y ?? 0);
}

test.describe("Workspace agent tab tooltip", () => {
  test("summarizes a multiline agent title above its ID and last activity", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "workspace-agent-tooltip-" });

    try {
      const title = [
        "Short first line",
        "followed by a much longer continuation that should be joined before the complete title is truncated to a useful tooltip length",
      ].join("\n");
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title,
      });

      await openAgent(page, agent);
      const tooltip = await openAgentTabTooltip(page, agent.id, title);

      await expectTwoRowAgentSummary(tooltip, { title, agentId: agent.id });
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows a live subagent count independently of the main turn indicator", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "workspace-tab-subagent-activity-" });
    try {
      const setup = {
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        modeId: "load-test",
        model: "five-minute-stream",
      };
      const title = "Subagent activity parent";
      const parent = await workspace.client.createAgent({ ...setup, title });
      const child = await workspace.client.createAgent({
        ...setup,
        title: "Subagent activity child",
        labels: { [PARENT_AGENT_ID_LABEL]: parent.id },
      });
      await openAgent(page, { id: parent.id, workspaceId: workspace.workspaceId });
      const tab = page.getByTestId(`workspace-tab-agent_${parent.id}`);
      const badge = tab.getByTestId("workspace-tab-running-subagents");
      const ownRunning = tab.getByRole("progressbar", { name: "Agent running" });

      await workspace.client.sendAgentMessage(child.id, "Keep working");
      await expect(badge).toHaveText("1");
      await expect(ownRunning).toHaveCount(0);
      const tooltip = await openAgentTabTooltip(page, parent.id, title);
      await expect(tooltip.getByText("1 subagent running", { exact: true })).toBeVisible();

      await workspace.client.sendAgentMessage(parent.id, "Keep working too");
      await expect(ownRunning).toBeVisible();
      await expect(badge).toHaveText("1");

      await workspace.client.cancelAgent(child.id);
      await expect(badge).toHaveCount(0);
      await expect(ownRunning).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
