import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  snapshotRpc,
  startRpc,
  sourceRpc,
  ultraRpc,
  signInStartRpc,
  signInPollRpc,
  signInSubmitRpc,
  signInCancelRpc,
  type SignIn,
  type Snapshot,
} from "../shared/magpie.js";
import { openExternal } from "./web.js";

const key = ["magpie", "snapshot"] as const;
const labels: Record<string, string> = {
  codex: "ChatGPT / Codex",
  claude: "Claude",
  ichat: "iChat",
  cursor: "Cursor",
  deepseek: "DeepSeek",
};
const date = (value: string) => (value ? new Date(value).toLocaleString() : "尚未读取");
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";
const pending = (flow: SignIn | null | undefined) =>
  !!flow && ["waiting", "installing"].includes(flow.state);
type ActionName =
  | "accounts"
  | "routes"
  | "refresh"
  | "start"
  | "codex"
  | "claude"
  | "open"
  | "submit"
  | "cancel"
  | "auto"
  | "personal"
  | "ichat"
  | "ultra";
type OnAction = (action: ActionName, value?: string) => void;

function useMagpie() {
  const getSnapshot = useRpc(snapshotRpc);
  const start = useRpc(startRpc);
  const begin = useRpc(signInStartRpc);
  const poll = useRpc(signInPollRpc);
  const submit = useRpc(signInSubmitRpc);
  const cancel = useRpc(signInCancelRpc);
  const setSource = useRpc(sourceRpc);
  const setUltra = useRpc(ultraRpc);
  const cache = useQueryClient();
  const [tab, setTab] = useState<"accounts" | "routes">("accounts");
  const [filter, setFilter] = useState("");
  const [callback, setCallback] = useState("");
  const [localFlow, setLocalFlow] = useState<SignIn | null>(null);
  const [linkError, setLinkError] = useState("");
  const snapshot = useQuery({
    queryKey: key,
    queryFn: () => getSnapshot({ refresh: false }),
    refetchInterval: 30000,
    retry: false,
  });
  const data = snapshot.data;
  const candidate = localFlow ?? data?.signIn;
  const login = useQuery({
    queryKey: ["magpie", "login", candidate?.id],
    queryFn: () => poll({ id: candidate!.id }),
    enabled: pending(candidate),
    retry: false,
    refetchInterval: (query) => (query.state.data && !pending(query.state.data) ? false : 2000),
  });
  const flow = login.data?.id === candidate?.id ? login.data : candidate;
  const updateSnapshot = (result: Snapshot) => cache.setQueryData(key, result);
  const refresh = useMutation({
    mutationFn: () => getSnapshot({ refresh: true }),
    onSuccess: updateSnapshot,
  });
  const startService = useMutation({ mutationFn: () => start({}), onSuccess: updateSnapshot });
  const sourceChange = useMutation({ mutationFn: setSource, onSuccess: updateSnapshot });
  const ultraChange = useMutation({ mutationFn: setUltra, onSuccess: updateSnapshot });
  const signIn = useMutation({
    mutationFn: (agent: "codex" | "claude") => begin({ agent }),
    onSuccess: (result) => {
      setLocalFlow(result);
      setCallback("");
      setLinkError("");
      cache.setQueryData(["magpie", "login", result.id], result);
    },
  });
  const complete = useMutation({
    mutationFn: () => submit({ id: flow!.id, callback }),
    onSuccess: () => {
      setCallback("");
      void cache.invalidateQueries({ queryKey: ["magpie", "login"] });
    },
  });
  const cancelLogin = useMutation({
    mutationFn: () => cancel({ id: flow!.id }),
    onSuccess: () => {
      if (flow) {
        const stopped = { ...flow, state: "canceled" as const };
        setLocalFlow(stopped);
        cache.setQueryData(["magpie", "login", flow.id], stopped);
      }
      setCallback("");
    },
  });
  useEffect(() => {
    if (flow?.state === "done") {
      setCallback("");
      void cache.invalidateQueries({ queryKey: key });
    }
  }, [flow?.id, flow?.state, cache]);
  const onAction = useCallback<OnAction>(
    (action, value) => {
      switch (action) {
        case "accounts":
        case "routes":
          setTab(action);
          break;
        case "refresh":
          refresh.mutate();
          break;
        case "start":
          startService.mutate();
          break;
        case "codex":
        case "claude":
          complete.reset();
          cancelLogin.reset();
          signIn.mutate(action);
          break;
        case "submit":
          complete.mutate();
          break;
        case "cancel":
          cancelLogin.mutate();
          break;
        case "open":
          setLinkError("");
          if (flow?.url)
            void openExternal(flow.url).catch(() =>
              setLinkError("无法打开浏览器，请复制下方登录网址。"),
            );
          break;
        case "auto":
        case "personal":
        case "ichat":
          if (value) sourceChange.mutate({ groupId: value, source: action });
          break;
        case "ultra": {
          const group = data?.groups.find((entry) => entry.id === value);
          if (group) ultraChange.mutate({ groupId: group.id, enabled: !group.ultraEnabled });
          break;
        }
      }
    },
    [refresh, startService, complete, cancelLogin, signIn, flow, sourceChange, ultraChange, data],
  );
  return {
    data,
    snapshot,
    flow,
    refresh,
    startService,
    sourceChange,
    ultraChange,
    signIn,
    complete,
    cancelLogin,
    login,
    tab,
    filter,
    setFilter,
    callback,
    setCallback,
    linkError,
    onAction,
  };
}
type Model = ReturnType<typeof useMagpie>;

function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const c = theme.colors;
    return StyleSheet.create({
      screen: { flex: 1, backgroundColor: c.surface0 },
      content: {
        padding: compact ? 16 : 28,
        gap: 18,
        maxWidth: 1120,
        width: "100%",
        alignSelf: "center",
      },
      card: {
        padding: compact ? 16 : 20,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        gap: 12,
      },
      row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
      between: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      },
      columns: { flexDirection: compact ? "column" : "row", gap: 14 },
      group: { gap: 6 },
      detail: { gap: 3 },
      window: { gap: 7 },
      flex: { flex: 1 },
      summary: { flex: 1, minWidth: 180, gap: 5 },
      heading: { color: c.foreground, fontSize: 28, fontWeight: "700" },
      title: { color: c.foreground, fontSize: 17, fontWeight: "600" },
      text: { color: c.foreground, fontSize: 14 },
      muted: { color: c.foregroundMuted, fontSize: 13, lineHeight: 20 },
      small: { color: c.foregroundMuted, fontSize: 11, lineHeight: 18 },
      success: { color: c.statusSuccess, fontSize: 13, lineHeight: 20 },
      warning: { color: c.statusWarning, fontSize: 13, lineHeight: 20 },
      danger: { color: c.statusDanger, fontSize: 13, lineHeight: 20 },
      input: {
        color: c.foreground,
        backgroundColor: c.surface0,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        minHeight: 44,
        fontSize: 14,
      },
      progress: { height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: "hidden" },
    });
  }, [theme, compact]);
}
type Styles = ReturnType<typeof useStyles>;
interface SectionProps {
  model: Model;
  styles: Styles;
  theme: PluginTheme;
}

function Action({
  title,
  action,
  value,
  onAction,
  disabled = false,
  primary = false,
  theme,
}: {
  title: string;
  action: ActionName;
  value?: string;
  onAction: OnAction;
  disabled?: boolean;
  primary?: boolean;
  theme: PluginTheme;
}) {
  const press = useCallback(() => onAction(action, value), [onAction, action, value]);
  const state = useMemo(() => ({ disabled }), [disabled]);
  const textStyle = useMemo(
    () => ({
      color: primary ? theme.colors.accentForeground : theme.colors.foreground,
      fontSize: 14,
      fontWeight: "600" as const,
      textAlign: "center" as const,
    }),
    [primary, theme],
  );
  const style = useCallback(
    ({ pressed }: { pressed: boolean }) => {
      let opacity = 1;
      if (disabled) opacity = 0.45;
      else if (pressed) opacity = 0.75;
      return {
        minHeight: 44,
        paddingVertical: 11,
        paddingHorizontal: 16,
        borderRadius: 9,
        justifyContent: "center" as const,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
        opacity,
      };
    },
    [disabled, primary, theme],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={state}
      disabled={disabled}
      onPress={press}
      style={style}
    >
      <Text style={textStyle}>{title}</Text>
    </Pressable>
  );
}

function statusDetails(m: Model) {
  const sources = m.data?.providers.filter((p) => p.ready).length ?? 0;
  const fallbacks =
    m.data?.groups.filter(
      (g) =>
        g.routing === "order" &&
        g.members[0]?.id.match(/^(codex|claude)\//) &&
        g.members[1]?.id.startsWith("ichat/"),
    ).length ?? 0;
  const error =
    m.snapshot.error ??
    m.refresh.error ??
    m.startService.error ??
    m.signIn.error ??
    m.complete.error ??
    m.cancelLogin.error ??
    m.login.error;
  return { sources, fallbacks, error };
}

function Status({ model: m, styles: s, theme }: SectionProps) {
  const { sources, fallbacks, error } = statusDetails(m);
  let title = "Magpie 暂不可用";
  if (m.snapshot.isPending) title = "正在连接…";
  else if (m.data?.available) title = "Magpie 已连接";
  return (
    <View style={s.card}>
      <View style={s.between}>
        <View style={s.summary}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.muted}>
            {m.data?.available
              ? `${sources} 个来源可用 · ${fallbacks} 条个人优先路由`
              : "服务就绪后即可在这里查看账号与 API 来源。"}
          </Text>
        </View>
        {m.data?.available ? (
          <Action
            title={m.refresh.isPending ? "刷新中…" : "刷新额度"}
            action="refresh"
            onAction={m.onAction}
            disabled={m.refresh.isPending}
            theme={theme}
          />
        ) : (
          <Action
            title={m.startService.isPending ? "启动中…" : "启动 Magpie"}
            action="start"
            onAction={m.onAction}
            disabled={m.snapshot.isPending || m.startService.isPending}
            theme={theme}
            primary
          />
        )}
      </View>
      {m.data?.issue && <Text style={s.warning}>{m.data.issue}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={s.danger}>
          {errorText(error)}
        </Text>
      )}
    </View>
  );
}

function Account({ id, model: m, styles: s, theme }: SectionProps & { id: string }) {
  const provider = m.data?.providers.find((p) => p.id === id);
  const loginAgent = id === "codex" || id === "claude" ? id : null;
  const status = providerStatus(provider, Boolean(loginAgent));
  return (
    <View style={s.card}>
      <Text style={s.title}>{labels[id] || provider?.name || id}</Text>
      <Text style={provider?.ready ? s.success : s.muted}>{status}</Text>
      {provider?.accounts.map((account) => (
        <View key={account.user} style={s.detail}>
          <Text selectable style={s.text}>
            {account.user}
          </Text>
          <Text style={s.muted}>
            {[account.plan, accountStatus(account)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ))}
      {provider && <Text style={s.muted}>{provider.modelCount} 个模型可用</Text>}
      {loginAgent && (
        <Action
          title={`登录${loginAgent === "codex" ? " ChatGPT" : " Claude"}`}
          theme={theme}
          primary={!provider?.ready}
          disabled={!m.data?.available || m.signIn.isPending || pending(m.flow)}
          action={loginAgent}
          onAction={m.onAction}
        />
      )}
    </View>
  );
}
function providerStatus(provider: Snapshot["providers"][number] | undefined, canLogin: boolean) {
  if (provider?.ready) return "已接入";
  if (provider?.accounts.length) return "账号需要检查";
  return canLogin ? "未登录" : "未配置";
}
function accountStatus(account: Snapshot["providers"][number]["accounts"][number]) {
  if (account.needsLogin) return "需要重新登录";
  return account.enabled ? "已启用" : "已暂停";
}

function Login({ model: m, styles: s, theme }: SectionProps) {
  const flow = m.flow;
  if (!flow) return null;
  let content;
  if (flow.state === "done")
    content = (
      <Text style={s.success}>
        登录成功{flow.user ? `：${flow.user}` : ""}。路由会自动发现该账号。
      </Text>
    );
  else if (flow.state === "canceled") content = <Text style={s.muted}>登录已取消。</Text>;
  else if (flow.state === "failed")
    content = <Text style={s.danger}>{flow.error || "登录未完成，请重新开始。"}</Text>;
  else content = <LoginPending model={m} styles={s} theme={theme} flow={flow} />;
  return (
    <View style={s.card}>
      <Text style={s.title}>{labels[flow.agent]} 登录</Text>
      {content}
      {m.linkError !== "" && <Text style={s.danger}>{m.linkError}</Text>}
    </View>
  );
}
function LoginPending({ model: m, styles: s, theme, flow }: SectionProps & { flow: SignIn }) {
  return (
    <>
      <Text style={s.muted}>
        {flow.state === "installing"
          ? "Magpie 正在准备登录，请稍候。"
          : "打开登录页面，使用你的个人账号完成授权。"}
      </Text>
      {flow.url !== "" && (
        <>
          <Action title="打开登录页面" primary theme={theme} action="open" onAction={m.onAction} />
          <Text selectable style={s.small} numberOfLines={3}>
            {flow.url}
          </Text>
        </>
      )}
      {flow.code && (
        <Text selectable style={s.title}>
          验证码：{flow.code}
        </Text>
      )}
      {(flow.pasteCallback || flow.pasteCode) && (
        <>
          <Text style={s.muted}>
            {flow.pasteCode
              ? "把登录页面显示的 code#state 粘贴到下面。"
              : "如果浏览器最后提示 localhost 无法访问，把地址栏中的完整回调地址粘贴到下面。"}
          </Text>
          <TextInput
            value={m.callback}
            onChangeText={m.setCallback}
            placeholder={flow.pasteCode ? "code#state" : "http://localhost:…/…?code=…"}
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="登录回调地址或授权码"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={s.input}
          />
          <Action
            title={m.complete.isPending ? "提交中…" : "完成登录"}
            primary
            theme={theme}
            disabled={!m.callback.trim() || m.complete.isPending || flow.state !== "waiting"}
            action="submit"
            onAction={m.onAction}
          />
        </>
      )}
      <Action
        title="取消登录"
        theme={theme}
        disabled={m.cancelLogin.isPending || m.complete.isPending}
        action="cancel"
        onAction={m.onAction}
      />
    </>
  );
}

function QuotaWindow({
  window: w,
  styles: s,
  theme,
}: {
  window: Snapshot["quotas"][number]["windows"][number];
  styles: Styles;
  theme: PluginTheme;
}) {
  const percent = Math.min(100, Math.max(0, w.used));
  const value = useMemo(() => ({ min: 0, max: 100, now: percent }), [percent]);
  const fill = useMemo(
    () => ({
      height: 6,
      width: `${percent}%` as `${number}%`,
      backgroundColor: w.used >= 90 ? theme.colors.statusWarning : theme.colors.accent,
    }),
    [percent, w.used, theme],
  );
  return (
    <View style={s.window}>
      <View style={s.between}>
        <Text style={s.text}>{w.name}</Text>
        <Text style={s.muted}>
          {w.unlimited ? "不限额" : `剩余 ${Math.max(0, w.remaining).toFixed(1)}%`}
        </Text>
      </View>
      {!w.unlimited && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={`${w.name} 已用额度`}
          accessibilityValue={value}
          style={s.progress}
        >
          <View style={fill} />
        </View>
      )}
      <Text style={s.muted}>
        {[w.display, w.resetsAt ? `重置：${date(w.resetsAt)}` : ""].filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
}
function Quota({
  quota: q,
  styles: s,
  theme,
}: {
  quota: Snapshot["quotas"][number];
  styles: Styles;
  theme: PluginTheme;
}) {
  return (
    <View style={s.card}>
      <Text style={s.title}>
        {q.name || labels[q.provider] || q.provider}
        {q.plan ? ` · ${q.plan}` : ""}
      </Text>
      {q.user !== "" && (
        <Text selectable style={s.muted}>
          {q.user}
        </Text>
      )}
      {q.balance !== "" && <Text style={s.text}>余额：{q.balance}</Text>}
      {q.error !== "" && <Text style={s.warning}>{q.error}</Text>}
      {q.windows.map((window) => (
        <QuotaWindow key={window.name} window={window} styles={s} theme={theme} />
      ))}
      <Text style={s.small}>数据时间：{date(q.readAt)}</Text>
    </View>
  );
}
function Accounts(props: SectionProps) {
  const { model: m, styles: s, theme } = props;
  return (
    <>
      <View style={s.columns}>
        <View style={s.flex}>
          <Account {...props} id="codex" />
        </View>
        <View style={s.flex}>
          <Account {...props} id="claude" />
        </View>
      </View>
      <Login {...props} />
      {m.data?.providers
        .filter((provider) => provider.id !== "codex" && provider.id !== "claude")
        .map((provider) => (
          <Account key={provider.id} {...props} id={provider.id} />
        ))}
      <Text style={s.title}>额度窗口</Text>
      {(m.data?.quotas.length ?? 0) === 0 && (
        <View style={s.card}>
          <Text style={s.muted}>
            暂无额度数据。登录个人账号后点击“刷新额度”；未提供余额接口的 API key 不会显示剩余额度。
          </Text>
        </View>
      )}
      {m.data?.quotas.map((quota) => (
        <Quota key={`${quota.provider}/${quota.user}`} quota={quota} styles={s} theme={theme} />
      ))}
    </>
  );
}

type Group = Snapshot["groups"][number];
function SourceActions({ group, model: m, styles: s, theme }: SectionProps & { group: Group }) {
  const changing = m.sourceChange.isPending || m.ultraChange.isPending;
  return (
    <View style={s.row}>
      <Action
        title="个人优先"
        theme={theme}
        primary={group.source === "auto"}
        disabled={changing}
        action="auto"
        value={group.id}
        onAction={m.onAction}
      />
      <Action
        title="仅个人"
        theme={theme}
        primary={group.source === "personal"}
        disabled={changing || !group.members[0]?.ready}
        action="personal"
        value={group.id}
        onAction={m.onAction}
      />
      <Action
        title="仅 ichat"
        theme={theme}
        primary={group.source === "ichat"}
        disabled={changing || !group.members[1]?.ready}
        action="ichat"
        value={group.id}
        onAction={m.onAction}
      />
    </View>
  );
}
function UltraAction({ group, model: m, styles: s, theme }: SectionProps & { group: Group }) {
  const disabled =
    m.ultraChange.isPending ||
    m.sourceChange.isPending ||
    !m.data?.speedControlReady ||
    (!group.ultraEnabled &&
      (!group.ultraAvailable || !group.members[0]?.ready || group.source === "ichat"));
  return (
    <>
      <Action
        title={group.ultraEnabled ? "Ultra fast：已请求" : "开启个人 Ultra fast"}
        theme={theme}
        primary={group.ultraEnabled}
        disabled={disabled}
        action="ultra"
        value={group.id}
        onAction={m.onAction}
      />
      <Text style={s.muted}>
        {group.ultraAvailable
          ? "个人账号支持 Ultra fast。实际执行以供应商返回为准，可能增加额度消耗；ichat 回退不使用此档位。"
          : "个人账号当前未提供此模型的 Ultra fast。"}
      </Text>
      {m.ultraChange.isPending && m.ultraChange.variables.groupId === group.id && (
        <Text style={s.muted}>正在保存速度设置…</Text>
      )}
      {m.ultraChange.error && m.ultraChange.variables?.groupId === group.id && (
        <Text accessibilityRole="alert" style={s.danger}>
          {errorText(m.ultraChange.error)}
        </Text>
      )}
    </>
  );
}
function Route(props: SectionProps & { group: Group }) {
  const { group, model: m, styles: s } = props;
  return (
    <View style={s.card}>
      <Text selectable style={s.title}>
        {group.name}
      </Text>
      <Text style={s.muted}>
        策略：{group.routing} · 账号粘滞：{group.affinity}
      </Text>
      {group.controllable && (
        <>
          <SourceActions {...props} />
          {m.sourceChange.isPending && m.sourceChange.variables.groupId === group.id && (
            <Text style={s.muted}>正在切换来源…</Text>
          )}
          {m.sourceChange.error && m.sourceChange.variables?.groupId === group.id && (
            <Text accessibilityRole="alert" style={s.danger}>
              {errorText(m.sourceChange.error)}
            </Text>
          )}
          {group.members[0]?.id.startsWith("codex/") && <UltraAction {...props} />}
        </>
      )}
      {group.members.map((member, index) => (
        <View key={member.id} style={s.row}>
          <Text style={s.muted}>{index + 1}.</Text>
          <Text selectable style={s.text}>
            {member.id}
          </Text>
          <Text style={member.ready ? s.success : s.muted}>
            {member.ready ? "可路由" : "暂不可用"}
          </Text>
        </View>
      ))}
    </View>
  );
}
function Routes(props: SectionProps) {
  const { model: m, styles: s, theme } = props;
  const groups = (m.data?.groups ?? []).filter((g) =>
    (g.name + " " + g.members.map((member) => member.id).join(" "))
      .toLowerCase()
      .includes(m.filter.toLowerCase()),
  );
  return (
    <>
      <Text style={s.muted}>
        按模型选择来源，下一次请求生效。“个人优先”在个人额度不足时回退到 ichat；“仅个人”和“仅
        ichat”固定使用所选来源。
      </Text>
      <TextInput
        value={m.filter}
        onChangeText={m.setFilter}
        placeholder="搜索模型或来源"
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="搜索模型路由"
        autoCapitalize="none"
        style={s.input}
      />
      {groups.map((group) => (
        <Route {...props} key={group.id} group={group} />
      ))}
      {groups.length === 0 && <Text style={s.muted}>没有匹配的路由。</Text>}
    </>
  );
}

export function MagpieSurface({ theme, layout, host }: PluginSurfaceProps) {
  const model = useMagpie();
  const styles = useStyles(theme, layout.compact);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.group}>
        <Text style={styles.heading}>Magpie</Text>
        <Text style={styles.muted}>{host.label} · 账号、额度与模型路由</Text>
      </View>
      <Status model={model} styles={styles} theme={theme} />
      <View style={styles.row}>
        <Action
          title="账号与额度"
          action="accounts"
          onAction={model.onAction}
          primary={model.tab === "accounts"}
          theme={theme}
        />
        <Action
          title={`模型路由 (${model.data?.groups.length ?? 0})`}
          action="routes"
          onAction={model.onAction}
          primary={model.tab === "routes"}
          theme={theme}
        />
      </View>
      {model.tab === "accounts" ? (
        <Accounts model={model} styles={styles} theme={theme} />
      ) : (
        <Routes model={model} styles={styles} theme={theme} />
      )}
      <Text style={styles.small}>更新于 {date(model.data?.checkedAt ?? "")}</Text>
    </ScrollView>
  );
}
