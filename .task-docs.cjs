const fs = require("fs");
function edit(p, f) {
  fs.writeFileSync(p, f(fs.readFileSync(p, "utf8")));
}
edit("docs/session-context.md", (s) => {
  s = s
    .replace("删除全局会话/路径开关", "顶部按项目/按目录只切会话分组")
    .replace(
      "本文描述统一设计；WORK-366",
      "本文描述统一设计；WORK-396 将目录管理移到右侧 Explorer，并统一两种分组的会话卡片。WORK-366",
    );
  s = s
    .replace("展开能看到启动目录、手动绑定的", "在右侧文件/更改面板选择启动目录、手动绑定的")
    .replace("展开后都可出现同一条 gmi 路径", "各自的右侧目录选择器都可出现同一条 gmi 路径")
    .replace("侧边栏立即可进入", "右侧目录选择器立即可进入")
    .replace("展开可浏览资料目录", "右侧可浏览资料目录");
  const start = s.indexOf("顶部“会话 | 目录与终端”");
  const end = s.indexOf("根会话使用现有", start);
  s =
    s.slice(0, start) +
    `顶部“按项目 / 按目录”显示同一批会话，默认按项目。按项目沿用 SessionContext 项目归属；主检出和 linked worktree 的自动归属规则见上节。按目录以 agent 实际 cwd 分组，不能拿启动历史或浏览中的绑定目录代替。切换只改变分组，保留选中会话、执行位置和独立置顶区的顺序。

会话卡片复用工作区列表的紧凑标题、项目图标和状态标记。图标取该会话的项目，不能取当前浏览目录。标题、状态及操作不随分组模式变化。侧栏不展开目录、不提供绑定入口，不堆叠项目状态副行或目录数量；目录管理由 [Explorer](explorer-sidebar.md#session-directory-targets) 承担。

\x60\x60\x60text
左侧                         右侧 Explorer
[按项目] [按目录]            [文件] [更改] [工作区与终端]
已置顶                       [关联目录 ▾] [⋯]
  图标 + 会话标题        ⋯     文件树 / 本地更改
项目名 / 实际 cwd 短名
  图标 + 会话标题        ⋯
\x60\x60\x60

无会话工作区、终端和服务从右侧“工作区与终端”打开，复用原全局工作区列表。没有当前工作区时，Open project 页提供同一入口。选择真实 workspace 后打开它原有布局，不能自动创建会话、改变已有会话 cwd 或产生另一套资源生命周期。手机入口和关闭按钮始终可点。

` +
    s.slice(end);
  s = s
    .replace(
      "状态分组保留，但分组成员改为会话，每行状态来自自己的 activeTurn/permission/attention；",
      "两种分组每行状态来自自己的 activeTurn/permission/attention；",
    )
    .replace(
      "搜索命中子目录/MR 时显露其所属会话，不能只剩一条失去上下文的子项。",
      "搜索匹配会话标题和关联目录，返回所属会话。",
    );
  s = s
    .replace("目录点击是一个明确导航意图", "右侧目录选择是一个明确导航意图")
    .replace("同时选中所属会话并打开该路径；", "打开该会话的路径目标；")
    .replace(
      "目录失效保留灰色行并提供重试/移除，MR 和聊天仍可读。",
      "目录失效保留选择项并显示读取错误，用户仍可移除绑定或选回启动目录，聊天仍可读。",
    );
  s = s
    .replace("  分组                 项目 / 状态", "  分组                 顶部按项目 / 按目录")
    .replace(
      "  显示                 主机、关联数量、时间、服务…",
      "  显示                 标签、主机、时间…",
    )
    .replace(
      "  目录                 启动目录 + 绑定管理",
      "  目录管理             右侧文件/更改面板",
    );
  return s;
});
edit("docs/architecture.md", (s) =>
  s
    .replace(
      "Workspace rows remain under the explicit Directories and terminals resource entry, including\ncontainers without a visible root agent.",
      "Workspace rows remain in the Workspaces and terminals sheet, including containers without a\nvisible root agent. Its entry points live in Explorer and on Open project.",
    )
    .replace(
      "Session navigation uses bounded directory checks on expansion and explicit refresh.",
      "Directory panels read only the selected path; sidebar grouping does not inspect bound directories.",
    ),
);
edit("docs/explorer-sidebar.md", (s) => {
  const start = s.indexOf("Close the left sidebar before revealing");
  const end = s.indexOf("\n## Sheets", start);
  return (
    s.slice(0, start) +
    `Files and Changes expose the session directory selector and binding actions. A default panel follows
the focused session's saved browsing selection; explicitly opened directory tabs keep their target.
Selecting or binding a directory never changes execution cwd. Keep the selector mounted when the
selected path fails to load, so another directory and Remove binding stay reachable. The immutable
launch directory cannot be removed. Local Changes resolves nested paths to their actual checkout
root before Git operations.

Workspaces and terminals in the dock toolbar opens the existing global workspace list as a sheet.
Open project exposes the same sheet when no workspace is selected. Its rows navigate to real
workspaces and restore their terminal, service and layout state; they never create placeholder agents.
A binding grants no container-management authority: workspace archive and base-branch changes stay
in that resource entry. A directory Changes link opens its actual PR URL; it must not select a PR
through the owning session's checkout.
` +
    s.slice(end)
  );
});
