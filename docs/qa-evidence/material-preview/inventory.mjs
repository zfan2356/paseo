import { runInNewContext } from "node:vm";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const files = execFileSync(
  "rg",
  ["--files", "packages/app/src", "-g", "*.tsx", "-g", "!*.test.tsx"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
const primitive =
  /<(TooltipContent|Tooltip|ToastViewport|SidebarCallout|ArchivedAgentCallout|ParentAgentCallout|FloatingSurface|DropdownMenu|DropdownMenuContent|MenuSurface|ContextMenu|ContextMenuContent|Combobox|HoverCard|HoverCardContent|AutocompletePopover|Autocomplete|PluginPopoverSurface|SidebarPopoverSurface|AdaptiveModalSheet|IsolatedBottomSheetModal|Modal)\b/g;
const tiers = {
  Tooltip: "L1",
  TooltipContent: "L1",
  ToastViewport: "L1",
  SidebarCallout: "L2",
  ArchivedAgentCallout: "L2",
  ParentAgentCallout: "L2",
  FloatingSurface: "L2 default; explicit marker may override",
  HoverCard: "L2",
  HoverCardContent: "L2",
  AutocompletePopover: "L2",
  Autocomplete: "L2",
  DropdownMenu: "L2 wide / L3 sheet",
  DropdownMenuContent: "L2 wide / L3 sheet",
  MenuSurface: "L2 wide / L3 sheet",
  ContextMenu: "L2 wide / L3 sheet",
  ContextMenuContent: "L2 wide / L3 sheet",
  Combobox: "L2 wide / L3 sheet",
  PluginPopoverSurface: "L2 wide / L3 sheet",
  SidebarPopoverSurface: "L2 wide / L3 sheet",
  AdaptiveModalSheet: "L3",
  IsolatedBottomSheetModal: "L3",
  Modal: "L3 transport; see owner table for panel marker",
};
const source = fs.readFileSync("packages/app/src/styles/theme.ts", "utf8");
const tokens = runInNewContext(
  "(" + source.match(/export const MATERIAL_PREVIEW = (\{[\s\S]*?\n\}) as const;/)[1] + ")",
);
const slotsSource = fs.readFileSync("packages/app/src/styles/material-slots.ts", "utf8");
const slots = runInNewContext(
  "(" + slotsSource.match(/export const MATERIAL_SLOTS = (\{[\s\S]*?\n\}) as const;/)[1] + ")",
);
const raised = new Set(Object.values(tokens.elevation).flatMap((level) => level.surfaces));
const structural = new Set(["window", "header", "chrome", "dock", "dock-composer", "solid"]);
const unmapped = Object.values(slots).filter(
  (slot) => !raised.has(slot.material) && !structural.has(slot.material),
);
if (unmapped.length) throw new Error("Unmapped material slots: " + JSON.stringify(unmapped));
const entries = [];
for (const file of files.sort()) {
  const matches = [...fs.readFileSync(file, "utf8").matchAll(primitive)];
  if (!matches.length) continue;
  const names = [...new Set(matches.map((match) => match[1]))];
  const deferred =
    /src\/session-navigation\/|components\/left-sidebar\.tsx$|components\/sidebar-workspace-/.test(
      file,
    );
  let status =
    "inherits shared material host; runtime screenshots cover renderer families, not every business action";
  if (file.includes(".native.")) status = "native path unchanged; code evidence";
  if (deferred) status = "待 WORK-396 合入后接入";
  entries.push({ file, surfaces: names.map((name) => ({ name, elevation: tiers[name] })), status });
}
fs.writeFileSync(
  "docs/qa-evidence/material-preview/floating-inventory.json",
  JSON.stringify(
    {
      scope:
        "Repository JSX callers of shared floating primitives; renderer owners and raw modal exceptions are enumerated in README. Files owned by WORK-396 are listed only.",
      elevation: tokens.elevation,
      structuralSlots: [...structural],
      unmapped,
      files: entries.length,
      deferred: entries.filter((entry) => entry.status.startsWith("待")).length,
      entries,
    },
    null,
    2,
  ),
);
console.log(
  entries.length,
  "files;",
  entries.filter((entry) => entry.status.startsWith("待")).length,
  "deferred to WORK-396",
);
