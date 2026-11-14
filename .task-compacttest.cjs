const fs = require("fs");
let p = "packages/app/src/session-navigation/workspace-resources.tsx";
let s = fs
  .readFileSync(p, "utf8")
  .replace(
    "<View style={styles.fill}>",
    '<View style={styles.fill} testID="workspace-resource-list">',
  );
fs.writeFileSync(p, s);
p = "packages/app/e2e/browser/sidebar-model-b.spec.ts";
s = fs.readFileSync(p, "utf8");
s = s.replaceAll(
  "sheet.getByTestId(`sidebar-workspace-row-${getServerId()}:${independent.workspace.id}`)",
  'page.getByTestId("workspace-resource-list").getByTestId(`sidebar-workspace-row-${getServerId()}:${independent.workspace.id}`)',
);
s = s.replaceAll(
  '.getByTestId("workspace-resources-sheet")\n      .getByTestId(`sidebar-workspace-row-',
  '.getByTestId("workspace-resource-list")\n      .getByTestId(`sidebar-workspace-row-',
);
fs.writeFileSync(p, s);
