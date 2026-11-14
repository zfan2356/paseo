import { writeFile as writeFailureEvidence } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { gotoWorkspace, clickNewTerminal } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import {
  rejectNextManagedSubagentArchiveRequest,
  holdManagedSubagentArchiveRequest,
} from "../support/helpers/subagents";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { openDirectoryResources, waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { loadSessionMessageReaders } from "../support/helpers/new-workspace";
import { loadProtocolSchemas } from "../support/helpers/daemon-client-loader";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import type { Locator, WebSocketRoute } from "@playwright/test";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
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
        const tooltip = page.getByText(`Execution: ${mock.cwd}`, { exact: true });
        await expect(tooltip).toBeInViewport({ ratio: 1 });
        await waitForSettledPosition(tooltip);
        await expect
          .poll(() =>
            tooltip.evaluate((element) => {
              for (let node: Element | null = element; node; node = node.parentElement) {
                if (Number(getComputedStyle(node).opacity) < 1) return false;
              }
              return true;
            }),
          )
          .toBe(true);
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

async function captureSessionFailure(page: Page, info: TestInfo) {
  await page.screenshot({ path: info.outputPath("failure-before-cleanup.png"), fullPage: true });
  await writeFailureEvidence(
    info.outputPath("failure-before-cleanup.txt"),
    await page.locator("body").ariaSnapshot(),
  );
}

async function expectSessionMenuSettled(locator: Locator) {
  await waitForSettledPosition(locator);
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
          if (Number(getComputedStyle(node).opacity) < 1) return false;
        }
        return true;
      }),
    )
    .toBe(true);
}

test("session card menus keep same-directory operations isolated across pointer and touch", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "session-card-actions-",
    title: "Current session",
  });
  try {
    const sibling = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Same directory sibling",
      modeId: "load-test",
      model: "five-minute-stream",
    });
    const permission = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Approval session",
      modeId: "load-test",
      model: "five-minute-stream",
    });
    await mock.client.sendAgentMessage(permission.id, "Emit synthetic plan approval");
    await mock.client.mutateSessionContext(sibling.id, { kind: "pin", pinned: true });
    await rejectNextManagedSubagentArchiveRequest(page, mock.agentId);
    await page.setViewportSize({ width: 1200, height: 1000 });
    await openAgentRoute(page, mock);
    const row = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
    const siblingRow = page.getByTestId(`session-row-${sibling.id}`).filter({ visible: true });
    const approvalRow = page.getByTestId(`session-row-${permission.id}`).filter({ visible: true });
    const openMenu = async () => {
      await row.getByTestId("session-menu-trigger").click();
      await expect(page.getByTestId("session-menu-rename")).toBeVisible();
      await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
    };
    await expect(row).toBeVisible();
    await expect(row).toContainText("Directories: 1");
    await row.getByRole("button", { name: "Session menu", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Rename session", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row.getByTestId("session-menu-trigger")).toBeEnabled();
    await row.hover();
    await expect(row.getByTestId("session-hover-archive")).toBeInViewport({ ratio: 1 });
    await row.getByTestId("session-hover-archive").click();
    await expect(row.getByRole("alert")).toContainText("Archive rejected for test");
    await expect(row.getByRole("button", { name: /Current session/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(mock.client.fetchAgent({ agentId: mock.agentId })).resolves.toMatchObject({
      agent: { archivedAt: null },
    });
    await expectSessionSidebarSettled(page);
    await page.screenshot({
      path: info.outputPath("session-archive-failure-1200.png"),
      fullPage: true,
    });

    await openMenu();
    await page.getByTestId("session-menu-rename").click();
    const rename = page.getByTestId("session-rename");
    await rename.getByRole("textbox").fill("Renamed current session");
    await page.getByTestId("session-rename-submit").click();
    await expect(row).toContainText("Renamed current session");
    await expect(siblingRow).toContainText("Same directory sibling");

    await row.click({ button: "right" });
    await expect(page.getByTestId("session-menu-pin")).toHaveText("Pin session");
    await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
    await page.screenshot({
      path: info.outputPath("session-context-menu-1200.png"),
      fullPage: true,
    });
    await page.getByTestId("session-menu-pin").click();
    await expect(
      page.getByTestId("session-pinned-section").getByTestId(`session-row-${mock.agentId}`),
    ).toBeVisible();
    await openMenu();
    await page.getByTestId("session-menu-labels").click();
    await page.getByTestId("workspace-label-picker-create").click();
    await page.getByTestId("workspace-label-picker-create-name").fill("Review session");
    await page
      .getByTestId("workspace-label-picker-create-colors")
      .getByRole("radio")
      .nth(2)
      .click();
    await page.getByTestId("workspace-label-picker-create-submit").click();
    await expect(page.getByTestId("workspace-label-picker-row-Review session")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(mock.client.listWorkspaceLabels()).resolves.toMatchObject({
      labels: expect.arrayContaining([{ name: "Review session", color: "emerald" }]),
    });
    await expect(mock.client.getSessionContext(mock.agentId)).resolves.toMatchObject({
      context: { sidebarLabelNames: ["Review session"] },
    });
    await expect(mock.client.getSessionContext(sibling.id)).resolves.toMatchObject({
      context: { sidebarLabelNames: [] },
    });
    const workspaces = await mock.client.fetchWorkspaces();
    expect(
      workspaces.entries.find((workspace) => workspace.id === mock.workspaceId)?.labels,
    ).toBeUndefined();
    await expect(siblingRow).not.toContainText("Review session");

    await approvalRow.getByTestId("session-menu-trigger").click();
    await expect(page.getByTestId("session-menu-read")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(approvalRow.getByTestId(`session-status-${permission.id}`)).toHaveAttribute(
      "aria-label",
      "Needs input",
    );
    await openMenu();
    await page.getByTestId("session-menu-read").click();
    await expect(page.getByText("Session marked as read", { exact: true })).toBeVisible();
    await expect(approvalRow.getByTestId(`session-status-${permission.id}`)).toHaveAttribute(
      "aria-label",
      "Needs input",
    );

    await page.setViewportSize({ width: 390, height: 1000 });
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expectSessionSidebarSettled(page);
    await openMenu();
    await expect(page.getByTestId("session-menu-archive")).toBeInViewport({ ratio: 1 });
    await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
    await page.screenshot({ path: info.outputPath("session-menu-390.png"), fullPage: true });
    await page.getByTestId("session-menu-pin").click();
    await expect(
      page.getByTestId("session-pinned-section").getByTestId(`session-row-${mock.agentId}`),
    ).toHaveCount(0);
    await openMenu();
    await page.getByTestId("session-menu-archive").click();
    await expect(row).toHaveCount(0);
    await expect(siblingRow).toBeVisible();
    await expect(approvalRow).toBeVisible();
    await expect
      .poll(() => mock.client.fetchAgent({ agentId: mock.agentId }))
      .toMatchObject({ agent: { archivedAt: expect.any(String) } });
    await expect(mock.client.fetchAgent({ agentId: sibling.id })).resolves.toMatchObject({
      agent: { archivedAt: null },
    });
    await expect(mock.client.fetchWorkspaces()).resolves.toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ id: mock.workspaceId })]),
    });
    await page.screenshot({
      path: info.outputPath("session-after-archive-390.png"),
      fullPage: true,
    });
  } catch (error) {
    await captureSessionFailure(page, info);
    throw error;
  } finally {
    await mock.cleanup();
  }
});

test("session card archive preserves pending tabs and focuses the neighbor or launcher", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "session-card-archive-",
    title: "Pending current session",
  });
  let release = () => {};
  try {
    const sibling = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Surviving sibling",
      modeId: "load-test",
      model: "five-minute-stream",
    });
    const gate = await holdManagedSubagentArchiveRequest(page, mock.agentId);
    release = gate.release;
    await openAgentRoute(page, mock);
    const row = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
    await row.getByTestId("session-menu-trigger").click();
    await page.getByTestId("session-menu-archive").click();
    await gate.waitForRequest();
    await expect(row.getByRole("button", { name: /Pending current session/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await row.getByTestId("session-menu-trigger").click();
    await expect(page.getByTestId("session-menu-archive")).toBeDisabled();
    await page.keyboard.press("Escape");
    release();
    await expect(row).toHaveCount(0);
    const siblingRow = page.getByTestId(`session-row-${sibling.id}`).filter({ visible: true });
    await expect(siblingRow).toBeVisible();
    await expect(siblingRow.getByRole("button", { name: /Surviving sibling/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await siblingRow.getByTestId("session-menu-trigger").click();
    await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
    await page.getByTestId("session-menu-archive").click();
    await expect(siblingRow).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Agent", exact: true }).filter({ visible: true }),
    ).toBeVisible();
  } catch (error) {
    await captureSessionFailure(page, info);
    throw error;
  } finally {
    release();
    await mock.cleanup();
  }
});

async function sessionMutationProbe(page: Page) {
  const readers = await loadSessionMessageReaders();
  const { ServerInfoStatusPayloadSchema } = await loadProtocolSchemas();
  let failType: string | null = null;
  let offline = false;
  let permissionsOverride: ServerInfoStatusPayload["permissions"] | null = null;
  let labelCreateOverride: boolean | null = null;
  function withOverrides(info: ServerInfoStatusPayload): ServerInfoStatusPayload {
    return {
      ...info,
      ...(permissionsOverride === null ? {} : { permissions: permissionsOverride }),
      ...(labelCreateOverride === null
        ? {}
        : { features: { ...info.features, workspaceLabelCreate: labelCreateOverride } }),
    };
  }
  const sockets = new Set<WebSocketRoute>();
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    if (offline) {
      void browser.close({ code: 1008, reason: "Offline for session card test" });
      return;
    }
    sockets.add(browser);
    const server = browser.connectToServer();
    browser.onMessage((frame) => {
      const message = readers.client(frame);
      if (
        message?.type === failType &&
        "requestId" in message &&
        typeof message.requestId === "string"
      ) {
        failType = null;
        browser.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: message.requestId,
                requestType: message.type,
                error: "Session operation rejected for test",
                code: "handler_error",
              },
            },
          }),
        );
        return;
      }
      server.send(frame);
    });
    server.onMessage((frame) => {
      const message = readers.server(frame);
      if (message?.type === "status") {
        const parsed = ServerInfoStatusPayloadSchema.safeParse(message.payload);
        if (parsed.success) {
          const payload = withOverrides(parsed.data);
          browser.send(JSON.stringify({ type: "session", message: { type: "status", payload } }));
          return;
        }
      }
      browser.send(frame);
    });
  });
  return {
    failNext(type: string) {
      failType = type;
    },
    readOnlyOnReconnect() {
      permissionsOverride = ["daemon.read", "workspace.read"];
    },
    oldLabelsOnReconnect() {
      labelCreateOverride = false;
    },
    disconnect() {
      offline = true;
      for (const socket of sockets)
        void socket.close({ code: 1008, reason: "Offline for session card test" });
    },
  };
}

test("session card failures keep drafts and assignments, and capability gates explain unavailable writes", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "session-card-failures-",
    title: "Editable session",
  });
  try {
    const probe = await sessionMutationProbe(page);
    await openAgentRoute(page, mock);
    const row = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
    const menu = async () => {
      await row.getByTestId("session-menu-trigger").click();
    };
    await menu();
    probe.failNext("update_agent_request");
    await page.getByTestId("session-menu-rename").click();
    const rename = page.getByTestId("session-rename");
    await rename.getByRole("textbox").fill("Retry rename");
    await page.getByTestId("session-rename-submit").click();
    await expect(rename).toContainText("Session operation rejected for test");
    await expect(rename.getByRole("textbox")).toHaveValue("Retry rename");
    await page.getByTestId("session-rename-submit").click();
    await expect(row).toContainText("Retry rename");
    await menu();
    probe.failNext("agent.context.mutate.request");
    await page.getByTestId("session-menu-pin").click();
    await expect(row.getByRole("alert")).toContainText("Session operation rejected for test");
    await menu();
    await expect(page.getByTestId("session-menu-pin")).toHaveText("Pin session");
    await page.getByTestId("session-menu-labels").click();
    await page.getByTestId("workspace-label-picker-create").click();
    await page.getByTestId("workspace-label-picker-create-name").fill("Retry label");
    probe.failNext("agent.context.mutate.request");
    await page.getByTestId("workspace-label-picker-create-submit").click();
    await expect(page.getByTestId("workspace-label-picker-error")).toContainText(
      "was created, but assignment failed",
    );
    await page.getByTestId("workspace-label-picker-create-submit").click();
    const label = page.getByTestId("workspace-label-picker-row-Retry label");
    await expect(label).toHaveAttribute("aria-checked", "true");
    probe.failNext("agent.context.mutate.request");
    await label.click();
    await expect(page.getByTestId("workspace-label-picker-error")).toContainText(
      "Session operation rejected for test",
    );
    await expect(label).toHaveAttribute("aria-checked", "true");
    await label.click();
    await expect(label).toHaveAttribute("aria-checked", "false");
    probe.oldLabelsOnReconnect();
    await page.reload({ waitUntil: "commit" });
    await menu();
    await page.getByTestId("session-menu-labels").click();
    await expect(page.getByTestId("workspace-label-picker-create")).toBeDisabled();
    await expect(page.getByText("Update the host to create labels", { exact: true })).toBeVisible();
    await label.click();
    await expect(label).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await menu();
    probe.failNext("clear_agent_attention");
    await page.getByTestId("session-menu-read").click();
    await expect(row.getByRole("alert")).toContainText("Session operation rejected for test");
    probe.readOnlyOnReconnect();
    await page.reload({ waitUntil: "commit" });
    await menu();
    for (const id of ["rename", "pin", "labels", "read", "archive"])
      await expect(page.getByTestId(`session-menu-${id}`)).toBeDisabled();
    await expect(row).toContainText("Read only");
    await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
    await page.screenshot({ path: info.outputPath("session-readonly-1200.png"), fullPage: true });
    await page.keyboard.press("Escape");
    probe.disconnect();
    await expect(row).toContainText("Host offline");
    await menu();
    for (const id of ["rename", "pin", "labels", "read", "archive"])
      await expect(page.getByTestId(`session-menu-${id}`)).toBeDisabled();
    await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
    await page.screenshot({ path: info.outputPath("session-offline-1200.png"), fullPage: true });
  } catch (error) {
    await captureSessionFailure(page, info);
    throw error;
  } finally {
    await mock.cleanup();
  }
});

test.describe("session card touch controls", () => {
  test.use({ viewport: { width: 390, height: 1000 }, hasTouch: true, isMobile: true });
  test("session card touch kebab exposes actions without a hover archive target", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "session-card-touch-",
      title: "Touch session",
    });
    try {
      await openAgentRoute(page, mock);
      await expect(
        page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const row = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
      await expect(row).toBeVisible();
      expect(
        await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches),
      ).toBe(false);
      await expect(row.getByTestId("session-hover-archive")).toHaveCount(0);
      await row.getByTestId("session-menu-trigger").tap();
      for (const id of ["rename", "pin", "labels", "read", "archive"])
        await expect(page.getByTestId(`session-menu-${id}`)).toBeInViewport({ ratio: 1 });
      await expectSessionMenuSettled(page.getByTestId("session-menu-archive"));
      await page.screenshot({
        path: info.outputPath("session-touch-menu-390.png"),
        fullPage: true,
      });
      await page.getByTestId("session-menu-pin").tap();
      await expect(
        page.getByTestId("session-pinned-section").getByTestId(`session-row-${mock.agentId}`),
      ).toBeVisible();
      await row.getByTestId("session-menu-trigger").tap();
      await page.getByTestId("session-menu-labels").tap();
      await page.getByTestId("workspace-label-picker-create").tap();
      await page.getByTestId("workspace-label-picker-create-name").fill("Touch review");
      await expectSessionMenuSettled(page.getByTestId("workspace-label-picker-create-submit"));
      await page.screenshot({
        path: info.outputPath("session-touch-label-create-390.png"),
        fullPage: true,
      });
      await page.getByTestId("workspace-label-picker-create-submit").tap();
      await expect(page.getByTestId("workspace-label-picker-row-Touch review")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    } catch (error) {
      await captureSessionFailure(page, info);
      throw error;
    } finally {
      await mock.cleanup();
    }
  });
});

test("session card authoritative archive survives a delayed RPC error and remains in History", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const mock = await seedMockAgentWorkspace({
    repoPrefix: "session-card-authority-",
    title: "Authoritative archived session",
    initialPrompt: "Keep this session in history",
  });
  try {
    const nonCurrent = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Noncurrent review and archive",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await mock.client.sendAgentMessage(nonCurrent.id, "Complete this work for review");
    await mock.client.waitForFinish(nonCurrent.id, 15_000);
    const sibling = await mock.client.createAgent({
      provider: "mock",
      cwd: mock.cwd,
      workspaceId: mock.workspaceId,
      title: "Authority surviving sibling",
      modeId: "load-test",
      model: "five-minute-stream",
    });
    const readers = await loadSessionMessageReaders();
    let captured = 0;
    let reject: () => void = () => {
      throw new Error("Missing archive request");
    };
    await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((frame) => {
        const request = readers.client(frame);
        if (request?.type === "archive_agent_request" && request.agentId === mock.agentId) {
          captured++;
          reject = () =>
            browser.send(
              JSON.stringify({
                type: "session",
                message: {
                  type: "rpc_error",
                  payload: {
                    requestId: request.requestId,
                    requestType: request.type,
                    error: "Archive response lost after server update",
                    code: "handler_error",
                  },
                },
              }),
            );
          return;
        }
        server.send(frame);
      });
      server.onMessage((frame) => browser.send(frame));
    });
    await openAgentRoute(page, mock);
    const row = page.getByTestId(`session-row-${mock.agentId}`).filter({ visible: true });
    const nonCurrentRow = page
      .getByTestId(`session-row-${nonCurrent.id}`)
      .filter({ visible: true });
    await expect(nonCurrentRow.getByTestId(`session-status-${nonCurrent.id}`)).toHaveAttribute(
      "aria-label",
      "Ready to review",
    );
    await nonCurrentRow.getByTestId("session-menu-trigger").click();
    await page.getByTestId("session-menu-read").click();
    await expect(nonCurrentRow.getByTestId(`session-status-${nonCurrent.id}`)).toHaveAttribute(
      "aria-label",
      "Done",
    );
    await expect(
      row.getByRole("button", { name: /Authoritative archived session/ }),
    ).toHaveAttribute("aria-selected", "true");
    await nonCurrentRow.getByTestId("session-menu-trigger").click();
    await page.getByTestId("session-menu-archive").click();
    await expect(nonCurrentRow).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: /Authoritative archived session/ }),
    ).toHaveAttribute("aria-selected", "true");
    await row.getByTestId("session-menu-trigger").click();
    await page.getByTestId("session-menu-archive").click();
    await expect.poll(() => captured).toBe(1);
    await expect(row).toBeVisible();
    await mock.client.archiveAgent(mock.agentId);
    await expect(row).toHaveCount(0);
    const siblingRow = page.getByTestId(`session-row-${sibling.id}`).filter({ visible: true });
    await expect(
      siblingRow.getByRole("button", { name: /Authority surviving sibling/ }),
    ).toHaveAttribute("aria-selected", "true");
    reject();
    await expect(
      page.getByText("Archive response lost after server update", { exact: true }),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "History", exact: true }).click();
    const historyRow = page.getByTestId(`agent-row-${getServerId()}-${mock.agentId}`);
    await expect(historyRow).toContainText("Authoritative archived session");
    await expect(historyRow).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: info.outputPath("session-authoritative-history-1200.png"),
      fullPage: true,
    });
  } catch (error) {
    await captureSessionFailure(page, info);
    throw error;
  } finally {
    await mock.cleanup();
  }
});
