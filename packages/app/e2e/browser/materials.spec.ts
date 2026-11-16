import { getServerId } from "../support/helpers/server-id";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openAttachmentMenu } from "../support/helpers/composer";
import {
  ensureExplorerSidebar,
  openChangesPanel,
  openFilesPanel,
} from "../support/helpers/workspace-tabs";
import { openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";

for (const scenario of [
  {
    theme: "codex",
    system: "light",
    background: "rgb(23, 30, 27)",
    foreground: "rgb(250, 250, 250)",
  },
  {
    theme: "light",
    system: "dark",
    background: "rgb(247, 249, 246)",
    foreground: "rgb(26, 26, 30)",
  },
] as const) {
  test(`materials follow saved ${scenario.theme} on a ${scenario.system} system`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript((theme) => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme }));
    }, scenario.theme);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "material-theme-",
      title: "Readable theme",
      initialPrompt: "Check the theme.",
      featureValues: { mockAssistantResponse: "The conversation remains readable." },
    });
    try {
      await session.client.waitForFinish(session.agentId, 30_000);
      await openAgentRoute(page, session);
      await expect(page.getByTestId("message-input-root")).toBeVisible();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('[data-material="transcript"]:visible')).toHaveCSS(
          "background-color",
          scenario.background,
        );
        await expect(
          page.getByText("The conversation remains readable.", { exact: true }),
        ).toHaveCSS("color", scenario.foreground);
        await page.screenshot({ path: testInfo.outputPath(`saved-theme-${width}.png`) });
      }
    } finally {
      await session.cleanup();
    }
  });
}

test("materials follow theme changes without reloading", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  await openSettingsSection(page, "appearance");
  const window = page.getByTestId("wide-shell");
  await expect(window).toHaveCSS("background-color", "rgb(247, 249, 246)");

  await page.getByRole("radio", { name: "Codex", exact: true }).click();
  await expect(window).toHaveCSS("background-color", "rgb(23, 30, 27)");
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(window).toHaveCSS("background-color", "rgb(247, 249, 246)");

  await page.getByRole("radio", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(window).toHaveCSS("background-color", "rgb(23, 30, 27)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(window).toHaveCSS("background-color", "rgb(247, 249, 246)");
  await expect(page.locator("style[data-material-styles]")).toHaveCount(1);
});

// Real renderer/daemon coverage and raw scroll samples for default materials.
test("default material evidence", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_PERFORMANCE !== "1", "Explicit visual/performance evidence capture");
  test.setTimeout(480_000);
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  const out = testInfo.outputPath("materials") + "/";
  await mkdir(out, { recursive: true });
  const browser = page.context().browser();
  if (!browser) throw new Error("Chromium is required for material evidence");
  const browserCdp = await browser.newBrowserCDPSession();
  const { gpu } = await browserCdp.send("SystemInfo.getInfo");
  expect(gpu.featureStatus?.gpu_compositing).toBe("enabled");
  const os = await import("node:os");
  await writeFile(
    `${out}environment.json`,
    JSON.stringify(
      {
        os: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        logicalCpus: os.cpus().length,
        browser: browser.version(),
        gpu,
      },
      null,
      2,
    ),
  );
  await browserCdp.detach();
  const wallpaper = await readFile("../../docs/qa-evidence/materials/wallpaper.svg", "utf8");
  await page.route("https://material-study.test/wallpaper.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: wallpaper }),
  );
  const source = Array.from(
    { length: 18 },
    (_, index) =>
      `## ${index + 1}. A quieter place to work\n\nReview the coastal illustration and the next set of changes. Keep the colors, typography and spacing consistent across the workspace.\n\n![Coastal illustration](https://material-study.test/wallpaper.svg)\n\nThe warm sky and cool water stay distinct. **Preserve the contrast** as the content moves beneath the controls.\n\n| Detail | Direction |\n| --- | --- |\n| Palette | Teal, amber, slate |\n| Composition | Space to read and act |\n\n`,
  ).join("\n\n");
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-study-",
    title: "Refine workspace surfaces",
    initialPrompt: "Review the workspace surfaces and explain the implementation.",
    featureValues: { mockAssistantResponse: source },
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    const paintEvidence = [];
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openAgentRoute(page, session);
      await page.evaluate(
        (theme) =>
          localStorage.setItem(
            "@paseo:app-settings",
            JSON.stringify({ theme, chatDisplay: "full" }),
          ),
        scheme,
      );
      await page.reload();
      await expect(page.getByTestId("message-input-root")).toBeVisible({ timeout: 60_000 });
      await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
      await expect(page.getByTestId("agent-change-requests-toggle")).toHaveCount(0);
      const input = page.getByRole("textbox", { name: "Message agent..." }).first();
      await input.fill("Keep the transcript crisp; soften only the floating surfaces.");
      await input.blur();
      await page.addStyleTag({
        content: `body { isolation: isolate; background: transparent; } body::before { content: ""; position: fixed; inset: -40px; z-index: -1; filter: blur(32px); background: url("data:image/svg+xml;base64,${Buffer.from(wallpaper).toString("base64")}") left center / cover fixed; }`,
      });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(500);
        const scroll = page.getByTestId("agent-chat-scroll").filter({ visible: true });
        await scroll.hover();
        await page.mouse.wheel(0, -1400);
        await page.waitForTimeout(400);
        await scroll.evaluate((el) => {
          el.scrollTop = el.scrollHeight * 0.45 + 60;
        });
        await page.waitForTimeout(400);
        const jump = page.getByTestId("scroll-to-bottom-button").filter({ visible: true });
        await expect(jump).toBeVisible();
        await jump.click({ trial: true });
        const jumpBounds = await jump.boundingBox();
        const composerBounds = await page
          .locator('[data-material="composer"]:visible')
          .first()
          .boundingBox();
        if (!jumpBounds || !composerBounds) throw new Error("Missing timeline controls");
        expect(jumpBounds.y + jumpBounds.height).toBeLessThan(composerBounds.y);
        const scrollTop = await scroll.evaluate((el) => el.scrollTop);
        const capture = async (scene: string) => {
          for (const mode of ["default"]) {
            await page.waitForTimeout(350);
            await scroll.evaluate((el, top) => {
              el.scrollTop = top;
            }, scrollTop);
            const blur = await page
              .locator('[data-material="composer"]:visible')
              .first()
              .evaluate((el) => getComputedStyle(el).backdropFilter);
            expect(blur).toBe("blur(20px) saturate(1.3)");
            if (scene === "conversation" && width === 1440 && mode === "default") {
              const overlap = await page.evaluate(() => {
                const rectangles = Array.from(
                  document.querySelectorAll('[data-testid="agent-chat-scroll"] img'),
                ).map((image) => image.getBoundingClientRect());
                const matches = [];
                for (const role of ["chrome", "composer"]) {
                  const surface = document
                    .querySelector(`[data-material="${role}"]`)
                    ?.getBoundingClientRect();
                  matches.push(
                    Boolean(
                      surface &&
                      rectangles.some(
                        (rect) =>
                          Math.min(rect.bottom, surface.bottom) - Math.max(rect.top, surface.top) >
                          15,
                      ),
                    ),
                  );
                }
                return matches;
              });
              expect(overlap).toEqual([true, true]);
            }
            if (width === 1440 && mode === "default") {
              const roles =
                scene === "conversation" ? ["chrome", "composer", "secondary", "banner"] : [scene];
              for (const role of roles) {
                const surface = page.locator(`[data-material="${role}"]:visible`).first();
                if (await surface.count())
                  await captureSurface(page, surface, `${out}detail-${scheme}-${role}-${mode}.png`);
              }
            }
            await page.screenshot({ path: `${out}${scheme}-${width}-${scene}-${mode}.png` });
          }
        };
        await capture("conversation");

        paintEvidence.push({
          scheme,
          width,
          ancestors: await page
            .locator('[data-material="composer"]:visible')
            .first()
            .evaluate((element) => {
              const rows = [];
              for (let node: Element | null = element; node; node = node.parentElement) {
                const css = getComputedStyle(node);
                rows.push({
                  tag: node.tagName,
                  material: node.getAttribute("data-material"),
                  background: css.backgroundColor,
                  opacity: css.opacity,
                  filter: css.filter,
                  backdropFilter: css.backdropFilter,
                  isolation: css.isolation,
                  mask: css.maskImage,
                  willChange: css.willChange,
                  contain: css.contain,
                });
              }
              return rows;
            }),
        });
        await openAttachmentMenu(page);
        await page.waitForTimeout(500);
        await capture("menu");
        await page.keyboard.press("Escape");
        await page.mouse.click(width - 25, 220);
        await page.keyboard.press("Shift+?");
        await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
        await page.waitForTimeout(500);
        await capture("dialog");
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-color-scheme", value: scheme },
            { name: "prefers-reduced-transparency", value: "reduce" },
          ],
        });
        expect(
          await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches),
        ).toBe(true);
        await expect(page.locator('[data-material="composer"]:visible').first()).toHaveCSS(
          "backdrop-filter",
          "none",
        );
        await expect(
          page.locator('[data-material="dialog"]:visible, [data-material="sheet"]:visible').first(),
        ).toHaveCSS("backdrop-filter", "none");
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}${scheme}-${width}-reduced-transparency.png` });
        await cdp.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: scheme }],
        });
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeHidden();
        await cdp.detach();
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(350);
        await jump.click();
        await expect(jump).toHaveCount(0);
        await expect
          .poll(() =>
            scroll.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)),
          )
          .toBeLessThan(2);
      }
    }
    await writeFile(`${out}paint.json`, JSON.stringify(paintEvidence, null, 2));
    await page.setViewportSize({ width: 1440, height: 1000 });
    const perf = [];
    for (const strength of ["default"]) {
      for (let trial = 0; trial < 3; trial++) {
        for (const blur of trial % 2 ? [true, false] : [false, true]) {
          const override = blur
            ? null
            : await page.addStyleTag({
                content: "[data-material] { backdrop-filter: none !important; }",
              });
          const feed = page.getByTestId("agent-chat-scroll").filter({ visible: true });
          await feed.hover();
          await page.mouse.wheel(0, -400);
          await page.waitForTimeout(200);
          const sample = await page
            .getByTestId("agent-chat-scroll")
            .filter({ visible: true })
            .evaluate(async (element) => {
              const frames: number[] = [];
              const writes: number[] = [];
              const positions: number[] = [];
              const composer = document.querySelector('[data-material="composer"]');
              const effectiveFilter = composer
                ? getComputedStyle(composer).backdropFilter
                : "missing";
              element.scrollTop = element.scrollHeight * 0.3;
              let previous = await new Promise<number>(requestAnimationFrame);
              for (let i = 0; i < 180; i++) {
                const now = await new Promise<number>(requestAnimationFrame);
                positions.push(element.scrollTop);
                const start = performance.now();
                element.scrollTop += i < 90 ? 12 : -12;
                writes.push(performance.now() - start);
                if (i >= 30) frames.push(now - previous);
                previous = now;
              }
              return {
                frames,
                writes,
                positions,
                effectiveFilter,
                scrollHeight: element.scrollHeight,
                viewportHeight: element.clientHeight,
                nodes: document.querySelectorAll("*").length,
              };
            });
          expect(new Set(sample.positions).size).toBeGreaterThan(60);
          expect(sample.effectiveFilter.startsWith("blur(")).toBe(blur);
          perf.push({ strength, trial, blur, ...sample });
          await override?.evaluate((element) => element.parentNode?.removeChild(element));
        }
      }
    }
    await writeFile(
      `${out}frames.json`,
      JSON.stringify(
        {
          browser: page.context().browser()?.version(),
          viewport: { width: 1440, height: 1000 },
          sections: 18,
          characters: source.length,
          samples: perf,
        },
        null,
        2,
      ),
    );

    await testInfo.attach("materials", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await session.cleanup();
  }
});

test("floating inventory captures", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_PERFORMANCE !== "1", "Explicit visual evidence capture");
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);
  const { writeFile, readFile } = await import("node:fs/promises");
  const out = testInfo.outputPath("materials") + "/";
  await (await import("node:fs/promises")).mkdir(out, { recursive: true });
  const wallpaper = await readFile("../../docs/qa-evidence/materials/wallpaper.svg", "utf8");
  await page.route("https://material-study.test/wallpaper.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: wallpaper }),
  );
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "floating-study-",
    title: "Surface inventory",
    initialPrompt: "Show the coastal study",
    featureValues: {
      mockAssistantResponse:
        "# Coastal study\n\n![Coast](https://material-study.test/wallpaper.svg)\n\nKeep temporary controls distinct from the work beneath them.",
    },
  });
  await writeFile(session.cwd + "/material-notes.md", "Coastal study notes\n");
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ["light", "dark"] as const) {
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
      await expect(page.getByTestId("message-input-root")).toBeVisible({ timeout: 60_000 });

      const shoot = async (name: string, selector: string, prepare?: () => Promise<void>) => {
        for (const mode of ["default"]) {
          if (prepare) await prepare();
          const surface = page.locator(selector).filter({ visible: true }).first();
          await expect(surface).toBeVisible({ timeout: 10_000 });
          await page.waitForTimeout(250);
          await captureSurface(page, surface, `${out}floating-${theme}-${name}-${mode}.png`);
        }
      };
      const attach = page
        .getByTestId("message-input-attach-button")
        .filter({ visible: true })
        .first();
      await shoot("tooltip", '[role="tooltip"]', () => attach.hover());
      await page.mouse.move(700, 400);
      const meter = page.getByTestId("context-window-meter").filter({ visible: true }).first();
      await shoot("hover-card", '[data-testid="context-window-details"]', () => meter.hover());
      await page.mouse.move(700, 400);
      await page.waitForTimeout(400);
      await page.getByTestId("sidebar-hosts-trigger").filter({ visible: true }).first().click();
      await shoot("combobox", '[data-testid="combobox-desktop-container"]');
      await page.keyboard.press("Escape");
      const input = page.getByRole("textbox", { name: "Message agent..." }).first();
      await input.fill("@");
      await expect(page.getByTestId("composer-autocomplete-popover")).toBeVisible();
      await shoot("autocomplete", '[data-material="autocomplete"]');
      await input.fill("");
      await input.blur();
      await page.getByTestId(`workspace-tab-agent_${session.agentId}`).click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: /Copy agent id/ })).toBeVisible();
      await shoot("context-menu", '[data-material="menu"]');
      await page.getByRole("menuitem", { name: /Copy agent id/ }).click();
      await expect(page.getByTestId("app-toast-message")).toBeVisible();
      await page.getByTestId("app-toast-message").hover();
      await shoot("toast", '[data-material="toast"]');
      await page.mouse.move(700, 400);
      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("command-center-panel")).toBeVisible();
      await shoot("command-center", '[data-testid="command-center-panel"]');
      await page.keyboard.press("Escape");
      await page.locator('img[src*="material-study.test"]').first().click();
      await expect(page.locator('[data-material="fullscreen"]')).toBeVisible();
      await shoot("lightbox", '[data-material="fullscreen"]');
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByTestId("add-project-flow")).toBeVisible();
      await shoot("add-project", '[data-testid^="add-project-flow-page-"]');
      await page.getByTestId("add-project-flow-backdrop").click({ position: { x: 5, y: 5 } });
    }
    await writeFile(
      `${out}floating-console.json`,
      JSON.stringify({ consoleErrors, pageErrors }, null, 2),
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await session.cleanup();
  }
});

async function captureSurface(page: Page, surface: Locator, path: string) {
  const rect = await surface.boundingBox();
  const viewport = page.viewportSize();
  if (!rect || !viewport) throw new Error("Visible surface and fixed viewport required");
  const x = Math.max(0, rect.x - 24);
  const y = Math.max(0, rect.y - 24);
  await page.screenshot({
    path,
    clip: {
      x,
      y,
      width: Math.min(viewport.width, rect.x + rect.width + 24) - x,
      height: Math.min(viewport.height, rect.y + rect.height + 24) - y,
    },
  });
}

test("sidebar material preserves status, pin, context menu and hover archive", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const out = testInfo.outputPath("materials");
  await (await import("node:fs/promises")).mkdir(out, { recursive: true });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-sidebar-",
    title: "Material session",
  });
  try {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openAgentRoute(page, session);
      await page.evaluate(
        (value) => localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: value })),
        theme,
      );
      await page.reload();
      const row = page
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${session.workspaceId}`)
        .filter({ visible: true });
      await expect(row).toBeVisible();
      await expect(row.getByTestId("workspace-status-indicator-done")).toBeVisible();
      await expect(row).toHaveCSS("min-height", "36px");
      await row.hover();
      await expect(
        row.getByTestId(`sidebar-workspace-archive-button-${getServerId()}:${session.workspaceId}`),
      ).toBeVisible();
      await expect(row).toHaveAttribute("aria-selected", "true");
      await row.click({ button: "right" });
      await expect(
        page.getByTestId(`sidebar-workspace-menu-pin-${getServerId()}:${session.workspaceId}`),
      ).toBeVisible();
      await page.screenshot({ path: `${out}/sidebar-${theme}-1440-context.png` });
      await page
        .getByTestId(`sidebar-workspace-menu-pin-${getServerId()}:${session.workspaceId}`)
        .click();
      await expect(
        page
          .getByTestId("sidebar-pinned-section")
          .getByTestId(`sidebar-workspace-row-${getServerId()}:${session.workspaceId}`),
      ).toBeVisible();
      await page.mouse.move(800, 400);
      await page.screenshot({ path: `${out}/sidebar-${theme}-1440-selected.png` });
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await expect(row).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/sidebar-${theme}-390-selected.png` });
      await page
        .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${session.workspaceId}`)
        .click();
      await expect(
        page.getByTestId(`sidebar-workspace-menu-pin-${getServerId()}:${session.workspaceId}`),
      ).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/sidebar-${theme}-390-menu.png` });
      await page
        .getByTestId(`sidebar-workspace-menu-pin-${getServerId()}:${session.workspaceId}`)
        .click();
      await expect(
        page
          .getByTestId("sidebar-pinned-section")
          .getByTestId(`sidebar-workspace-row-${getServerId()}:${session.workspaceId}`),
      ).toHaveCount(0);
      await page.getByTestId("sidebar-close").click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const row = page
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${session.workspaceId}`)
      .filter({ visible: true });
    await row.hover();
    await row
      .getByTestId(`sidebar-workspace-archive-button-${getServerId()}:${session.workspaceId}`)
      .click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () =>
        (await session.client.fetchWorkspaces()).entries.some(
          (workspace) => workspace.id === session.workspaceId,
        ),
      )
      .toBe(false);
  } finally {
    await session.cleanup();
  }
});

test("material header leaves terminal content below workspace chrome", async ({
  page,
}, testInfo) => {
  const { clickNewTerminal } = await import("../support/helpers/launcher");
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-terminal-",
    title: "Chrome geometry",
    initialPrompt: "Find the matching paragraph",
    featureValues: { mockAssistantResponse: "A material search target." },
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openAgentRoute(page, session);
    await session.client.waitForFinish(session.agentId, 30_000);
    await clickNewTerminal(page);
    const terminal = page.getByTestId("terminal-surface").filter({ visible: true }).first();
    await expect(terminal).toBeVisible();
    await expect
      .poll(async () => {
        const content = await terminal.boundingBox();
        const chrome = await page
          .locator('[data-material="chrome"], [data-material="chrome-static"]')
          .filter({ visible: true })
          .first()
          .boundingBox();
        if (!content || !chrome) throw new Error("Missing workspace frame");
        return content.y - (chrome.y + chrome.height);
      })
      .toBeGreaterThanOrEqual(0);
    const out = testInfo.outputPath("materials");
    await (await import("node:fs/promises")).mkdir(out, { recursive: true });
    await page.screenshot({ path: `${out}/terminal-after-fix.png` });
    await page
      .getByTestId(`workspace-tab-agent_${session.agentId}`)
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page.locator('[data-material="chrome"]').filter({ visible: true }).first(),
    ).toHaveCSS("position", "absolute");
    await page.getByTestId("assistant-message").filter({ visible: true }).last().click();
    await page.keyboard.press("ControlOrMeta+f");
    const find = page.getByRole("textbox", { name: "Find in pane", exact: true });
    await expect(find).toBeFocused();
    await find.fill("material");
    const widget = await page.locator('[data-chat-find-widget="true"]').boundingBox();
    const header = await page
      .locator('[data-material="chrome"]')
      .filter({ visible: true })
      .first()
      .boundingBox();
    if (!widget || !header) throw new Error("Missing find widget or header");
    expect(widget.y).toBeGreaterThanOrEqual(header.y + header.height);
    await find.click({ trial: true });
    await page.screenshot({ path: `${out}/chat-find-after-fix.png` });
  } finally {
    await session.cleanup();
  }
});

// The dock composer floats over the transcript, so the pill track must lift by the same clearance.
for (const platform of ["darwin", "web"] as const) {
  test(`composer pills stay above the floating composer (${platform})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const { writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    if (platform === "darwin") {
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
    const session = await seedMockAgentWorkspace({
      repoPrefix: "material-pills-",
      title: "Composer pills",
      initialPrompt: "Review the workspace",
      featureValues: { mockAssistantResponse: "A paragraph for scrolling.\n\n".repeat(60) },
      repo: { withRemote: true, files: [{ path: ".gitignore", content: "/remote.git/\n" }] },
    });
    try {
      await writeFile(path.join(session.cwd, "README.md"), "# Temp Repo\nexport const one = 1;\n");
      await session.client.checkoutRefresh(session.cwd);
      await session.client.waitForFinish(session.agentId, 30_000);
      await page.setViewportSize({ width: 1200, height: 900 });
      await openAgentRoute(page, session);
      const pill = page.getByTestId("composer-diff-stat-pill").filter({ visible: true });
      await expect(pill).toBeVisible({ timeout: 60_000 });
      await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
      const composer = page.locator('[data-material="composer"]:visible').first();
      await page.waitForTimeout(500);
      await page.screenshot({ path: testInfo.outputPath(`pills-${platform}.png`) });
      await expect
        .poll(
          async () => {
            const pillBox = await pill.boundingBox();
            const composerBox = await composer.boundingBox();
            if (!pillBox || !composerBox) return Number.NEGATIVE_INFINITY;
            return composerBox.y - (pillBox.y + pillBox.height);
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(0);
      const hit = await pill.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return Boolean(target && el.contains(target));
      });
      expect(hit).toBe(true);
      // Transcript text scrolls under the pill, so the pill takes the hint material:
      // a protected fill, a blur of what passes beneath, and the hint border and shadow.
      const material = await pill.evaluate((el) => {
        const style = getComputedStyle(el);
        return { blur: style.backdropFilter, shadow: style.boxShadow, fill: style.backgroundColor };
      });
      expect(material.blur).toContain("blur(8px)");
      expect(material.shadow).not.toBe("none");
      expect(material.fill).toMatch(/\/ 0\.96\)$/);
      // The shadow keeps the pill's radius: no clipping ancestor cuts it to the pill's box.
      // Reach of 0 4px 16px: 12px above, 16px to the sides, 20px below.
      const room = await pill.evaluate((el) => {
        const box = el.getBoundingClientRect();
        for (let node = el.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.overflowX === "visible" && style.overflowY === "visible") continue;
          const clip = node.getBoundingClientRect();
          return {
            top: Math.round(box.top - clip.top),
            left: Math.round(box.left - clip.left),
            bottom: Math.round(clip.bottom - box.bottom),
          };
        }
        return null;
      });
      expect(room?.top).toBeGreaterThanOrEqual(12);
      expect(room?.left).toBeGreaterThanOrEqual(16);
      expect(room?.bottom).toBeGreaterThanOrEqual(20);
      const pillBox = await pill.boundingBox();
      if (pillBox) {
        await page.screenshot({
          path: testInfo.outputPath(`pill-zoom-${platform}.png`),
          clip: { x: pillBox.x - 40, y: pillBox.y - 30, width: 240, height: 100 },
        });
      }
    } finally {
      await session.cleanup();
    }
  });
}

test("header icon sizing leaves the tab close scrim at full width", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-tab-scrim-",
    title: "A fairly long tab title for hover",
    initialPrompt: "hello",
    featureValues: { mockAssistantResponse: "ok" },
  });
  try {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openAgentRoute(page, session);
    const tab = page
      .getByTestId(`workspace-tab-agent_${session.agentId}`)
      .filter({ visible: true })
      .first();
    await expect(tab).toBeVisible({ timeout: 60_000 });
    await tab.hover();
    const close = page
      .getByTestId(`workspace-agent-close-${session.agentId}`)
      .filter({ visible: true })
      .first();
    await expect(close).toBeVisible();
    const sizes = await close.evaluate((button) => {
      const overlay = button.parentElement!;
      const scrim = overlay.querySelector("svg")!;
      const a = overlay.getBoundingClientRect();
      const b = scrim.getBoundingClientRect();
      return { overlay: [a.width, a.height], scrim: [b.width, b.height] };
    });
    expect(sizes.scrim).toEqual(sizes.overlay);
  } finally {
    await session.cleanup();
  }
});

// Window skeleton: the workspace panel is flush with the window's top, right and bottom edges and
// floats off the sidebar-material floor only beside the pinned sidebar, with no line between the
// two. See docs/fork/design-materials.md.
for (const platform of ["darwin", "web"] as const) {
  test(`window skeleton floats the workspace panel (${platform})`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    if (platform === "darwin") {
      await page.addInitScript(() => {
        (window as unknown as { paseoDesktop: unknown }).paseoDesktop = {
          platform: "darwin",
          events: { on: () => () => {} },
          invoke: async () => null,
        };
      });
    }
    const session = await seedMockAgentWorkspace({
      repoPrefix: "material-skeleton-",
      title: "Window skeleton",
      initialPrompt: "hello",
      featureValues: { mockAssistantResponse: "ok" },
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openAgentRoute(page, session);
      await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
      const panelGeometry = () =>
        page.evaluate(() => {
          const panel = document.querySelector('[data-material="panel"]');
          const frame = document.querySelector('[data-material="panel-frame"]');
          if (!panel || !frame) return null;
          const p = panel.getBoundingClientRect();
          const f = frame.getBoundingClientRect();
          const style = getComputedStyle(panel);
          return {
            left: Math.round(p.left - f.left),
            top: Math.round(p.top),
            bottom: Math.round(window.innerHeight - p.bottom),
            right: Math.round(window.innerWidth - p.right),
            radius: [style.borderTopLeftRadius, style.borderTopRightRadius],
            border: [style.borderLeftWidth, style.borderTopWidth],
            shadow: style.boxShadow !== "none",
            floor: getComputedStyle(frame).backgroundColor,
          };
        });
      const sidebarGeometry = () =>
        page.evaluate(() => {
          const sidebar = document.querySelector('[data-material="sidebar"]');
          const panel = document.querySelector('[data-material="panel"]');
          if (!sidebar || !panel) return null;
          const style = getComputedStyle(sidebar);
          return {
            gap: Math.round(
              panel.getBoundingClientRect().left - sidebar.getBoundingClientRect().right,
            ),
            rule: style.borderRightWidth,
            floor: style.backgroundColor,
          };
        });
      const floating = {
        left: 8,
        top: 0,
        bottom: 0,
        right: 0,
        radius: ["12px", "0px"],
        border: ["1px", "0px"],
        shadow: true,
      };
      const flush = {
        left: 0,
        top: 0,
        bottom: 0,
        right: 0,
        radius: ["0px", "0px"],
        border: ["0px", "0px"],
        shadow: false,
      };
      await expect.poll(panelGeometry).toMatchObject(floating);
      const floor = (await panelGeometry())?.floor;
      await expect.poll(sidebarGeometry).toEqual({ gap: 8, rule: "0px", floor });

      // Collapsed sidebar: the panel is flush on all four sides.
      await page.getByTestId("menu-button").filter({ visible: true }).first().click();
      await expect.poll(() => page.locator('[data-material="sidebar"]:visible').count()).toBe(0);
      await expect.poll(panelGeometry).toMatchObject(flush);
      await page.getByTestId("menu-button").filter({ visible: true }).first().click();
      await expect.poll(sidebarGeometry).toMatchObject({ gap: 8, rule: "0px" });

      if (platform === "web") {
        // Focus mode is content only: the workspace fills the window.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press("Control+Shift+F");
        await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
        await expect.poll(() => page.locator('[data-material="panel"]').count()).toBe(0);
        await page.getByRole("button", { name: "Exit focus mode" }).click();
        await expect.poll(panelGeometry).toMatchObject(floating);
      }

      // Off macOS the floor is opaque; on macOS it lets the window vibrancy through.
      // Reduce Transparency turns it opaque and keeps the geometry.
      const translucent = (color: string | undefined) => /\/\s*0?\.\d+\)$/.test(color ?? "");
      expect(translucent(floor)).toBe(platform === "darwin");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
      });
      await expect.poll(async () => translucent((await panelGeometry())?.floor)).toBe(false);
      await expect.poll(panelGeometry).toMatchObject(floating);
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });

      // Settings takes the same skeleton: navigation on the floor, the detail pane floating off it.
      await openSettings(page);
      await expect(page.getByTestId("settings-sidebar")).toBeVisible();
      const settingsSkeleton = () =>
        page.evaluate(() => {
          const sidebar = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"]');
          const frame = document.querySelector('[data-material="panel-frame"]');
          const detail = document.querySelector('[data-testid="settings-detail-pane"]');
          if (!sidebar || !frame || !detail) return null;
          // Every layer between the sidebar and the panel frame lets the floor through.
          const opaque: string[] = [];
          for (let node: HTMLElement | null = sidebar; node && node !== frame; ) {
            const color = getComputedStyle(node).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)") opaque.push(color);
            node = node.parentElement;
          }
          const style = getComputedStyle(detail);
          return {
            opaque,
            rule: getComputedStyle(sidebar).borderRightWidth,
            floor: getComputedStyle(frame).backgroundColor,
            gap: Math.round(
              detail.getBoundingClientRect().left - sidebar.getBoundingClientRect().right,
            ),
            radius: [style.borderTopLeftRadius, style.borderTopRightRadius],
            shadow: style.boxShadow !== "none",
          };
        });
      await expect.poll(settingsSkeleton).toEqual({
        opaque: [],
        rule: "0px",
        floor,
        gap: 8,
        radius: ["12px", "0px"],
        shadow: true,
      });
      await page.screenshot({ path: testInfo.outputPath(`settings-${platform}.png`) });
      await page.goBack();
      await expect(page.getByTestId("settings-sidebar")).toHaveCount(0);

      // Compact layouts keep the full-screen workspace.
      await page.setViewportSize({ width: 390, height: 900 });
      await expect.poll(() => page.locator('[data-material="panel"]').count()).toBe(0);
    } finally {
      await session.cleanup();
    }
  });
}

// The docked Explorer sits on the floor like the pinned sidebar, so only the workspace column
// floats between them. Both resize handles centre on their gap, where the dividing line reads.
for (const platform of ["darwin", "web"] as const) {
  test(`docked Explorer mirrors the sidebar on the floor (${platform})`, async ({ page }) => {
    test.setTimeout(180_000);
    if (platform === "darwin") {
      await page.addInitScript(() => {
        (window as unknown as { paseoDesktop: unknown }).paseoDesktop = {
          platform: "darwin",
          events: { on: () => () => {} },
          invoke: async () => null,
        };
      });
    }
    const session = await seedMockAgentWorkspace({
      repoPrefix: "material-explorer-",
      title: "Explorer skeleton",
      initialPrompt: "hello",
      featureValues: { mockAssistantResponse: "ok" },
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openAgentRoute(page, session);
      await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
      const skeleton = () =>
        page.evaluate(() => {
          const visible = (selector: string) =>
            [...document.querySelectorAll(selector)].find(
              (el) => el.getBoundingClientRect().width > 0,
            ) ?? null;
          const frame = document.querySelector('[data-material="panel-frame"]');
          const column = document.querySelector('[data-material="workspace-row"] > :first-child');
          if (!frame || !column) return null;
          const sidebar = document.querySelector('[data-material="sidebar"]');
          const explorer = visible('[data-testid="workspace-explorer-sidebar"]');
          // The floating box: the column beside a docked Explorer, otherwise the whole panel.
          const floating = explorer ? column : document.querySelector('[data-material="panel"]')!;
          const c = floating.getBoundingClientRect();
          const style = getComputedStyle(floating);
          // Distance from a handle's hit area centre to its gap centre, and whether a pointer at
          // the gap centre lands on the handle.
          const handle = (target: Element | null, gapStart: number, gapEnd: number) => {
            if (!target) return null;
            const box = target.getBoundingClientRect();
            const centre = (gapStart + gapEnd) / 2;
            const hit = document.elementFromPoint(centre, window.innerHeight / 2);
            return {
              offset: Math.round((box.left + box.right) / 2 - centre) || 0,
              hit: hit !== null && (hit === target || target.contains(hit)),
            };
          };
          // Opaque layers between the Explorer and the panel frame would cover the floor.
          const opaque: string[] = [];
          for (let node = explorer; node && node !== frame; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)") opaque.push(color);
          }
          const s = sidebar?.getBoundingClientRect();
          const e = explorer?.getBoundingClientRect();
          return {
            left: s ? Math.round(c.left - s.right) : Math.round(c.left),
            right: e ? Math.round(e.left - c.right) : Math.round(window.innerWidth - c.right),
            top: Math.round(c.top),
            bottom: Math.round(window.innerHeight - c.bottom),
            radius: [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomRightRadius,
              style.borderBottomLeftRadius,
            ],
            border: [style.borderLeftWidth, style.borderRightWidth],
            shadow: style.boxShadow !== "none",
            explorerOpaque: explorer ? opaque : null,
            leftHandle: s
              ? handle(
                  document.querySelector('[data-testid="left-sidebar-resize-handle"]'),
                  s.right,
                  c.left,
                )
              : null,
            rightHandle: e
              ? handle(
                  document.querySelector(
                    '[data-material="workspace-row"] > :not(:first-child) [role="separator"]',
                  ),
                  c.right,
                  e.left,
                )
              : null,
          };
        });
      const centred = { offset: 0, hit: true };

      // Sidebar only: the panel floats beside the sidebar, and the handle sits in the gap.
      await expect.poll(skeleton).toMatchObject({ left: 8, right: 0, leftHandle: centred });

      // Both open: the column floats 8px off each sidebar with four rounded corners.
      await ensureExplorerSidebar(page);
      await openFilesPanel(page);
      const both = {
        left: 8,
        right: 8,
        top: 0,
        bottom: 0,
        radius: ["12px", "12px", "12px", "12px"],
        border: ["1px", "1px"],
        shadow: true,
        explorerOpaque: [],
        leftHandle: centred,
        rightHandle: centred,
      };
      await expect.poll(skeleton).toEqual(both);

      // Explorer only: flush on the left, floating on the right.
      const sidebarToggle = page.getByTestId("menu-button").filter({ visible: true }).first();
      await sidebarToggle.click();
      await expect.poll(() => page.locator('[data-material="sidebar"]:visible').count()).toBe(0);
      await expect.poll(skeleton).toMatchObject({
        left: 0,
        right: 8,
        radius: ["0px", "12px", "12px", "0px"],
        border: ["0px", "1px"],
        explorerOpaque: [],
        rightHandle: centred,
      });
      await sidebarToggle.click();
      await expect.poll(skeleton).toEqual(both);

      // Reduce Transparency keeps the geometry and turns the floor opaque.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
      });
      await expect.poll(skeleton).toEqual(both);
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });

      if (platform === "web") {
        // Focus mode hides the Explorer and drops the panel.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press("Control+Shift+F");
        await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
        await expect.poll(() => page.locator('[data-material="panel"]').count()).toBe(0);
        await page.getByRole("button", { name: "Exit focus mode" }).click();
        await expect.poll(skeleton).toEqual(both);
      }

      // Compact layouts keep the full-screen workspace.
      await page.setViewportSize({ width: 390, height: 900 });
      await expect.poll(() => page.locator('[data-material="panel"]').count()).toBe(0);
    } finally {
      await session.cleanup();
    }
  });
}

// The stylesheet follows theme changes made while the App runs: picking a theme in Settings, and
// the system appearance changing under the System theme. Each step reads the floor and the
// floating panel against the theme the App renders with.
test("material stylesheet follows runtime theme changes (darwin)", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  // The desktop bridge records the theme preference each `updateChrome` call carries.
  await page.addInitScript(() => {
    const preferences: unknown[] = [];
    (window as unknown as { themePreferences: unknown[] }).themePreferences = preferences;
    (window as unknown as { paseoDesktop: unknown }).paseoDesktop = {
      platform: "darwin",
      events: { on: () => () => {} },
      invoke: async () => null,
      window: {
        getCurrentWindow: () => ({
          updateChrome: async (update: { themePreference?: unknown }) => {
            if (update.themePreference) preferences.push(update.themePreference);
          },
        }),
      },
    };
  });
  const lastPreference = () =>
    page.evaluate(() =>
      (window as unknown as { themePreferences: unknown[] }).themePreferences.at(-1),
    );
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-runtime-theme-",
    title: "Runtime theme",
    initialPrompt: "hello",
    featureValues: { mockAssistantResponse: "ok" },
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openAgentRoute(page, session);
    await page.evaluate(() =>
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "dark" })),
    );
    await page.reload();
    await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
      timeout: 60_000,
    });
    await openSettings(page);
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const picker = page.getByRole("radiogroup", { name: "Theme" });
    await expect(picker).toBeVisible();
    // Scheme of each surface by luminance, and of the text the App renders.
    const schemes = () =>
      page.evaluate(() => {
        const probe = document.createElement("canvas").getContext("2d")!;
        const dark = (color: string) => {
          probe.clearRect(0, 0, 1, 1);
          probe.fillStyle = color;
          probe.fillRect(0, 0, 1, 1);
          const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
          return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
        };
        const style = (selector: string) => {
          const el = document.querySelector(selector);
          return el ? getComputedStyle(el) : null;
        };
        const settings = '[data-material="settings"] > * > ';
        // The settings detail pane, or the workspace panel and its transcript.
        const settingsDetail = document.querySelector(`${settings}:last-child`);
        const detail = settingsDetail ?? document.querySelector('[data-material="panel"]');
        const textRoot =
          settingsDetail ?? document.querySelector('[data-testid="assistant-message"]');
        const walker = document.createTreeWalker(textRoot ?? document.body, NodeFilter.SHOW_TEXT);
        let text = "";
        for (let node = walker.nextNode(); node && !text; node = walker.nextNode()) {
          if (node.nodeValue?.trim() && node.parentElement) {
            text = getComputedStyle(node.parentElement).color;
          }
        }
        return {
          // Light text means the dark theme.
          text: dark(text) === "dark" ? "light" : "dark",
          floor: dark(style('[data-material="panel-frame"]')?.backgroundColor ?? ""),
          detail: dark(detail ? getComputedStyle(detail).backgroundColor : ""),
        };
      });
    const expectScheme = async (
      scheme: "light" | "dark",
      preference: "system" | "light" | "dark",
      step: string,
    ) => {
      await expect
        .poll(schemes, { message: step })
        .toEqual({ text: scheme, floor: scheme, detail: scheme });
      await expect.poll(lastPreference, { message: `${step} preference` }).toBe(preference);
      await page.screenshot({ path: testInfo.outputPath(`runtime-${step}.png`) });
    };
    await expectScheme("dark", "dark", "1-dark-on-light-system");
    // Vibrancy stays on: the floor lets the window material through.
    const floor = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[data-material="panel-frame"]')!).backgroundColor,
    );
    expect(floor).toMatch(/\/\s*0?\.\d+\)$/);
    await picker.getByRole("radio", { name: "Light", exact: true }).click();
    await expectScheme("light", "light", "2-light");
    await picker.getByRole("radio", { name: "Dark", exact: true }).click();
    await expectScheme("dark", "dark", "3-dark-again");
    await picker.getByRole("radio", { name: "System", exact: true }).click();
    await expectScheme("light", "system", "4-system-light");
    await page.emulateMedia({ colorScheme: "dark" });
    // Upstream settings content does not refresh on an adaptive switch; read the workspace.
    await page.getByTestId("settings-back-to-workspace").click();
    await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible();
    await expectScheme("dark", "system", "5-system-turns-dark");
  } finally {
    await session.cleanup();
  }
});

// Every surface follows the App theme, not the system appearance the page starts in. The material
// stylesheet mounts before the persisted theme is applied, so a mismatch is the case that breaks.
// Backgrounds are composited down to the system appearance's backdrop: the worst case for the
// translucent macOS surfaces, whose vibrancy would otherwise sample it.
test("material surfaces follow the App theme against the system appearance (darwin)", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    (window as unknown as { paseoDesktop: unknown }).paseoDesktop = {
      platform: "darwin",
      events: { on: () => () => {} },
      invoke: async () => null,
    };
  });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-appearance-",
    title: "Appearance mismatch",
    initialPrompt: "Review the workspace",
    featureValues: { mockAssistantResponse: "Body text has to stay readable.\n\n".repeat(30) },
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [app, system] of [
      ["dark", "light"],
      ["light", "dark"],
      ["light", "light"],
      ["dark", "dark"],
    ] as const) {
      await page.emulateMedia({ colorScheme: system });
      await openAgentRoute(page, session);
      await page.evaluate(
        (theme) =>
          localStorage.setItem(
            "@paseo:app-settings",
            JSON.stringify({ theme, chatDisplay: "full" }),
          ),
        app,
      );
      await page.reload();
      await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForFunction(() => document.querySelector("[data-material-styles]"));
      await page.getByRole("textbox", { name: "Message agent..." }).first().fill("Draft reply");
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`app-${app}-system-${system}.png`) });
      const surfaces = {
        transcript: '[data-testid="assistant-message"]',
        sidebar: `[data-testid="sidebar-workspace-row-${getServerId()}:${session.workspaceId}"]`,
        header: '[data-material="header"]',
        composer: '[data-material="composer"] textarea',
      };
      const measure = (targets: Record<string, string>) =>
        page.evaluate(
          ({ selectors, backdrop }) => {
            type Rgba = [number, number, number, number];
            const probe = document.createElement("canvas").getContext("2d")!;
            const parse = (color: string): Rgba => {
              probe.clearRect(0, 0, 1, 1);
              probe.fillStyle = color;
              probe.fillRect(0, 0, 1, 1);
              const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
              return [r, g, b, a / 255];
            };
            const over = (top: Rgba, bottom: Rgba): Rgba => [
              top[0] * top[3] + bottom[0] * (1 - top[3]),
              top[1] * top[3] + bottom[1] * (1 - top[3]),
              top[2] * top[3] + bottom[2] * (1 - top[3]),
              1,
            ];
            const luminance = ([r, g, b]: Rgba) =>
              [r, g, b]
                .map((channel) => {
                  const value = channel / 255;
                  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
            const textOf = (root: Element) => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (node.nodeValue?.trim() && node.parentElement?.checkVisibility()) {
                  return node.parentElement;
                }
              }
              return root;
            };
            const result: Record<string, number> = {};
            for (const [name, selector] of Object.entries(selectors)) {
              const root = Array.from(document.querySelectorAll(selector)).find((el) =>
                el.checkVisibility(),
              );
              if (!root) continue;
              const text = root instanceof HTMLTextAreaElement ? root : textOf(root);
              const layers: Rgba[] = [];
              for (let node: Element | null = text; node; node = node.parentElement) {
                const color = parse(getComputedStyle(node).backgroundColor);
                if (color[3] > 0) layers.push(color);
                if (color[3] === 1) break;
              }
              const background = layers.reduceRight<Rgba>(
                (below, layer) => over(layer, below),
                parse(backdrop),
              );
              const foreground = over(parse(getComputedStyle(text).color), background);
              const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
                (a, b) => b - a,
              );
              result[name] = Math.round(((lighter + 0.05) / (darker + 0.05)) * 10) / 10;
            }
            return result;
          },
          { selectors: targets, backdrop: system === "light" ? "#ffffff" : "#000000" },
        );
      const contrast = await measure(surfaces);
      await openAttachmentMenu(page);
      Object.assign(contrast, await measure({ menu: '[data-material="menu"] [role="menuitem"]' }));
      await page.keyboard.press("Escape");
      expect(Object.keys(contrast).sort()).toEqual([
        "composer",
        "header",
        "menu",
        "sidebar",
        "transcript",
      ]);
      for (const [surface, ratio] of Object.entries(contrast)) {
        expect(ratio, `${surface} (App ${app}, system ${system})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  } finally {
    await session.cleanup();
  }
});

// The diff pane header is one row: the checkout path lives in the directory selector's tooltip,
// and every directory action starts its title on the same rail after a leading icon.
test("diff pane keeps a single header row with aligned directory actions", async ({ page }) => {
  test.setTimeout(180_000);
  const { writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const session = await seedMockAgentWorkspace({
    repoPrefix: "material-diff-header-",
    title: "Diff header",
    initialPrompt: "hello",
    featureValues: { mockAssistantResponse: "ok" },
    repo: { withRemote: true, files: [{ path: ".gitignore", content: "/remote.git/\n" }] },
  });
  try {
    await writeFile(path.join(session.cwd, "README.md"), "# Temp Repo\nexport const one = 1;\n");
    await session.client.checkoutRefresh(session.cwd);
    await session.client.waitForFinish(session.agentId, 30_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, session);
    await openChangesPanel(page);
    const panel = page.getByTestId("working-diff-panel").filter({ visible: true }).first();
    const toolbar = panel.getByTestId("session-directory-toolbar");
    await expect(toolbar).toBeVisible();
    // The pane toolbar below draws the only divider between the header and the diff.
    expect(await toolbar.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("0px");
    await expect(panel.getByText(/^Checkout: /)).toHaveCount(0);
    await expect(panel.getByText("Directory changes can include work")).toHaveCount(0);

    // The checkout path and the shared-changes hint head the directory menu.
    const expectCheckoutInMenu = async () => {
      await page
        .getByTestId("working-diff-panel")
        .filter({ visible: true })
        .first()
        .getByTestId("session-directory-select")
        .click();
      const checkout = page.getByTestId("session-directory-checkout").filter({ visible: true });
      await expect(checkout).toContainText(`Checkout: ${session.cwd}`);
      await expect(checkout).toContainText("Directory changes can include work");
      return checkout;
    };
    const checkout = await expectCheckoutInMenu();
    await page.keyboard.press("Escape");
    await expect(checkout).toHaveCount(0);

    await panel.getByTestId("session-directory-actions").click();
    const items = page.getByRole("menuitem").filter({ visible: true });
    await expect(items.first()).toBeVisible();
    const rows = await items.evaluateAll((elements) =>
      elements.map((item) => {
        const icon = item.querySelector("svg");
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        return {
          label: text?.nodeValue ?? "",
          icon: icon ? Math.round(icon.getBoundingClientRect().left) : null,
          title: Math.round(range.getBoundingClientRect().left),
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.icon, row.label).not.toBeNull();
      expect(row.label.startsWith("+"), row.label).toBe(false);
    }
    expect(new Set(rows.map((row) => row.icon)).size).toBe(1);
    expect(new Set(rows.map((row) => row.title)).size).toBe(1);
    await page.keyboard.press("Escape");

    // Compact layouts open the same menu as a sheet; the checkout stays reachable there.
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByTestId("working-diff-panel").filter({ visible: true })).toBeVisible();
    await expectCheckoutInMenu();
  } finally {
    await session.cleanup();
  }
});
