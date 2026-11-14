const fs = require("fs");
const p = "packages/app/src/session-navigation/directory-toolbar.tsx";
let s = fs.readFileSync(p, "utf8");
s =
  'import { useFetchQuery } from "@/data/query";\nimport { checkoutStatusQueryKey } from "@/git/query-keys";\n' +
  s;
s = s.replace(
  'executionDirectoryLabel } from "./model"',
  'executionDirectoryLabel, readDirectoryFacts } from "./model"',
);
if (!s.includes("executionDirectoryLabel, readDirectoryFacts"))
  s = s.replace("  executionDirectoryLabel,", "  executionDirectoryLabel,\n  readDirectoryFacts,");
s = s.replace(
  "import { BindDirectory, useContextMutation }",
  "import { BindDirectory, CreateSessionWorktree, useContextMutation }",
);
s = s.replace(
  "  const { serverId, workspaceId, target } = usePaneContext();",
  "  const { serverId, workspaceId, target } = usePaneContext();\n  const { t } = useTranslation();",
);
s = s.replace(
  "  return {\n    agent,",
  '  const facts = useFetchQuery({\n    dataShape: "value",\n    queryKey: checkoutStatusQueryKey(serverId, directory ?? ""),\n    queryFn: () => {\n      if (!client || !directory) throw new Error(t("common.errors.daemonUnavailable"));\n      return readDirectoryFacts({ client, path: directory, refreshError: t("sessionNavigation.refreshError") });\n    },\n    enabled: !!client && !!directory && connected && active, staleTimeMs: 15000, retry: false,\n  });\n  return {\n    agent,\n    facts,',
);
s = s.replace(
  "  const [binding, setBinding] = useState(false);",
  "  const [binding, setBinding] = useState(false);\n  const [worktree, setWorktree] = useState(false);\n  const openWorktree = useCallback(() => setWorktree(true), []);\n  const closeWorktree = useCallback(() => setWorktree(false), []);\n  const repository = selection.facts.data?.isGit ? selection.facts.data.mainRepoRoot ?? selection.facts.data.repoRoot : null;",
);
s = s.replace(
  "  if (\n    !agent ||",
  '  if (selection.error) return <Text accessibilityRole="alert" style={styles.error}>{selection.error}</Text>;\n  if (\n    !agent ||',
);
s = s.replace(
  "      onBind={openBinding}",
  "      onBind={openBinding}\n      onWorktree={repository ? openWorktree : undefined}",
);
s = s.replace(
  "      {binding ? (",
  "      {worktree && repository ? <CreateSessionWorktree client={client} serverId={serverId} agentId={agent.id} repository={repository} onClose={closeWorktree} /> : null}\n      {binding ? (",
);
s = s
  .replace("  onBind,\n  onSelect,", "  onBind,\n  onWorktree,\n  onSelect,")
  .replace("  onBind(): void;", "  onBind(): void;\n  onWorktree?: () => void;");
s = s.replace(
  '            {t("sessionNavigation.addDirectory")}\n          </DropdownMenuItem>',
  '            {t("sessionNavigation.addDirectory")}\n          </DropdownMenuItem>\n          {onWorktree ? <DropdownMenuItem disabled={!canManage || mutation.isPending} onSelect={onWorktree}>{t("sessionNavigation.newWorktree")}</DropdownMenuItem> : null}',
);
fs.writeFileSync(p, s);
const q = "packages/app/e2e/browser/sidebar-model-b.spec.ts";
s = fs
  .readFileSync(q, "utf8")
  .replace(
    "expect((await main.client.fetchAgent({ agentId: main.agentId })).agent).toMatchObject({\n      cwd: main.cwd,",
    "expect((await main.client.fetchAgent({ agentId: main.agentId }))?.agent).toMatchObject({\n      cwd: main.cwd,",
  );
fs.writeFileSync(q, s);
