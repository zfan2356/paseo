const fs = require("fs");
let p = "packages/app/src/components/sidebar/sidebar-status-list.tsx";
let s = fs.readFileSync(p, "utf8");
const a = s.indexOf("const StatusWorkspaceRow = memo(function StatusWorkspaceRow(");
const b = s.indexOf("const StatusWorkspaceRowWithMenu", a);
let t = s
  .slice(a, b < 0 ? s.length : b)
  .replace("  onToggleWorkspacePin,", "  onToggleWorkspacePin,\n  onWorkspacePress,")
  .replace(
    "    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });",
    "    onWorkspacePress?.();\n    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });",
  )
  .replace(
    "  }, [workspace.serverId, workspace.workspaceId]);",
    "  }, [workspace.serverId, workspace.workspaceId, onWorkspacePress]);",
  );
s = s.slice(0, a) + t + (b < 0 ? "" : s.slice(b));
fs.writeFileSync(p, s);
p = "packages/app/e2e/browser/workspace-scripts-menu-resize.spec.ts";
s = fs.readFileSync(p, "utf8");
s = 'import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";\n' + s;
s = s.replace(
  '    await explorer.getByTestId("workspace-resources-open").click();\n    await page',
  '    await explorer.getByTestId("workspace-resources-open").click();\n    await selectSidebarStatusGrouping(page);\n    await page',
);
s = s.replace(
  '    await expect(page.getByTestId("workspace-scripts-start-web")).toBeVisible();',
  '    await expect(page.getByTestId("workspace-scripts-start-web")).toBeVisible();\n    await page.keyboard.press("Escape");\n    const currentExplorer = await ensureExplorerSidebar(page);\n    await currentExplorer.getByTestId("workspace-resources-open").click();\n    await page.getByTestId("workspace-resource-list").getByTestId(`sidebar-workspace-title-${getServerId()}:${resource.workspaceId}`).click();\n    await expect(page.getByTestId("workspace-resources-sheet")).not.toBeVisible();',
);
fs.writeFileSync(p, s);
