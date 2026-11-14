const fs = require("fs");
const p = "packages/app/e2e/browser/sidebar-model-b.spec.ts";
let s = fs.readFileSync(p, "utf8");
const start = s.indexOf(
  '      await firstRow.getByRole("button", { name: "Expand session directories" })',
);
const end = s.indexOf("      // The composer can be behind", start);
s =
  s.slice(0, start) +
  `      if (width === 390) await page.getByTestId("sidebar-close").click();
      const { openFilesPanel } = await import("../support/helpers/workspace-tabs");
      await openFilesPanel(page);
      const actions = page.getByTestId("session-directory-actions").filter({ visible: true });
      await actions.click();
      await page.getByRole("menuitem", { name: "+ Bind directory", exact: true }).click();
      await page.getByTestId("session-directory-path").fill(\x60\x24{notes.path}/missing\x60);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("session-directory-field-error")).toContainText(/does not exist|not found|ENOENT/i);
      await page.getByTestId("session-directory-path").fill(notes.path);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("bind-session-directory")).not.toBeVisible();
      await actions.click();
      await page.getByRole("menuitem", { name: "+ Bind directory", exact: true }).click();
      await page.getByTestId("session-directory-path").fill(other.path);
      await page.getByTestId("bind-session-directory-submit").click();
      await expect(page.getByTestId("bind-session-directory")).not.toBeVisible();
      expect((await mock.client.getSessionContext(second.id)).context.linkedDirectories).toEqual([]);
      await page.getByTestId("session-directory-select").filter({ visible: true }).click();
      await expect(page.getByRole("menuitem", { name: other.path, exact: true })).toBeVisible();
      await page.getByRole("menuitem", { name: notes.path, exact: true }).click();
      await expect(page.getByTestId("file-explorer-tree-scroll").filter({ visible: true })).toContainText("README.md");
      const screenshot = info.outputPath(\x60session-directories-\x24{width}.png\x60);
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach(\x60session directories \x24{width}\x60, { path: screenshot, contentType: "image/png" });
` +
  s.slice(end);
s = s.replace(
  "session tree keeps shared-workspace sessions and explicit directories",
  "session panels keep shared-workspace sessions and explicit directories",
);
const a = s.indexOf(
  "    const row = page.getByTestId(`session-row-${agent.id}`)",
  s.indexOf('test("session tree keeps a non-Git'),
);
const b = s.indexOf("  } finally {", a);
s =
  s.slice(0, a) +
  `    const { openFilesPanel } = await import("../support/helpers/workspace-tabs");
    await openFilesPanel(page);
    const selector = page.getByTestId("session-directory-select").filter({ visible: true });
    await selector.click();
    await expect(page.getByRole("menuitem", { name: new RegExp("Launch") })).toBeVisible();
    await page.getByRole("menuitem", { name: expired.path, exact: true }).click();
    await expect(page.getByTestId("file-explorer-error-banner").filter({ visible: true })).toBeVisible();
    await page.getByTestId("session-directory-actions").filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "Remove binding", exact: true }).click();
    await expect.poll(async () => (await launch.client.getSessionContext(agent.id)).context.linkedDirectories.length).toBe(0);
    await expect(page.getByTestId("file-explorer-tree-scroll").filter({ visible: true })).toContainText("README.md");
` +
  s.slice(b);
s = s.replace(
  "session tree keeps a non-Git launch directory and reports an expired binding",
  "session panels keep a non-Git launch directory and report an expired binding",
);
s = s.replace(
  '    await page.getByTestId("directory-terminal-resources").filter({ visible: true }).click();',
  "    await openDirectoryResources(page);",
);
const c = s.indexOf(
  "    const row = page.getByTestId(`session-row-${mock.agentId}`)",
  s.indexOf('test("session tree resolves nested'),
);
const d = s.indexOf("    await expect(page.getByText(`Checkout:", c);
s =
  s.slice(0, c) +
  `    const { openChangesPanel } = await import("../support/helpers/workspace-tabs");
    await openChangesPanel(page);
    await page.getByTestId("session-directory-select").filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: binding, exact: true }).click();
` +
  s.slice(d);
s = s.replace(
  "session tree resolves nested directory changes",
  "session panels resolve nested directory changes",
);
s = s.replace(
  "restores nine pins and swaps complete lists",
  "restores nine pins across both session groupings",
);
const e = s.indexOf(
  "      await openDirectoryResources(page);",
  s.indexOf('test("session navigation restores nine pins'),
);
const f = s.indexOf('      await expect(page.getByTestId("composer-execution-directory")', e);
s =
  s.slice(0, e) +
  `      await page.getByTestId("session-group-by-directory").filter({ visible: true }).click();
      await expect(pins.locator('[data-testid^="session-row-"]')).toHaveCount(9);
      await expect(sidebar.locator('[data-testid^="session-row-"]')).toHaveCount(15);
      const directoryGroup = sidebar.locator('[data-testid^="session-group-"]').filter({ has: page.getByTestId(\x60session-row-\x24{ordinary.id}\x60) });
      await expect(directoryGroup.locator('[data-testid^="session-row-"]')).toHaveCount(1);
      await page.getByTestId("session-group-by-project").filter({ visible: true }).click();
` +
  s.slice(f);
s = s.replace(
  "      const openingBounds = await sidebar.boundingBox();",
  '      await page.getByTestId("session-group-by-project").filter({ visible: true }).click();\n      const openingBounds = await sidebar.boundingBox();',
);
fs.writeFileSync(p, s);
