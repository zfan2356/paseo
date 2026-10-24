import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { pluginRequirements } from "../support/helpers/plugin-fixture";

// Requires the user's running Magpie management server, like other real-provider tests.
test("Magpie opens its upstream page and navigates the native management views", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-magpie-native-"));
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = await client.getDaemonConfig();
  try {
    await cp(path.resolve(__dirname, "../../../../plugins/magpie"), directory, {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id: "magpie", requirements: pluginRequirements }),
    );
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Magpie", exact: true }).click();
    const frame = page.frameLocator('iframe[title="Magpie"]');
    await expect(frame.locator("#nav")).toBeVisible();
    await frame.locator('#nav [data-view="providers"]').click();
    await expect(frame.locator('#nav [data-view="providers"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await frame.locator('#nav [data-view="routing"]').click();
    await expect(frame.locator('#nav [data-view="routing"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    const embedded = page.frames().find((entry) => entry.url().includes(":3430/"));
    expect(embedded).toBeDefined();
    expect(new URL(embedded!.url()).searchParams.has("k")).toBe(false);
    await expect(page.getByText("个人优先路由", { exact: true })).toHaveCount(0);
  } finally {
    await client.removePlugin("magpie").catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previous.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
