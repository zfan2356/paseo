import { writeFile as writeFailureEvidence } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { gotoWorkspace, clickNewTerminal } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { openDirectoryResources, waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { waitForSettledPosition } from "../support/helpers/sheet-layout";

// The sidebar and directory resources share the original workspace projection.

function workspaceRow(page: Page, workspaceId: string) {
  return page
    .getByTestId("workspace-resource-list")
    .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function projectRow(page: Page, projectKey: string) {
  return page
    .getByTestId("workspace-resource-list")
    .getByTestId(`sidebar-project-row-${projectEquivalenceViewKey(projectKey)}`);
}

function projectNewWorktreeIcon(page: Page, projectKey: string) {
  return page
    .getByTestId("workspace-resource-list")
    .getByTestId(`sidebar-project-new-worktree-${projectEquivalenceViewKey(projectKey)}`);
}

async function seedSecondWorkspace(seeded: SeededWorkspace, title: string): Promise<string> {
  const created = await seeded.client.createWorkspace({
    source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
    title,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? `Failed to create second workspace for ${seeded.projectId}`);
  }
  return created.workspace.id;
}

test.describe("Model B sidebar shape", () => {
  test.describe.configure({ timeout: 180_000 });

  test("git and non-git projects both render as expandable parents, both show a per-row New workspace icon, and the global button covers both", async ({
    page,
  }) => {
    const gitProject = await seedWorkspace({ repoPrefix: "model-b-git-" });
    const nonGitProject = await seedWorkspace({ repoPrefix: "model-b-nongit-", git: false });

    try {
      const gitSecondId = await seedSecondWorkspace(gitProject, "Git second");
      const nonGitSecondId = await seedSecondWorkspace(nonGitProject, "Non-git second");

      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      // Both projects are expandable parents — the non-git one is NOT flattened
      // into a bare workspace link.
      await expect(projectRow(page, gitProject.projectKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, nonGitProject.projectKey)).toBeVisible({ timeout: 30_000 });

      // Each parent shows both of its workspace rows underneath.
      await expect(workspaceRow(page, gitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, gitSecondId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitProject.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow(page, nonGitSecondId)).toBeVisible({ timeout: 30_000 });

      // Both projects show a per-row New workspace icon (revealed on hover): the
      // git project can branch off a worktree, and the non-git project can add
      // another workspace because the host supports workspaceMultiplicity.
      await projectRow(page, gitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, gitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });
      await projectRow(page, nonGitProject.projectKey).hover();
      await expect(projectNewWorktreeIcon(page, nonGitProject.projectKey)).toBeVisible({
        timeout: 30_000,
      });

      // The global new-workspace button is the universal entry — present for both
      // kinds regardless of their per-row affordance.
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await gitProject.cleanup();
      await nonGitProject.cleanup();
    }
  });

  test("no tab, agent, or terminal ever renders as a sidebar row", async ({ page }) => {
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-leaf-",
      title: "Leaf workspace",
    });

    try {
      // Open the workspace and materialize both an agent tab and a terminal tab.
      await gotoWorkspace(page, mock.workspaceId);
      await expect(
        page.getByTestId(`workspace-tab-agent_${mock.agentId}`).filter({ visible: true }),
      ).toBeVisible();

      await clickNewTerminal(page);
      await expect(
        page.locator('[data-testid^="workspace-tab-terminal_"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // A shared workspace stays one row while its agent and terminal tabs remain inside it.
      await openDirectoryResources(page);
      const sidebar = page.getByTestId("workspace-resource-list").filter({ visible: true }).first();
      await expect(workspaceRow(page, mock.workspaceId).first()).toBeVisible({ timeout: 30_000 });
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-agent-row-"]')).toHaveCount(0);
      await expect(sidebar.locator('[data-testid^="sidebar-terminal-row-"]')).toHaveCount(0);
    } finally {
      await mock.cleanup();
    }
  });

  test("status grouping shows only workspace rows and moves a single row when its status changes", async ({
    page,
  }) => {
    const idleProject = await seedWorkspace({ repoPrefix: "model-b-status-idle-" });
    const activeMock = await seedMockAgentWorkspace({
      repoPrefix: "model-b-status-active-",
      title: "Working workspace",
      initialPrompt: "stay busy",
      model: "one-minute-stream",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(workspaceRow(page, idleProject.workspaceId)).toBeVisible({ timeout: 30_000 });

      // Switch to status grouping.
      await selectSidebarStatusGrouping(page);

      const sidebar = page.getByTestId("workspace-resource-list").filter({ visible: true }).first();

      // The idle workspace lands in the Done bucket; the busy mock-agent workspace
      // lands in the Working bucket. Each workspace is bucketed independently.
      await expect(sidebar.getByTestId("sidebar-status-group-done")).toBeVisible({
        timeout: 30_000,
      });
      await expect(sidebar.getByTestId("sidebar-status-group-running")).toBeVisible({
        timeout: 60_000,
      });
      await expect(workspaceRow(page, idleProject.workspaceId).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(workspaceRow(page, activeMock.workspaceId).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(workspaceRow(page, idleProject.workspaceId).first()).toHaveAccessibleName(
        `${idleProject.projectDisplayName}, ${idleProject.workspaceName}`,
      );
      await expect(workspaceRow(page, activeMock.workspaceId).first()).toHaveAccessibleName(
        /Working$/,
      );

      // Only workspace rows are shown — no tab/agent/terminal leaves leak into
      // the status view.
      await expect(sidebar.locator('[data-testid^="workspace-tab-"]')).toHaveCount(0);

      // Status mode drops the project grouping, so each row leads its subtitle
      // with the project's icon to keep projects distinguishable.
      for (const workspaceId of [idleProject.workspaceId, activeMock.workspaceId]) {
        await expect(
          page.getByTestId(`sidebar-row-project-icon-${getServerId()}:${workspaceId}`).first(),
        ).toBeVisible({ timeout: 60_000 });
      }

      // The busy workspace is grouped under Working, the idle one under Done:
      // changing one workspace's status moved only that row.
      const workingRows = sidebar.getByTestId("sidebar-status-group-rows-running");
      const doneRows = sidebar.getByTestId("sidebar-status-group-rows-done");
      await expect(
        workingRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${activeMock.workspaceId}`),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        doneRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${idleProject.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });
      // The busy workspace is NOT also sitting in the Done bucket — only its own
      // row moved.
      await expect(
        doneRows.getByTestId(`sidebar-workspace-row-${getServerId()}:${activeMock.workspaceId}`),
      ).toHaveCount(0);
    } finally {
      await idleProject.cleanup();
      await activeMock.cleanup();
    }
  });
});

for (const width of [1200, 390]) {
  test(`workspace rows keep shared-session directory targets at width ${width}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "session-tree-",
      title: "Investigate checkout",
    });
    const second = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Compare results",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const { createTempDirectory, createTempGitRepo } = await import("../support/helpers/workspace");
    const notes = await createTempDirectory("session-notes-");
    const other = await createTempGitRepo("session-other-");
    try {
      await openAgentRoute(page, mock);
      await expect(page.getByTestId("composer-execution-directory").first()).toBeVisible();
      if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const row = page
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${mock.workspaceId}`)
        .filter({ visible: true });
      await expect(row).toBeVisible();
      await expect(row).toHaveCount(1);
      await expect(page.locator('[data-testid^="session-row-"]')).toHaveCount(0);
      if (width === 390) await page.getByTestId("sidebar-close").click();
      const { openFilesPanel } = await import("../support/helpers/workspace-tabs");
      await openFilesPanel(page);
      const actions = page.getByTestId("session-directory-actions").filter({ visible: true });
      await actions.click();
      await page.getByRole("menuitem", { name: "+ Bind directory", exact: true }).click();
      await page.getByTestId("session-directory-path").fill(`${notes.path}/missing`);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("session-directory-field-error")).toContainText(
        /does not exist|not found|ENOENT/i,
      );
      await page.getByTestId("session-directory-path").fill(notes.path);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("bind-session-directory")).not.toBeVisible();
      await actions.click();
      await page.getByRole("menuitem", { name: "+ Bind directory", exact: true }).click();
      await page.getByTestId("session-directory-path").fill(other.path);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("bind-session-directory")).not.toBeVisible();
      expect((await mock.client.getSessionContext(second.id)).context.linkedDirectories).toEqual(
        [],
      );
      await page.getByTestId("session-directory-select").filter({ visible: true }).click();
      await expect(page.getByRole("menuitem", { name: other.path, exact: true })).toBeVisible();
      await page.getByRole("menuitem", { name: notes.path, exact: true }).click();
      await expect(
        page.getByTestId("file-explorer-tree-scroll").filter({ visible: true }),
      ).toContainText("README.md");
      const screenshot = info.outputPath(`session-directories-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach(`session directories ${width}`, {
        path: screenshot,
        contentType: "image/png",
      });
      // The composer can be behind the compact Explorer; its retained text must still name execution cwd.
      await expect(page.getByTestId("composer-execution-directory").first()).toHaveAttribute(
        "aria-label",
        `Execution: ${mock.cwd}`,
      );
    } finally {
      await mock.cleanup();
      await notes.cleanup();
      await other.cleanup();
    }
  });
}

test("session panels keep a non-Git launch directory and report an expired binding", async ({
  page,
}) => {
  const { createTempDirectory } = await import("../support/helpers/workspace");
  const launch = await seedWorkspace({ repoPrefix: "session-nongit-", git: false });
  const expired = await createTempDirectory("session-expired-");
  const agent = await launch.client.createAgent({
    provider: "mock",
    cwd: launch.repoPath,
    workspaceId: launch.workspaceId,
    title: "Read notes",
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
  try {
    await launch.client.mutateSessionContext(agent.id, { kind: "link", path: expired.path });
    await expired.cleanup();
    await openAgentRoute(page, { agentId: agent.id, workspaceId: launch.workspaceId });
    const { openFilesPanel } = await import("../support/helpers/workspace-tabs");
    await openFilesPanel(page);
    const selector = page.getByTestId("session-directory-select").filter({ visible: true });
    await selector.click();
    await expect(page.getByRole("menuitem", { name: new RegExp("Launch") })).toBeVisible();
    await page.getByRole("menuitem", { name: expired.path, exact: true }).click();
    await expect(page.getByText("Retry", { exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByTestId("session-directory-actions").filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "Remove binding", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await launch.client.getSessionContext(agent.id)).context.linkedDirectories.length,
      )
      .toBe(0);
    await expect(
      page.getByTestId("file-explorer-tree-scroll").filter({ visible: true }),
    ).toContainText("README.md");
  } finally {
    await launch.cleanup();
    await expired.cleanup();
  }
});

test("session tree retains a terminal workspace with no root session", async ({ page }) => {
  const resource = await seedWorkspace({ repoPrefix: "session-terminal-" });
  const created = await resource.client.createTerminal(
    resource.repoPath,
    "Independent terminal",
    undefined,
    { workspaceId: resource.workspaceId },
  );
  expect(created.error).toBeNull();
  if (!created.terminal) throw new Error("Terminal was not created");
  const terminalId = created.terminal.id;
  try {
    await gotoWorkspace(page, resource.workspaceId);
    await openDirectoryResources(page);
    const row = page
      .getByTestId("workspace-resource-list")
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${resource.workspaceId}`)
      .filter({ visible: true });
    await expect(row).toBeVisible();
    await row.click();
    await expect(
      page.getByTestId(`workspace-tab-terminal_${terminalId}`).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.locator('[data-testid^="session-row-"]')).toHaveCount(0);
  } finally {
    await resource.client.killTerminal(terminalId);
    await resource.cleanup();
  }
});

test("session panels resolve nested directory changes against the checkout root", async ({
  page,
}) => {
  const { createTempGitRepo } = await import("../support/helpers/workspace");
  const { writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "session-nested-owner-",
    title: "Nested directory review",
  });
  const repo = await createTempGitRepo("session-nested-bound-", {
    files: [{ path: "sub/nested.txt", content: "original\n" }],
  });
  const binding = path.join(repo.path, "sub");
  try {
    await writeFile(path.join(binding, "nested.txt"), "updated\n");
    await mock.client.mutateSessionContext(mock.agentId, { kind: "link", path: binding });
    await openAgentRoute(page, mock);
    const composer = page
      .locator("textarea[data-composer-input]")
      .filter({ visible: true })
      .first();
    await expect(composer).toBeEditable();
    await composer.fill("Keep the execution directory");
    const { openChangesTreePanel } = await import("../support/helpers/workspace-tabs");
    await openChangesTreePanel(page);
    await page.getByTestId("session-directory-select").filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: binding, exact: true }).click();
    await expect(page.getByText(`Checkout: ${repo.path}`, { exact: true })).toBeVisible();
    const file = page.getByTestId("diff-tree-file-0-toggle").filter({ visible: true });
    await expect(file).toContainText("nested.txt");
    await file.click({ button: "right" });
    await page.getByTestId("diff-tree-file-0-add-to-chat").click();
    const attachment = page
      .getByTestId("composer-workspace-file-attachment-pill")
      .filter({ visible: true });
    await expect(attachment).toContainText(path.join(repo.path, "sub/nested.txt"));
    await expect(composer).toHaveValue("Keep the execution directory");
    await expect(page.getByTestId("composer-execution-directory").first()).toHaveAttribute(
      "aria-label",
      `Execution: ${mock.cwd}`,
    );
  } finally {
    await mock.cleanup();
    await repo.cleanup();
  }
});

async function captureSessionFailure(page: Page, info: TestInfo) {
  await page.screenshot({ path: info.outputPath("failure-before-cleanup.png"), fullPage: true });
  await writeFailureEvidence(
    info.outputPath("failure-before-cleanup.txt"),
    await page.locator("body").ariaSnapshot(),
  );
}

test("Explorer resource action leaves Files and Changes readable at minimum dock width", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "resource-rail-width-",
    title: "Toolbar width check",
  });
  try {
    await page.setViewportSize({ width: 1200, height: 1000 });
    await openAgentRoute(page, mock);
    const { ensureExplorerSidebar } = await import("../support/helpers/workspace-tabs");
    const explorer = await ensureExplorerSidebar(page);
    const handle = page
      .getByTestId("workspace-explorer-sidebar-resize-handle")
      .getByRole("separator");
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing Explorer resize handle");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(1190, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await explorer.boundingBox())?.width ?? 0)).toBe(240);
    await page.mouse.move(600, 900);
    await waitForSettledPosition(explorer);
    await page.screenshot({
      path: info.outputPath("explorer-minimum-width-1200.png"),
      fullPage: true,
    });
    for (const [id, label] of [
      ["files", "Files"],
      ["changes_tree", "Changes"],
    ]) {
      const tab = explorer.getByTestId(`workspace-tab-${id}`);
      await expect(tab.getByText(label, { exact: true })).toBeInViewport({ ratio: 1 });
      const captionFits = await tab.getByText(label, { exact: true }).evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const clip = element.getBoundingClientRect();
        return text.width <= clip.width + 1;
      });
      expect(captionFits).toBe(true);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
    const entry = explorer.getByTestId("workspace-resources-open");
    await expect(entry).toBeInViewport({ ratio: 1 });
    await entry.click();
    await expect(page.getByTestId("workspace-resources-sheet")).toBeVisible();
    await page
      .getByTestId("workspace-resources-sheet")
      .getByRole("button", { name: "Close", exact: true })
      .click();
  } catch (error) {
    await captureSessionFailure(page, info);
    throw error;
  } finally {
    await mock.cleanup();
  }
});
