import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { getServerId } from "../support/helpers/server-id";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openAttachmentMenu } from "../support/helpers/composer";
import { openChangesPanel } from "../support/helpers/workspace-tabs";

// Pixel comparison of the material layer between two revisions; see docs/fork/SYNC.md.
// Run once with --update-snapshots on the baseline revision, then without it on the candidate.
const PLATFORMS = ["darwin", "web"] as const;
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1440, 390] as const;
const STABLE_NAME = "material-visual";

async function forceElectronMac(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { paseoDesktop: unknown }).paseoDesktop = {
      platform: "darwin",
      events: { on: () => () => {} },
      invoke: async (command: string) =>
        command === "get_desktop_settings"
          ? {
              releaseChannel: "stable",
              daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
            }
          : null,
    };
  });
}

// Temp repo names are random; rewrite them so both revisions render identical text.
async function stabilizeNames(page: Page, randomName: string) {
  await page.evaluate(
    ({ from, to }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to);
      }
    },
    { from: randomName, to: STABLE_NAME },
  );
}

for (const platform of PLATFORMS) {
  for (const theme of THEMES) {
    test(`material visual matrix (${platform}, ${theme})`, async ({ page }) => {
      test.skip(process.env.MATERIALS_VISUAL !== "1", "Explicit before/after visual comparison");
      test.setTimeout(300_000);
      if (platform === "darwin") await forceElectronMac(page);
      const session = await seedMockAgentWorkspace({
        repoPrefix: "material-visual-",
        title: "Refine workspace surfaces",
        initialPrompt: "Review the workspace surfaces.",
        featureValues: {
          mockAssistantResponse: Array.from(
            { length: 12 },
            (_, index) =>
              `## ${index + 1}. Surfaces\n\nKeep the colors, typography and spacing consistent.\n\n| Detail | Direction |\n| --- | --- |\n| Palette | Teal, amber |\n`,
          ).join("\n"),
        },
        repo: { withRemote: true, files: [{ path: ".gitignore", content: "/remote.git/\n" }] },
      });
      const randomName = path.basename(session.cwd);
      const row = page
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${session.workspaceId}`)
        .filter({ visible: true });
      const shot = async (name: string) => {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await stabilizeNames(page, randomName);
        await page.evaluate(() => {
          if (document.querySelector("[data-visual-mask]")) return;
          const badge = document.createElement("div");
          badge.dataset.visualMask = "badge";
          badge.style.cssText =
            "position:fixed;left:0;bottom:0;width:60px;height:60px;pointer-events:none";
          document.body.append(badge);
        });
        await expect(page).toHaveScreenshot(`${platform}-${theme}-${name}.png`, {
          animations: "disabled",
          caret: "hide",
          maxDiffPixels: 0,
          // The project avatar color derives from the random repo name, and the Expo dev
          // server flashes a refresh badge in the bottom-left corner after load.
          mask: [
            page.locator(
              '[data-testid^="project-status-indicator"], [data-testid="project-icon-only"]',
            ),
            page.locator("[data-visual-mask]"),
          ],
        });
      };
      try {
        // A working-tree change puts the diff-stat pill over the transcript and fills the diff pane.
        await writeFile(
          path.join(session.cwd, "README.md"),
          "# Temp Repo\nexport const one = 1;\n",
        );
        await session.client.checkoutRefresh(session.cwd);
        await session.client.waitForFinish(session.agentId, 30_000);
        await page.emulateMedia({ colorScheme: theme });
        await openAgentRoute(page, session);
        await page.evaluate(
          (value) =>
            localStorage.setItem(
              "@paseo:app-settings",
              JSON.stringify({ theme: value, chatDisplay: "full" }),
            ),
          theme,
        );
        await page.reload();
        await expect(page.getByTestId("message-input-root").first()).toBeVisible({
          timeout: 60_000,
        });
        await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(600);
          const scroll = page.getByTestId("agent-chat-scroll").filter({ visible: true });
          await scroll.evaluate((el) => {
            el.scrollTop = el.scrollHeight * 0.4;
          });
          await shot(`${width}-conversation`);

          await openAttachmentMenu(page);
          await shot(`${width}-menu`);
          await page.keyboard.press("Escape");

          await page.mouse.click(width - 25, 220);
          await page.keyboard.press("Shift+?");
          await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
          await shot(`${width}-dialog`);
          await page.keyboard.press("Escape");
          await expect(page.getByTestId("keyboard-shortcuts-dialog")).toHaveCount(0);

          if (width === 1440) {
            await row.click({ button: "right" });
            await expect(
              page.getByTestId(
                `sidebar-workspace-menu-pin-${getServerId()}:${session.workspaceId}`,
              ),
            ).toBeVisible();
            await shot(`${width}-sidebar`);
            await page.keyboard.press("Escape");
          } else {
            await page.getByRole("button", { name: "Open menu", exact: true }).click();
            await expect(row).toBeVisible();
            await shot(`${width}-sidebar`);
            await page.getByTestId("sidebar-close").click();
          }
        }

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(600);
        const sidebarToggle = page.getByTestId("menu-button").filter({ visible: true }).first();
        await sidebarToggle.click();
        await expect(row).toHaveCount(0);
        await shot("1440-sidebar-collapsed");
        await sidebarToggle.click();
        await expect(row).toBeVisible();

        await openChangesPanel(page);
        await shot("1440-diff");
        await page.getByTestId("session-directory-actions").filter({ visible: true }).click();
        await expect(page.getByRole("menuitem").first()).toBeVisible();
        await shot("1440-directory-menu");
        await page.keyboard.press("Escape");
      } finally {
        await session.cleanup();
      }
    });
  }
}
