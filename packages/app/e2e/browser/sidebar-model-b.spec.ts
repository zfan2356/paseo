import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { gotoWorkspace, clickNewTerminal } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { openDirectoryResources, waitForSidebarHydration } from "../support/helpers/workspace-ui";

// Directory resources retain the workspace projection; the default tree owns sessions.

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function projectRow(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectEquivalenceViewKey(projectKey)}`);
}

function projectNewWorktreeIcon(page: Page, projectKey: string) {
  return page.getByTestId(`sidebar-project-new-worktree-${projectEquivalenceViewKey(projectKey)}`);
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

      // Resource rows remain containers; the default tree separately lists sessions.
      await openDirectoryResources(page);
      const sidebar = page
        .getByTestId("directory-terminal-resource-list")
        .filter({ visible: true })
        .first();
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

      const sidebar = page.getByTestId("sidebar-sessions").filter({ visible: true }).first();

      // The idle workspace lands in the Done bucket; the busy mock-agent workspace
      // lands in the Working bucket. Each workspace is bucketed independently.
      await expect(page.getByTestId("sidebar-status-group-done")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("sidebar-status-group-running")).toBeVisible({
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
      const workingRows = page.getByTestId("sidebar-status-group-rows-running");
      const doneRows = page.getByTestId("sidebar-status-group-rows-done");
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
  test(`session tree keeps shared-workspace sessions and explicit directories at width ${width}`, async ({
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
      const { openAgentRoute } = await import("../support/helpers/mock-agent");
      await openAgentRoute(page, mock);
      await expect(page.getByTestId("composer-execution-directory").first()).toBeVisible();
      if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const firstRow = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
      const secondRow = page.getByTestId(`session-row-${second.id}`).filter({ visible: true });
      await expect(firstRow).toBeVisible();
      await expect(firstRow).toContainText("Investigate checkout");
      await expect(secondRow).toContainText("Compare results");
      await firstRow.getByRole("button", { name: "Expand session directories" }).click();
      await expect(firstRow).toContainText("Launch · Execution");
      await expect(firstRow).toContainText("main checkout");
      await firstRow.getByRole("button", { name: "+ Bind directory", exact: true }).click();
      await page.getByTestId("session-directory-path").fill(`${notes.path}/missing`);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("session-directory-field-error")).toContainText(
        /does not exist|not found|ENOENT/i,
      );
      await page.getByTestId("session-directory-path").fill(notes.path);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(
        page.getByTestId(`session-directory-${mock.agentId}-${notes.path}`),
      ).toBeVisible();
      await expect(firstRow).toContainText("Non-Git directory");
      await firstRow.getByRole("button", { name: "+ Bind directory", exact: true }).click();
      await page.getByTestId("session-directory-path").fill(other.path);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(
        page.getByTestId(`session-directory-${mock.agentId}-${other.path}`),
      ).toContainText("main checkout");
      await expect(secondRow).not.toContainText(notes.path);
      const screenshot = info.outputPath(`session-tree-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach(`session tree ${width}`, { path: screenshot, contentType: "image/png" });
      await page.getByTestId(`session-directory-${mock.agentId}-${notes.path}`).click();
      await expect(page.getByTestId("files-pane-header").filter({ visible: true })).toBeVisible();
      await expect(
        page.getByTestId("file-explorer-tree-scroll").filter({ visible: true }),
      ).toContainText("README.md");
      // The composer can be behind the compact Explorer; its retained text must still name execution cwd.
      await expect(page.getByTestId("composer-execution-directory").first()).toContainText(
        mock.cwd,
      );
    } finally {
      await mock.cleanup();
      await notes.cleanup();
      await other.cleanup();
    }
  });
}

test("session tree keeps a non-Git launch directory and reports an expired binding", async ({
  page,
}) => {
  const { createTempDirectory } = await import("../support/helpers/workspace");
  const { openAgentRoute } = await import("../support/helpers/mock-agent");
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
    const row = page.getByTestId(`session-row-${agent.id}`).filter({ visible: true });
    await row.getByRole("button", { name: "Expand session directories" }).click();
    await expect(row).toContainText("Non-Git directory");
    const missing = page.getByTestId(`session-directory-${agent.id}-${expired.path}`);
    await expect(missing).toContainText("Unavailable");
    await row
      .getByRole("button", { name: `Directory actions ${expired.path}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Remove binding", exact: true }).click();
    await expect(missing).toHaveCount(0);
    await expect(row).toContainText("Launch · Execution");
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
    await page.getByTestId("directory-terminal-resources").filter({ visible: true }).click();
    const row = page
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

test("session tree resolves nested directory changes against the checkout root", async ({
  page,
}) => {
  const { createTempGitRepo } = await import("../support/helpers/workspace");
  const { openAgentRoute } = await import("../support/helpers/mock-agent");
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
    const row = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
    await row.getByRole("button", { name: "Expand session directories" }).click();
    await row.getByRole("button", { name: `Directory actions ${binding}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Local changes", exact: true }).click();
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
    await expect(page.getByTestId("composer-execution-directory").first()).toContainText(mock.cwd);
  } finally {
    await mock.cleanup();
    await repo.cleanup();
  }
});
