import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { gotoWorkspace, clickNewTerminal } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { openDirectoryResources, waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { waitForSettledPosition } from "../support/helpers/sheet-layout";

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

async function expectSessionSidebarSettled(page: Page) {
  const sidebar = page.getByTestId("session-sidebar").filter({ visible: true });
  const sessions = page.getByTestId("session-navigation-sessions").filter({ visible: true });
  const resources = page.getByTestId("directory-terminal-resources").filter({ visible: true });
  const pinnedTitle = sidebar.getByTestId("session-pinned-toggle");
  await expect(sidebar).toBeInViewport({ ratio: 1 });
  await expect(sessions).toBeInViewport({ ratio: 1 });
  await expect(resources).toBeInViewport({ ratio: 1 });
  await expect(pinnedTitle).toBeInViewport({ ratio: 1 });
  const newWorkspace = page.getByTestId("sidebar-global-new-workspace").filter({ visible: true });
  await expect(newWorkspace).toBeInViewport({ ratio: 1 });
  await expect(newWorkspace.locator("svg").first()).toBeInViewport({ ratio: 1 });
  await sidebar.scrollIntoViewIfNeeded();
  const frames = await sidebar.evaluate(async (element) => {
    const samples = [];
    for (let frame = 0; frame < 6; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const { x, y, width, height } = element.getBoundingClientRect();
      samples.push({ x, y, width, height });
    }
    return samples;
  });
  expect(frames[0].x).toBe(0);
  for (const frame of frames) expect(frame).toEqual(frames[0]);
  return frames;
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
    await expect(page.getByTestId("composer-execution-directory").first()).toHaveAttribute(
      "aria-label",
      `Execution: ${mock.cwd}`,
    );
  } finally {
    await mock.cleanup();
    await repo.cleanup();
  }
});

test("session navigation restores nine pins and swaps complete lists without changing execution", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "navigation-pins-",
    title: "Pinned session 0",
  });
  const other = await seedWorkspace({ repoPrefix: "navigation-other-" });
  const notes = await seedWorkspace({ repoPrefix: "navigation-notes-", git: false });
  const third = await seedWorkspace({ repoPrefix: "navigation-third-" });
  const { createTempDirectory } = await import("../support/helpers/workspace");
  const { execFileSync } = await import("node:child_process");
  const path = await import("node:path");
  const { writeFile } = await import("node:fs/promises");
  const trees = await createTempDirectory("navigation-worktrees-");
  const treeProjects: string[] = [];
  try {
    execFileSync("git", ["branch", "-m", "trunk"], { cwd: mock.cwd });
    const worktreeAgents: string[] = [];
    for (const branch of ["one", "two"]) {
      const cwd = path.join(trees.path, branch);
      execFileSync("git", ["worktree", "add", "-b", branch, cwd], {
        cwd: mock.cwd,
        stdio: "ignore",
      });
      const { workspace } = await mock.client.createWorkspace({
        source: { kind: "directory", path: cwd },
      });
      if (!workspace) throw new Error("Worktree workspace not created");
      treeProjects.push(workspace.projectId);
      const agent = await mock.client.createAgent({
        provider: "mock",
        cwd,
        workspaceId: workspace.id,
        title: `Worktree ${branch}`,
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      worktreeAgents.push(agent.id);
    }
    const mainContext = await mock.client.mutateSessionContext(mock.agentId, {
      kind: "pin",
      pinned: false,
    });
    for (const agentId of worktreeAgents) {
      const { context } = await mock.client.mutateSessionContext(agentId, {
        kind: "pin",
        pinned: false,
      });
      expect(context.projectId).toBe(mainContext.context.projectId);
      expect(context.projectAssignment).toBe("automatic");
    }
    const pinned = [mock.agentId];
    for (let index = 1; index < 9; index++) {
      const agent = await mock.client.createAgent({
        provider: "mock",
        cwd: mock.cwd,
        workspaceId: mock.workspaceId,
        title: `Pinned session ${index}`,
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      pinned.push(agent.id);
    }
    for (const id of pinned)
      await mock.client.mutateSessionContext(id, { kind: "pin", pinned: true });
    const ordinary = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Ordinary session",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const independent = await other.client.createAgent({
      provider: "mock",
      cwd: other.repoPath,
      workspaceId: other.workspaceId,
      title: "Independent repository",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const nonGit = await notes.client.createAgent({
      provider: "mock",
      cwd: notes.repoPath,
      workspaceId: notes.workspaceId,
      title: "Non-Git notes",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await third.client.createAgent({
      provider: "mock",
      cwd: third.repoPath,
      workspaceId: third.workspaceId,
      title: "Second independent repository",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const { openAgentRoute } = await import("../support/helpers/mock-agent");
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await openAgentRoute(page, mock);
      const directory = page.getByTestId("composer-execution-directory").filter({ visible: true });
      await expect(directory).toHaveAttribute("aria-label", `Execution: ${mock.cwd}`);
      await expect(directory).not.toContainText("Execution:");
      await directory.click();
      const fullPath = page.getByTestId("execution-directory-full-path");
      await expect(fullPath).toHaveText(mock.cwd);
      await expect(fullPath).toBeVisible();
      // Playwright waits for stable geometry before scrolling the animated sheet content.
      await fullPath.scrollIntoViewIfNeeded();
      await expect(fullPath).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: info.outputPath(`execution-directory-details-${width}.png`),
        fullPage: true,
      });
      await page
        .getByTestId("execution-directory-details")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(page.getByTestId("execution-directory-full-path")).not.toBeVisible();
      if (width === 1200) {
        await directory.hover();
        await expect(page.getByText(`Execution: ${mock.cwd}`, { exact: true })).toBeVisible();
        await page.screenshot({
          path: info.outputPath("execution-directory-hover-1200.png"),
          fullPage: true,
        });
        await page.mouse.move(0, 0);
        await expect(page.getByText(`Execution: ${mock.cwd}`, { exact: true })).not.toBeVisible();
      }
      await page.screenshot({
        path: info.outputPath(`execution-directory-${width}.png`),
        fullPage: true,
      });
      if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const sidebar = page.getByTestId("session-sidebar").filter({ visible: true });
      const openingBounds = await sidebar.boundingBox();
      const pins = sidebar.getByTestId("session-pinned-section");
      await expect(pins.locator('[data-testid^="session-row-"]')).toHaveCount(9);
      await expect(sidebar.locator('[data-testid^="session-row-"]')).toHaveCount(15);
      await expect(pins).not.toContainText("Ordinary session");
      const repositoryGroup = sidebar
        .locator('[data-testid^="session-group-"]')
        .filter({ has: page.getByTestId(`session-row-${ordinary.id}`) });
      await expect(repositoryGroup.locator('[data-testid^="session-row-"]')).toHaveCount(3);
      for (const id of worktreeAgents)
        await expect(repositoryGroup.getByTestId(`session-row-${id}`)).toBeVisible();

      await expect(sidebar.getByTestId(`session-row-${independent.id}`)).toBeVisible();
      await expect(sidebar.getByTestId(`session-row-${nonGit.id}`)).toBeVisible();
      const settledFrames = await expectSessionSidebarSettled(page);
      const geometryPath = info.outputPath(`sidebar-geometry-${width}.json`);
      await writeFile(geometryPath, JSON.stringify({ openingBounds, settledFrames }, null, 2));
      await info.attach(`sidebar-geometry-${width}`, {
        path: geometryPath,
        contentType: "application/json",
      });
      await page.screenshot({
        path: info.outputPath(`pinned-sessions-${width}.png`),
        fullPage: true,
      });
      await sidebar.getByTestId("session-pinned-toggle").click();
      await expect(pins.locator('[data-testid^="session-row-"]')).toHaveCount(0);
      await repositoryGroup.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`session-repositories-${width}.png`),
        fullPage: true,
      });
      await sidebar.getByTestId("session-pinned-toggle").click();
      await expect(pins.locator('[data-testid^="session-row-"]')).toHaveCount(9);
      await page.getByTestId("directory-terminal-resources").filter({ visible: true }).click();
      await expect(sidebar).not.toBeVisible();
      const resources = page
        .getByTestId("directory-terminal-resource-list")
        .filter({ visible: true });
      await expect(resources).toBeVisible();
      await expect(
        resources.getByTestId(`sidebar-workspace-row-${getServerId()}:${mock.workspaceId}`),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`directory-resources-${width}.png`),
        fullPage: true,
      });
      await page.getByTestId("session-navigation-sessions").filter({ visible: true }).click();
      await expect(pins.locator('[data-testid^="session-row-"]')).toHaveCount(9);
      await expect(resources).not.toBeVisible();
      await expect(page.getByTestId("composer-execution-directory").first()).toHaveAttribute(
        "aria-label",
        `Execution: ${mock.cwd}`,
      );
      const settings = sidebar.getByTestId(`session-row-${ordinary.id}`);
      await expect(settings).toBeVisible();
    }
    await mock.client.mutateSessionContext(pinned[0], { kind: "pin", pinned: false });
    const sidebar = page.getByTestId("session-sidebar").filter({ visible: true });
    await expect(
      sidebar.getByTestId("session-pinned-section").locator('[data-testid^="session-row-"]'),
    ).toHaveCount(8);
    await expect(sidebar.getByTestId(`session-row-${pinned[0]}`)).toHaveCount(1);
    await expect(
      sidebar.getByTestId("session-pinned-section").getByTestId(`session-row-${pinned[0]}`),
    ).toHaveCount(0);
  } finally {
    for (const projectId of treeProjects) await mock.client.removeProject(projectId);
    await trees.cleanup();
    await third.cleanup();
    await mock.cleanup();
    await other.cleanup();
    await notes.cleanup();
  }
});

test("session toolbar stays inline and status dots follow each session independently", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "session-toolbar-long-project-name-with-many-components-",
    title: "Review current workspace",
    model: "five-minute-stream",
  });
  const { openAgentRoute } = await import("../support/helpers/mock-agent");
  const agents: string[] = [];
  try {
    for (const title of ["Implementing toolbar", "Waiting for approval", "Failed validation"]) {
      const agent = await mock.client.createAgent({
        provider: "mock",
        cwd: mock.cwd,
        workspaceId: mock.workspaceId,
        title,
        modeId: "load-test",
        model: "five-minute-stream",
      });
      agents.push(agent.id);
    }
    const [running, waiting, failed] = agents;
    await mock.client.mutateSessionContext(running, { kind: "pin", pinned: true });
    await mock.client.mutateSessionContext(waiting, { kind: "pin", pinned: true });
    await mock.client.sendAgentMessage(running, "Implement the toolbar");
    await mock.client.sendAgentMessage(waiting, "Emit synthetic plan approval");
    await mock.client.sendAgentMessage(failed, "Emit synthetic turn failure");

    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 1200) await openAgentRoute(page, mock);
      const directory = page.getByTestId("composer-execution-directory").filter({ visible: true });
      const attach = page.getByTestId("message-input-attach-button").filter({ visible: true });
      const model = page.getByTestId("combined-model-selector").filter({ visible: true });
      const input = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true });
      await expect(directory).toHaveAttribute("aria-label", `Execution: ${mock.cwd}`);
      await expect(directory).toBeInViewport({ ratio: 1 });
      await expect(model).toBeInViewport({ ratio: 1 });
      const directoryGlyph = directory.locator("svg");
      await expect(directoryGlyph).toHaveAttribute("width", width === 390 ? "20" : "16");
      const modelGlyphStroke = await model
        .locator("svg")
        .first()
        .evaluate((node) => getComputedStyle(node).stroke);
      await expect(directoryGlyph).toHaveCSS("stroke", modelGlyphStroke);
      const directoryBox = await directory.boundingBox();
      const attachBox = await attach.boundingBox();
      const inputBox = await input.boundingBox();
      expect(directoryBox).not.toBeNull();
      expect(attachBox).not.toBeNull();
      expect(inputBox).not.toBeNull();
      expect(
        Math.abs(directoryBox!.y + directoryBox!.height / 2 - attachBox!.y - attachBox!.height / 2),
      ).toBeLessThan(2);
      expect(directoryBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
      expect(directoryBox!.x + directoryBox!.width).toBeLessThanOrEqual(width);
      if (width === 390) await expect(directory).toHaveText("");
      else await expect(directory).toContainText("session-toolbar-long-project");
      await input.fill("Inspect this workspace");
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }).filter({ visible: true }),
      ).toBeInViewport({ ratio: 1 });
      await waitForSettledPosition(directory);
      await page.screenshot({ path: info.outputPath(`toolbar-${width}.png`), fullPage: true });
      await directory.click();
      const fullPath = page.getByTestId("execution-directory-full-path");
      await expect(fullPath).toHaveText(mock.cwd);
      await waitForSettledPosition(fullPath);
      await expect(fullPath).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: info.outputPath(`directory-details-${width}.png`),
        fullPage: true,
      });
      await page
        .getByTestId("execution-directory-details")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      if (width === 1200) {
        await directory.hover();
        await expect(page.getByText(`Execution: ${mock.cwd}`, { exact: true })).toBeVisible();
        await page.screenshot({
          path: info.outputPath("directory-hover-1200.png"),
          fullPage: true,
        });
        await page.mouse.move(0, 0);
      }
      if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const sidebar = page.getByTestId("session-sidebar").filter({ visible: true });
      await expectSessionSidebarSettled(page);
      for (const [id, label] of [
        [running, "Working"],
        [waiting, "Needs input"],
        [failed, "Failed"],
        [mock.agentId, "Done"],
      ]) {
        const status = sidebar.getByTestId(`session-status-${id}`);
        await expect(status).toHaveAttribute("aria-label", label);
        await expect(status).toBeInViewport({ ratio: 1 });
        await expect(status.locator(":scope > div")).toHaveCSS("width", "6px");
      }
      const colors = await Promise.all(
        [running, waiting, failed, mock.agentId].map((id) =>
          sidebar
            .getByTestId(`session-status-${id}`)
            .locator(":scope > div")
            .evaluate((node) => getComputedStyle(node).backgroundColor),
        ),
      );
      expect(new Set(colors).size).toBe(4);
      await page.screenshot({
        path: info.outputPath(`session-states-${width}.png`),
        fullPage: true,
      });
    }

    const sidebar = page.getByTestId("session-sidebar").filter({ visible: true });
    await mock.client.cancelAgent(agents[0]);
    await expect(sidebar.getByTestId(`session-status-${agents[0]}`)).toHaveAttribute(
      "aria-label",
      "Ready to review",
    );
    await expect(sidebar.getByTestId(`session-status-${agents[1]}`)).toHaveAttribute(
      "aria-label",
      "Needs input",
    );
    await expect(sidebar.getByTestId(`session-status-${agents[2]}`)).toHaveAttribute(
      "aria-label",
      "Failed",
    );
    await mock.client.sendAgentMessage(agents[2], "Retry the validation");
    await expect(sidebar.getByTestId(`session-status-${agents[2]}`)).toHaveAttribute(
      "aria-label",
      "Working",
    );
    await page.screenshot({
      path: info.outputPath("session-states-transition-390.png"),
      fullPage: true,
    });
    await mock.client.mutateSessionContext(agents[2], { kind: "pin", pinned: true });
    await expect(
      sidebar.getByTestId("session-pinned-section").getByTestId(`session-status-${agents[2]}`),
    ).toHaveAttribute("aria-label", "Working");
  } finally {
    await Promise.allSettled(agents.map((id) => mock.client.cancelAgent(id)));
    await mock.cleanup();
  }
});
