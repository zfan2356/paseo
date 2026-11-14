import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openAttachmentMenu } from "../support/helpers/composer";
// Opt-in visual evidence for WORK-397; uses the same real renderer/daemon fixture.
test("material preview evidence", async ({ page }, testInfo) => {
  test.skip(process.env.PASEO_MATERIAL_QA !== "1", "Visual preview capture only");
  test.setTimeout(480_000);
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  const out =
    (await import("node:path")).resolve(process.cwd(), "../../docs/qa-evidence/material-preview") +
    "/";
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
    for (const scheme of (process.env.PASEO_MATERIAL_QA_SMOKE === "1"
      ? ["light"]
      : ["light", "dark"]) as ("light" | "dark")[]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => localStorage.setItem("paseo:material-preview", "balanced"));
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
      await page.waitForFunction(() => document.querySelector("[data-material-preview-styles]"));
      const input = page.getByRole("textbox", { name: "Message agent..." }).first();
      await input.fill("Keep the transcript crisp; soften only the floating surfaces.");
      await input.blur();
      await page.addStyleTag({
        content: `body { isolation: isolate; background: transparent; } body::before { content: ""; position: fixed; inset: -40px; z-index: -1; filter: blur(32px); background: url("data:image/svg+xml;base64,${Buffer.from(wallpaper).toString("base64")}") left center / cover fixed; }`,
      });
      const picker = page.getByTestId("material-preview-switch");
      await picker.getByRole("button", { name: "明显", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-material-preview", "pronounced");
      await picker.screenshot({ path: `${out}switch-${scheme}.png` });
      await picker.evaluate((element) => {
        element.style.visibility = "hidden";
      });
      for (const width of process.env.PASEO_MATERIAL_QA_SMOKE === "1" ? [1440] : [1440, 390]) {
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
        const scrollTop = await scroll.evaluate((el) => el.scrollTop);
        const capture = async (scene: string) => {
          const modes =
            scene === "conversation" && width === 1440
              ? ["solid", "restrained", "balanced", "pronounced"]
              : ["solid", "balanced"];
          for (const mode of modes) {
            await page.evaluate((value) => {
              document.documentElement.dataset.materialPreview = value;
            }, mode);
            await page.waitForTimeout(350);
            await scroll.evaluate((el, top) => {
              el.scrollTop = top;
            }, scrollTop);
            const blur = await page
              .locator('[data-material="composer"]:visible')
              .first()
              .evaluate((el) => getComputedStyle(el).backdropFilter);
            const filters: Record<string, string> = {
              solid: "none",
              restrained: "blur(12px) saturate(1.12)",
              balanced: "blur(20px) saturate(1.3)",
              pronounced: "blur(28px) saturate(1.5)",
            };
            expect(blur).toBe(filters[mode]);
            if (scene === "conversation" && width === 1440 && mode === "pronounced") {
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
            if (width === 1440 && (mode === "solid" || mode === "balanced")) {
              const roles =
                scene === "conversation" ? ["chrome", "composer", "secondary", "banner"] : [scene];
              for (const role of roles) {
                const surface = page.locator(`[data-material="${role}"]:visible`).first();
                if (await surface.count())
                  await surface.screenshot({ path: `${out}detail-${scheme}-${role}-${mode}.png` });
              }
            }
            await page.screenshot({ path: `${out}${scheme}-${width}-${scene}-${mode}.png` });
          }
        };
        await capture("conversation");
        if (process.env.PASEO_MATERIAL_QA_SMOKE === "1") continue;
        await page.evaluate(() => {
          document.documentElement.dataset.materialPreview = "balanced";
        });
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
      }
    }
    await writeFile(`${out}paint.json`, JSON.stringify(paintEvidence, null, 2));
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.PASEO_MATERIAL_QA_SMOKE === "1") return;
    const perf = [];
    for (const strength of ["restrained", "balanced", "pronounced"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.materialPreview = value;
      }, strength);
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

    await testInfo.attach("material-preview", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await session.cleanup();
  }
});
