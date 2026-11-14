const fs = require("fs");
const p = "packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx";
let s = fs.readFileSync(p, "utf8");
s = 'import { PressHighlight } from "@/components/ui/press-highlight";\n' + s;
const a = s.indexOf("export function SidebarCardContent(");
let t = s.slice(a);
t = t
  .replace("  title,", "  onPress,\n  selected = false,\n  title,")
  .replace("  title: string;", "  onPress?: () => void;\n  selected?: boolean;\n  title: string;");
const x = t.indexOf("  return (");
t =
  t.slice(0, x) +
  "  const selectedState = useMemo(() => ({ selected }), [selected]);\n" +
  t.slice(x);
const titleStart = t.indexOf("            <Text style={titleStyle}");
const titleEnd = t.indexOf(
  "            <View style={sidebarWorkspaceRowStyles.rowRight}",
  titleStart,
);
const old = t.slice(titleStart, titleEnd);
t =
  t.slice(0, titleStart) +
  `            {onPress ? <PressHighlight onPress={onPress} accessibilityRole="button" accessibilityState={selectedState}
              aria-selected={selected} style={styles.titlePress}>
              <Text style={titleStyle} numberOfLines={1} testID={titleTestID}>{title}</Text>
            </PressHighlight> : (
${old}            )}
` +
  t.slice(titleEnd);
s = s.slice(0, a) + t;
s = s.replace(
  "  workspaceContentColumn: {",
  "  titlePress: { flex: 1, minWidth: 0 },\n  workspaceContentColumn: {",
);
fs.writeFileSync(p, s);
const b = "packages/app/src/session-navigation/sidebar.tsx";
s = fs.readFileSync(b, "utf8");
s = s
  .replace('import { PressHighlight } from "@/components/ui/press-highlight";\n', "")
  .replace("  const selectedState = useMemo(() => ({ selected }), [selected]);\n", "");
s = s
  .replace("        <PressHighlight", "        <View")
  .replace(
    '          onPress={openChat}\n          accessibilityRole="button"\n          accessibilityState={selectedState}\n          aria-selected={selected}\n',
    "",
  )
  .replace("        </PressHighlight>", "        </View>")
  .replace(
    "          <SidebarCardContent",
    "          <SidebarCardContent\n            onPress={openChat}\n            selected={selected}",
  );
fs.writeFileSync(b, s);
const e = "packages/app/e2e/browser/sidebar-model-b.spec.ts";
s = fs
  .readFileSync(e, "utf8")
  .replace(
    "const before = await main.client.getSessionContext(main.agentId);",
    "const before = (await main.client.getSessionContext(main.agentId)).context;",
  )
  .replace(
    "expect(await main.client.getSessionContext(main.agentId)).toEqual(before);",
    "expect((await main.client.getSessionContext(main.agentId)).context).toEqual(before);",
  );
fs.writeFileSync(e, s);
const u = "packages/app/src/session-navigation/model.test.ts";
s = fs
  .readFileSync(u, "utf8")
  .replace(
    'agents.map((agent) => [directorySessionGroupKey("host", agent.cwd), [agent.id]])',
    '[agents[0], agents[2], agents[1]].map((agent) => [directorySessionGroupKey("host", agent.cwd), [agent.id]])',
  )
  .replace(
    "expect(byDirectory.flatMap((group) => group.agents)).toEqual(agents);",
    "expect(byDirectory.flatMap((group) => group.agents)).toEqual([agents[0], agents[2], agents[1]]);",
  );
fs.writeFileSync(u, s);
