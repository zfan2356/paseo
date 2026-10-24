import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import {
  expandFolder,
  openFileExplorer,
  openFileFromExplorer,
} from "../support/helpers/file-explorer";

async function openNestedGuide(page: Page): Promise<void> {
  await openFileExplorer(page);
  await expandFolder(page, "docs");
  await openFileFromExplorer(page, "guide.md");
}

async function followDetailsLink(page: Page): Promise<void> {
  await page
    .getByTestId("markdown-preview-frame")
    .getByRole("link", { name: "Details", exact: true })
    .click();
}

test("Markdown preview resolves a relative link from the document directory", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "markdown-relative-links-" });
  await mkdir(path.join(workspace.repoPath, "docs/guide"), { recursive: true });
  await writeFile(
    path.join(workspace.repoPath, "docs/guide.md"),
    "# Guide\n\n[Details](guide/details.md)\n",
  );
  await writeFile(
    path.join(workspace.repoPath, "docs/guide/details.md"),
    "# Nested details destination\n",
  );
  await workspace.navigateTo();

  await openNestedGuide(page);
  await followDetailsLink(page);

  await expect(
    page
      .getByTestId("markdown-preview-frame")
      .getByText("Nested details destination", { exact: true }),
  ).toBeVisible();
});

test("Markdown heading links return an existing source tab to its anchored preview", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "markdown-heading-links-" });
  await mkdir(path.join(workspace.repoPath, "docs/guide"), { recursive: true });
  await writeFile(
    path.join(workspace.repoPath, "docs/guide.md"),
    "# Guide\n\n[Details](guide/details.md#destination-heading)\n",
  );
  await writeFile(
    path.join(workspace.repoPath, "docs/guide/details.md"),
    `# Details\n\n${"Filler paragraph.\n\n".repeat(60)}## Destination heading\n\nAnchored content.\n`,
  );
  await workspace.navigateTo();
  await openNestedGuide(page);
  await followDetailsLink(page);

  const preview = page.getByTestId("markdown-preview-frame").filter({ visible: true });
  await expect(preview.getByRole("heading", { name: "Destination heading" })).toBeInViewport();
  const toolbar = page.getByTestId("file-panel-bar").filter({ visible: true });
  await toolbar.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("file-source-editor")).toBeVisible();

  await page
    .getByTestId("workspace-tab-file_docs/guide.md")
    .filter({ visible: true })
    .first()
    .click({ position: { x: 12, y: 13 } });
  await followDetailsLink(page);
  await expect(toolbar.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(preview.getByRole("heading", { name: "Destination heading" })).toBeInViewport();
});
