import { openFilesPanel } from "../support/helpers/workspace-tabs";
import { waitForSettledPosition } from "../support/helpers/sheet-layout";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.use({ e2eDaemonEnvironment: { TGIT_TOKEN: "" } });

for (const width of [1200, 390]) {
  test(`session links span repositories, persist and can be removed at width ${width}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "session-mrs-",
      title: "Cross repository review",
    });
    try {
      await openAgentRoute(page, agent);
      await expect(page.getByTestId("message-input-root")).toBeVisible();
      await expect(page.getByTestId("agent-change-requests-toggle")).toHaveCount(0);
      await openFilesPanel(page);
      await page.getByTestId("session-directory-actions").filter({ visible: true }).click();
      const link = page.getByTestId("session-directory-link-change-request");
      await expect(link).toBeVisible();
      await waitForSettledPosition(link);
      await page.screenshot({ path: info.outputPath(`link-menu-${width}.png`) });
      await link.click();
      await expect(page.getByTestId("agent-change-requests-dialog")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "PR/MR URL" })).toBeVisible();
      await waitForSettledPosition(page.getByTestId("agent-change-requests-dialog"));
      await page.screenshot({ path: info.outputPath(`link-form-${width}.png`) });

      const input = page.getByRole("textbox", { name: "PR/MR URL" });
      await input.fill("https://git.woa.com/team/first/merge_requests/7?tab=changes#note_9");
      await page.getByTestId("agent-change-requests-add").click();
      await expect(page.getByRole("button", { name: "team/first !7", exact: true })).toBeVisible();
      await input.fill("https://git.woa.com/another/second/merge_requests/8");
      await page.getByTestId("agent-change-requests-add").click();
      await expect(
        page.getByRole("button", { name: "another/second !8", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Sign in to this forge", { exact: false }).first()).toBeVisible();
      await page.getByRole("switch", { name: "Add automatically" }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("agent-change-requests-dialog")).toBeHidden();
      await page.reload({ waitUntil: "domcontentloaded" });
      await openFilesPanel(page);
      await page.getByTestId("session-directory-actions").filter({ visible: true }).click();
      await link.click();
      await expect(page.getByRole("button", { name: "team/first !7", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "another/second !8", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("switch", { name: "Add automatically" })).not.toBeChecked();
      const screenshot = info.outputPath(`session-mrs-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach(`session links ${width}`, { path: screenshot, contentType: "image/png" });
      await page.getByRole("button", { name: "Remove team/first !7", exact: true }).click();
      await expect(page.getByRole("button", { name: "team/first !7", exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "another/second !8", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Remove another/second !8", exact: true }).click();
      await expect(page.getByTestId("agent-change-requests-toggle")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByTestId("session-directory-actions").filter({ visible: true }).click();
      await link.click();
      await expect(page.getByRole("textbox", { name: "PR/MR URL" })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Add automatically" })).not.toBeChecked();
    } finally {
      await agent.cleanup();
    }
  });
}
