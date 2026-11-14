import { openAttachmentMenu } from "../support/helpers/composer";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { waitForPermissionPrompt } from "../support/helpers/permissions";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// Literal shell commands and copyright markers must survive Markdown rendering.
test.describe("Plan card markdown", () => {
  test("renders plan text verbatim", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "plan-card-markdown-",
      title: "Plan card markdown e2e",
      initialPrompt: "Emit synthetic plan approval.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForPermissionPrompt(page, 120_000);

      const planCard = page.getByTestId("permission-plan-card");
      await expect(planCard.locator(".enrm-text")).toBeVisible();
      await expect(planCard).toContainText("(c)");
      await expect(planCard).toContainText('--name="my repo"');
      await expect(planCard).toContainText("---buzz");
      await expect(planCard).not.toContainText("©");
      await expect(planCard).not.toContainText("—buzz");
    } finally {
      await session.cleanup();
    }
  });
});

test("chat and file preview share the library renderer and resolve file links", async ({
  page,
}, testInfo) => {
  await withSharedMarkdownFiles(page, async () => {
    const message = page.getByTestId("assistant-message");
    await expect(message).toHaveCount(1);
    await expect(message.locator(".enrm-text > p").first()).toContainText("First paragraph.");
    await expect(message.locator(".enrm-text > p").nth(1)).toContainText("Second paragraph.");
    await expect(message.locator("blockquote")).toContainText("A quote");
    await expect(message.getByRole("table")).toContainText("42");
    await expect(message.getByRole("cell").nth(0)).toHaveText("Answer");
    await expect(message.getByRole("cell").nth(1)).toHaveText("");
    await expect(message.getByRole("cell").nth(2)).toHaveText("42");
    await expect(message.locator("p div")).toHaveCount(0);
    await openSharedMarkdownFile(page, "README.md");
    const preview = page.getByTestId("markdown-preview-frame");
    await expect(preview.locator(".enrm-text")).toContainText("Second paragraph.");
    await expect(preview.getByRole("table")).toContainText("42");
    await returnToSharedMarkdownChat(page);
    await expectFileLinkTooltip(
      page,
      message.getByRole("link", { name: "src/说明.md:2-3", exact: true }),
      "packages/app/src/说明.md:2-3",
    );
    await openSharedMarkdownFile(page, "src/说明.md:2-3");
    await expect(page.getByText("Unicode suffix lookup succeeded.", { exact: true })).toBeVisible();
    await openSharedMarkdownFile(page, "packages/app/src/说明.md:2-3");
    await expect(page.getByText("Unicode suffix lookup succeeded.", { exact: true })).toBeVisible();
    await openSharedMarkdownFile(page, "Space file");
    await expect(
      page.getByText("Explicit link opened the space filename.", { exact: true }),
    ).toBeVisible();
    await openSharedMarkdownFile(page, "my%20file.ts");
    await expect(
      page.getByText("Inline code opened the literal percent filename.", { exact: true }),
    ).toBeVisible();
    await testInfo.attach("shared-renderer", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
async function expectFileLinkTooltip(page: Page, link: Locator, path: string) {
  await link.hover();
  await expect(page.getByRole("tooltip")).toHaveText(path);
}

async function withSharedMarkdownFiles(page: Page, run: () => Promise<void>) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const source =
    "First paragraph.\n\nSecond paragraph.\n\n```ts\nconst answer = 42;\n```\n\n> A quote\n\n| Key || Value |\n| --- | --- | --- |\n| Answer || 42 |\n\nOpen `README.md` or `src/说明.md:2-3`, or packages/app/src/说明.md:2-3.\n\n[Space file](my%20file.ts) and `my%20file.ts`.";
  const session = await seedMockAgentWorkspace({
    repoPrefix: "shared-markdown-",
    title: "Shared Markdown",
    featureValues: { mockAssistantResponse: source },
    initialPrompt: "Show Markdown",
  });
  try {
    await writeFile(`${session.cwd}/README.md`, source);
    await writeFile(`${session.cwd}/my file.ts`, "Explicit link opened the space filename.");
    await writeFile(
      `${session.cwd}/my%20file.ts`,
      "Inline code opened the literal percent filename.",
    );
    await mkdir(`${session.cwd}/packages/app/src`, { recursive: true });
    await writeFile(
      `${session.cwd}/packages/app/src/说明.md`,
      "# Nested file\n\nUnicode suffix lookup succeeded.",
    );
    await session.client.waitForFinish(session.agentId, 30_000);
    // A cold render must work even when a separate parser chunk cannot be fetched.
    await page.route("**/wasm/md4c.bundle?**", (route) => route.abort("failed"));
    await openAgentRoute(page, session);
    await run();
  } finally {
    await session.cleanup();
  }
}

async function returnToSharedMarkdownChat(page: Page) {
  await page.getByRole("button", { name: "Shared Markdown", exact: true }).click();
}

async function openSharedMarkdownFile(page: Page, name: string) {
  await returnToSharedMarkdownChat(page);
  await page.getByTestId("assistant-message").getByRole("link", { name, exact: true }).click();
}

test("linked inline code keeps code typography and wraps long paths", async ({
  page,
}, testInfo) => {
  const longPath =
    "packages/app/src/components/markdown/renderer/very-long-directory-name/another-long-directory-name/file.ts:12";
  const session = await seedMockAgentWorkspace({
    repoPrefix: "inline-code-style-",
    title: "Inline code style",
    featureValues: {
      mockAssistantResponse:
        "Compare `ordinary_token`, `file.ts:12`, `https://example.com`. At the end of this line open `" +
        longPath +
        "`.",
    },
    initialPrompt: "Show inline code",
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const message = page.getByTestId("assistant-message");
    await expect(message.getByRole("link", { name: longPath, exact: true })).toBeVisible();
    const measurements = await measureInlineCode(message);
    await testInfo.attach("inline-code-measurements", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    expect(measurements.codes).toHaveLength(4);
    const [plain, file, url, long] = measurements.codes;
    for (const linked of [file, url, long]) {
      expect(linked.fontSize).toBe(plain.fontSize);
      expect(linked.fontFamily).toBe(plain.fontFamily);
      expect(linked.backgroundColor).toBe(plain.backgroundColor);
      expect(linked.color).toBe(linked.anchorColor);
      expect(linked.color).not.toBe(plain.color);
    }
    expect(long.lines).toBeGreaterThan(1);
    expect(long.right).toBeLessThanOrEqual(measurements.right + 1);
  } finally {
    await session.cleanup();
  }
});

async function measureInlineCode(message: Locator) {
  return message.evaluate((element) => {
    // Constrain the paragraph to exercise an inline path at a line boundary.
    const paragraph = element.querySelector("p")!;
    paragraph.style.width = "300px";
    const codes = Array.from(paragraph.querySelectorAll("code"), (code) => {
      const style = getComputedStyle(code);
      const range = document.createRange();
      range.selectNodeContents(code);
      const rects = Array.from(range.getClientRects());
      return {
        text: code.textContent,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        backgroundColor: style.backgroundColor,
        color: style.color,
        anchorColor: code.closest("a") ? getComputedStyle(code.closest("a")!).color : null,
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
        rects: rects.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top })),
        lines: new Set(rects.map((rect) => rect.top)).size,
        right: Math.max(...rects.map((rect) => rect.right)),
      };
    });
    return { codes, right: paragraph.getBoundingClientRect().right };
  });
}

test("inline-code paths preserve stable recognition and file navigation", async ({
  page,
  context,
}, testInfo) => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const paths = ["src/app/[id].tsx", "src/app/(tabs)/index.tsx", "src/a$b.ts"];
  const source =
    paths.map((path) => `Open \`${path}\`.`).join("\n\n") +
    "\n\nOpen `.gitignore` and `src/index.ts#L10-L20`. Compare before/after and `before/after`. Keep `word.word` plain.";
  const session = await seedMockAgentWorkspace({
    repoPrefix: "inline-path-regression-",
    title: "Inline path regression",
    initialPrompt: "Show file paths",
    featureValues: { mockAssistantResponse: source },
  });
  try {
    await mkdir(`${session.cwd}/src/app/(tabs)`, { recursive: true });
    for (const path of paths) await writeFile(`${session.cwd}/${path}`, `Opened ${path}`);
    await writeFile(
      `${session.cwd}/src/index.ts`,
      Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n"),
    );
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const message = page.getByTestId("assistant-message");
    await expect(message.getByRole("link", { name: ".gitignore", exact: true })).toBeVisible();
    await expect(message.getByRole("link", { name: "before/after", exact: true })).toHaveCount(0);
    await expect(message.getByRole("link", { name: "word.word", exact: true })).toHaveCount(0);
    for (const path of paths) {
      await openInlineRegressionFile(page, path);
      await expect(page.getByTestId("file-source-editor").filter({ visible: true })).toContainText(
        `Opened ${path}`,
      );
    }
    await openInlineRegressionFile(page, "src/index.ts#L10-L20");
    await expect(page.getByLabel("Line 20, column 26")).toBeVisible();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-content")
      .focus();
    await page.keyboard.press("ControlOrMeta+c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        Array.from({ length: 11 }, (_, i) => `export const line${i + 10} = ${i + 10};`).join("\n"),
      );
    await expect(
      page
        .getByTestId("file-source-editor")
        .filter({ visible: true })
        .locator(".cm-selectionBackground"),
    ).not.toHaveCount(0);
    await testInfo.attach("inline-path-line-selection", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await session.cleanup();
  }
});

async function openInlineRegressionFile(page: Page, path: string) {
  await page.getByRole("button", { name: "Inline path regression", exact: true }).click();
  await page
    .getByTestId("assistant-message")
    .getByRole("link", { name: path, exact: true })
    .click();
}

// Web links are styled inline by the library, so hover state has to restyle the anchor.
test("markdown links underline on hover", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "markdown-link-hover-",
    title: "Markdown link hover",
    featureValues: {
      mockAssistantResponse: "See [the docs](https://example.com/docs) and [README](README.md).",
    },
    initialPrompt: "Show links",
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const message = page.getByTestId("assistant-message");
    for (const name of ["the docs", "README"]) {
      const link = message.getByRole("link", { name, exact: true });
      await expect(link).toHaveCSS("text-decoration-line", "none");
      await link.hover();
      await expect(link).toHaveCSS("text-decoration-line", "underline");
      await page.mouse.move(0, 0);
      await expect(link).toHaveCSS("text-decoration-line", "none");
    }
  } finally {
    await session.cleanup();
  }
});

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("Markdown images show a zoom-in cursor", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "markdown-image-cursor-",
    title: "Markdown image cursor",
    featureValues: { mockAssistantResponse: `Before.\n\n![pixel](${PIXEL_PNG})\n\nAfter.` },
    initialPrompt: "Show image",
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const image = page.getByTestId("assistant-message").getByRole("button", { name: "pixel" });
    await expect(image).toHaveCSS("cursor", "zoom-in");
  } finally {
    await session.cleanup();
  }
});

// Opt-in visual evidence for WORK-397; uses the same real renderer/daemon fixture.
test("material preview evidence", async ({ page }, testInfo) => {
  test.skip(process.env.PASEO_MATERIAL_QA !== "1", "Visual preview capture only");
  test.setTimeout(240_000);
  const { mkdir, writeFile } = await import("node:fs/promises");
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
  const source = Array.from(
    { length: 36 },
    (_, index) =>
      `## ${index + 1}. Keep the workspace in view\n\nPaseo connects to your development environment. The conversation stays readable while the agent works through changes, checks the result, and explains the next step.\n\n\`packages/app/src/styles/theme.ts\` owns the palette. **One surface, one purpose.** Keep the green accent for the action that matters.\n\n\`\`\`ts\nconst surface = { readable: true, focused: true };\nawait reviewChanges(surface);\n\`\`\``,
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
      await page.addInitScript(() => localStorage.setItem("paseo:material-preview", "glass"));
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
      // A synthetic wallpaper is only the window's backdrop; all UI is the real app.
      await page.addStyleTag({
        content:
          "body { background: radial-gradient(ellipse at 0% 30%, #718f90, transparent 65%), radial-gradient(ellipse at 80% 80%, #b3a48d, #525e70); }",
      });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(500);
        const scroll = page.getByTestId("agent-chat-scroll").filter({ visible: true });
        await scroll.hover();
        await page.mouse.wheel(0, -1400);
        await page.waitForTimeout(400);
        await scroll.evaluate((el) => {
          el.scrollTop = el.scrollHeight * 0.45;
        });
        await page.waitForTimeout(400);
        const scrollTop = await scroll.evaluate((el) => el.scrollTop);
        const capture = async (scene: string) => {
          for (const mode of ["solid", "glass"]) {
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
            expect(blur).toBe(mode === "glass" ? "blur(24px) saturate(1.15)" : "none");
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
    const perf = [];
    for (let trial = 0; trial < 3; trial++) {
      for (const blur of trial % 2 ? [true, false] : [false, true]) {
        const override = blur
          ? null
          : await page.addStyleTag({
              content: "[data-material] { backdrop-filter: none !important; }",
            });
        const sample = await page
          .getByTestId("agent-chat-scroll")
          .filter({ visible: true })
          .evaluate(async (element) => {
            const frames: number[] = [];
            const writes: number[] = [];
            element.scrollTop = element.scrollHeight * 0.3;
            let previous = await new Promise<number>(requestAnimationFrame);
            for (let i = 0; i < 180; i++) {
              const now = await new Promise<number>(requestAnimationFrame);
              const start = performance.now();
              element.scrollTop += i < 90 ? 12 : -12;
              writes.push(performance.now() - start);
              if (i >= 30) frames.push(now - previous);
              previous = now;
            }
            return {
              frames,
              writes,
              scrollHeight: element.scrollHeight,
              viewportHeight: element.clientHeight,
              nodes: document.querySelectorAll("*").length,
            };
          });
        perf.push({ trial, blur, ...sample });
        await override?.evaluate((element) => element.parentNode?.removeChild(element));
      }
    }
    await writeFile(
      `${out}frames.json`,
      JSON.stringify(
        {
          browser: page.context().browser()?.version(),
          viewport: { width: 1440, height: 1000 },
          sections: 36,
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
