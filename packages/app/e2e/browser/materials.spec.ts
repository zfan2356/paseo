import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openAttachmentMenu } from "../support/helpers/composer";
// Real renderer/daemon coverage and raw scroll samples for default materials.
test("default material evidence", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  const out =
    (await import("node:path")).resolve(process.cwd(), "../../docs/qa-evidence/materials") + "/";
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
  const wallpaper = await readFile(out + "wallpaper.svg", "utf8");
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

test("floating inventory captures", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);
  const { writeFile, readFile } = await import("node:fs/promises");
  const out =
    (await import("node:path")).resolve(process.cwd(), "../../docs/qa-evidence/materials") + "/";
  const wallpaper = await readFile(out + "wallpaper.svg", "utf8");
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

test("sidebar material preserves status, pin, context menu and hover archive", async ({ page }) => {
  test.setTimeout(180_000);
  const out = (await import("node:path")).resolve(
    process.cwd(),
    "../../docs/qa-evidence/materials",
  );
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
      const row = page.getByTestId(`session-row-${session.agentId}`).filter({ visible: true });
      await expect(row).toBeVisible();
      await expect(row.getByTestId(`session-status-${session.agentId}`)).toBeVisible();
      await row.hover();
      await expect(row.getByTestId("session-hover-archive")).toBeVisible();
      await expect(row.locator('[data-material="session-row"]')).toHaveCSS("border-radius", "12px");
      await expect(row.locator('[data-material="session-row"]')).toHaveCSS("margin-left", "8px");
      await row.click({ button: "right" });
      await expect(page.getByTestId("session-menu-pin")).toBeVisible();
      await page.screenshot({ path: `${out}/sidebar-${theme}-1440-context.png` });
      await page.getByTestId("session-menu-pin").click();
      await expect(
        page.getByTestId("session-pinned-section").getByTestId(`session-row-${session.agentId}`),
      ).toBeVisible();
      await page.mouse.move(800, 400);
      await page.screenshot({ path: `${out}/sidebar-${theme}-1440-selected.png` });
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await expect(row).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/sidebar-${theme}-390-selected.png` });
      await row.getByTestId("session-menu-trigger").click();
      await expect(page.getByTestId("session-menu-pin")).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/sidebar-${theme}-390-menu.png` });
      await page.getByTestId("session-menu-pin").click();
      await expect(
        page.getByTestId("session-pinned-section").getByTestId(`session-row-${session.agentId}`),
      ).toHaveCount(0);
      await page.getByTestId("sidebar-close").click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const row = page.getByTestId(`session-row-${session.agentId}`).filter({ visible: true });
    await row.hover();
    await row.getByTestId("session-hover-archive").click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await session.client.fetchAgent({ agentId: session.agentId }))?.agent?.archivedAt,
      )
      .toBeTruthy();
  } finally {
    await session.cleanup();
  }
});

test("material header leaves terminal content below workspace chrome", async ({ page }) => {
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
    const out = (await import("node:path")).resolve(
      process.cwd(),
      "../../docs/qa-evidence/materials",
    );
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
