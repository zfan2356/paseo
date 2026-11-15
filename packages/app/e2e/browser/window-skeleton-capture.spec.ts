import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openAttachmentMenu } from "../support/helpers/composer";
import { openChangesPanel, openFilesPanel } from "../support/helpers/workspace-tabs";

// Screenshot evidence for docs/design.md and the polish inventory. Opt-in:
// E2E_SKELETON_CAPTURE=1 E2E_SKELETON_OUT=<dir> npx playwright test window-skeleton-capture
const OUT = process.env.E2E_SKELETON_OUT ?? "";
const PLATFORMS = ["web", "mac"] as const;
const SCHEMES = ["light", "dark"] as const;
const WIDTHS = [1440, 390] as const;

async function simulateMac(page: Page, wallpaper: string) {
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
  // Stands in for the desktop behind a vibrant window: a blurred wallpaper under a transparent body.
  const encoded = Buffer.from(wallpaper).toString("base64");
  await page.addInitScript((data) => {
    const install = () => {
      const style = document.createElement("style");
      style.textContent = `body { isolation: isolate; background: transparent !important; } body::before { content: ""; position: fixed; inset: -40px; z-index: -1; filter: blur(32px); background: url("data:image/svg+xml;base64,${data}") left center / cover fixed; }`;
      document.head.append(style);
    };
    if (document.head) install();
    else document.addEventListener("DOMContentLoaded", install);
  }, encoded);
}

// Wide-only scenes: collapsed sidebar, focus mode (web) and Reduce Transparency.
async function captureWideScenes(
  page: Page,
  platform: (typeof PLATFORMS)[number],
  scheme: (typeof SCHEMES)[number],
  shot: (scene: string) => string,
) {
  const toggle = page.getByTestId("menu-button").filter({ visible: true }).first();
  await toggle.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("sidebar-collapsed") });
  await page.getByTestId("menu-button").filter({ visible: true }).first().click();
  await page.waitForTimeout(600);
  if (platform === "web") {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+Shift+F");
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot("focus-mode") });
    await page.getByRole("button", { name: "Exit focus mode" }).click();
    await page.waitForTimeout(600);
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: scheme },
      { name: "prefers-reduced-transparency", value: "reduce" },
    ],
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("reduced-transparency") });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
  await cdp.detach();
  await page.emulateMedia({ colorScheme: scheme });
}

async function settle(page: Page, scheme: string) {
  await page.evaluate(
    (theme) =>
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme, chatDisplay: "full" })),
    scheme,
  );
  await page.reload();
  await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
  await page.waitForTimeout(600);
}

test.describe("window skeleton capture", () => {
  test.skip(process.env.E2E_SKELETON_CAPTURE !== "1", "Explicit screenshot capture");
  test.setTimeout(900_000);

  for (const platform of PLATFORMS) {
    test(`skeleton scenes (${platform})`, async ({ page }) => {
      const out = path.join(OUT, "skeleton");
      await mkdir(out, { recursive: true });
      if (platform === "mac") {
        const wallpaper = await readFile("../../docs/qa-evidence/materials/wallpaper.svg", "utf8");
        await simulateMac(page, wallpaper);
      }
      const session = await seedMockAgentWorkspace({
        repoPrefix: "skeleton-",
        title: "Refine the window skeleton",
        initialPrompt: "Explain how the sidebar and the main panel separate.",
        featureValues: {
          mockAssistantResponse:
            "The sidebar material fills the window. The main area floats on it as a rounded panel.\n\n".repeat(
              24,
            ),
        },
      });
      try {
        await session.client.waitForFinish(session.agentId, 30_000);
        for (const scheme of SCHEMES) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width: 1440, height: 900 });
          await openAgentRoute(page, session);
          await settle(page, scheme);
          for (const width of WIDTHS) {
            const name = (scene: string) =>
              path.join(out, `${platform}-${scheme}-${width}-${scene}.png`);
            await page.setViewportSize({ width, height: 900 });
            await page.waitForTimeout(600);
            await page.screenshot({ path: name("conversation") });
            await openAttachmentMenu(page);
            await page.waitForTimeout(400);
            await page.screenshot({ path: name("menu") });
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.keyboard.press("Shift+?");
            await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
            await page.waitForTimeout(400);
            await page.screenshot({ path: name("dialog") });
            await page.keyboard.press("Escape");
            await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeHidden();
            if (width === 1440) await captureWideScenes(page, platform, scheme, name);
          }
        }
      } finally {
        await session.cleanup();
      }
    });
  }

  test("polish walkthrough", async ({ page }) => {
    const out = path.join(OUT, "polish");
    await mkdir(out, { recursive: true });
    const session = await seedMockAgentWorkspace({
      repoPrefix: "polish-",
      title: "Polish walkthrough",
      initialPrompt: "Walk through the surfaces",
      featureValues: { mockAssistantResponse: "A paragraph for scrolling.\n\n".repeat(30) },
      repo: { withRemote: true, files: [{ path: ".gitignore", content: "/remote.git/\n" }] },
    });
    const shots: Record<string, string> = {};
    const shoot = async (key: string) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `${key}.png`) });
      shots[key] = page.url();
    };
    try {
      await writeFile(path.join(session.cwd, "README.md"), "# Temp Repo\nexport const one = 1;\n");
      await session.client.checkoutRefresh(session.cwd);
      await session.client.waitForFinish(session.agentId, 30_000);
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openAgentRoute(page, session);
        await settle(page, scheme);
        await shoot(`${scheme}-conversation`);
        if (scheme === "dark") continue;
        await openChangesPanel(page);
        await shoot("light-diff");
        await openFilesPanel(page);
        await shoot("light-files");
        const actions = page.getByTestId("session-directory-actions").filter({ visible: true });
        if (await actions.count()) {
          await actions.first().click();
          await shoot("light-directory-menu");
          await page.keyboard.press("Escape");
        }
        await page.getByTestId("sidebar-search").filter({ visible: true }).first().click();
        await expect(page.getByTestId("command-center-panel")).toBeVisible({ timeout: 30_000 });
        await shoot("light-command-center");
        await page.keyboard.press("Escape");
        for (const route of ["/new", "/sessions", "/schedules", "/settings"]) {
          await page.goto(route);
          await page.waitForTimeout(2_500);
          await shoot(`light-route${route.replace(/\//g, "-")}`);
        }
        await page.setViewportSize({ width: 390, height: 900 });
        await openAgentRoute(page, session);
        await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
          timeout: 60_000,
        });
        await shoot("light-390-conversation");
      }
      await writeFile(path.join(out, "routes.json"), JSON.stringify(shots, null, 2));
    } finally {
      await session.cleanup();
    }
  });
});
