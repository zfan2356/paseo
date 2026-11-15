import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import type {
  PluginButton,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { snapshotRpc, sourceRpc, ultraRpc, type Snapshot } from "../shared/magpie.js";

type ComposerAgent = Pick<
  PluginAgentSnapshot,
  "id" | "workspaceId" | "provider" | "model" | "featureValues"
>;

const sources = [
  { id: "auto", title: "个人优先" },
  { id: "personal", title: "个人账号" },
  { id: "ichat", title: "iChat" },
] as const;

export function composerGroup(
  snapshot: Snapshot | null,
  agent: Pick<PluginAgentSnapshot, "provider" | "model">,
) {
  if (!snapshot?.available || !["codex", "claude"].includes(agent.provider) || !agent.model)
    return null;
  const id = agent.model.replace(/^(codex|claude|ichat)\//, "").toLowerCase();
  const prefix = agent.provider === "codex" ? "gpt-" : "claude-";
  if (!id.startsWith(prefix)) return null;
  return snapshot.groups.find((group) => group.id === id && group.controllable) ?? null;
}

export function composerSpeed(
  agent: Pick<PluginAgentSnapshot, "featureValues">,
  group: Snapshot["groups"][number],
) {
  if (group.ultraEnabled && group.source !== "ichat") return "Ultra fast";
  const tier = agent.featureValues?.service_tier;
  const fast = tier === "priority" || tier === "fast" || agent.featureValues?.fast_mode === true;
  return fast ? "Fast" : "默认速度";
}

export function createComposerControls(client: PluginClientContext) {
  const agents = new Map<string, ComposerAgent>();
  const pills = new Map<
    string,
    { workspaceId: string; source: PluginButtonRegistration; speed: PluginButtonRegistration }
  >();
  let snapshot: Snapshot | null = null;
  let disposed = false;

  function remove(id: string) {
    pills.get(id)?.source.remove();
    pills.get(id)?.speed.remove();
    pills.delete(id);
    agents.delete(id);
  }

  function render(agent: ComposerAgent) {
    if (disposed) return;
    const group = composerGroup(snapshot, agent);
    if (!agent.workspaceId || !group) {
      pills.get(agent.id)?.source.remove();
      pills.get(agent.id)?.speed.remove();
      pills.delete(agent.id);
      return;
    }
    const source: PluginButton = {
      title: "Magpie 账号来源",
      label: sources.find((item) => item.id === group.source)?.title ?? "自定义来源",
      icon: "CircleUserRound",
      behavior: {
        kind: "menu",
        items: sources.map((item) => ({
          kind: "item",
          id: item.id,
          title: item.title,
          behavior: {
            kind: "action",
            async onPress() {
              snapshot = await client.rpc(sourceRpc, { groupId: group.id, source: item.id });
              renderAll();
            },
          },
        })),
      },
    };
    const speed: PluginButton = {
      title: "Magpie 推理速度",
      label: composerSpeed(agent, group),
      icon: "Gauge",
      behavior: {
        kind: "menu",
        items: [
          {
            kind: "item",
            id: "ultra",
            title: group.ultraEnabled ? "关闭 Ultra fast" : "开启 Ultra fast",
            disabled:
              !group.ultraAvailable || !snapshot?.speedControlReady || group.source === "ichat",
            behavior: {
              kind: "action",
              async onPress() {
                snapshot = await client.rpc(ultraRpc, {
                  groupId: group.id,
                  enabled: !group.ultraEnabled,
                });
                renderAll();
              },
            },
          },
          {
            kind: "item",
            id: "refresh",
            title: "刷新 Magpie 状态",
            behavior: { kind: "action", onPress: refresh },
          },
        ],
      },
    };
    const current = pills.get(agent.id);
    if (current?.workspaceId === agent.workspaceId) {
      current.source.update(source);
      current.speed.update(speed);
    } else {
      current?.source.remove();
      current?.speed.remove();
      const scope = { workspaceId: agent.workspaceId, agentId: agent.id };
      pills.set(agent.id, {
        workspaceId: agent.workspaceId,
        source: client.addComposerPill({ ...scope, id: `source-${agent.id}`, button: source }),
        speed: client.addComposerPill({ ...scope, id: `speed-${agent.id}`, button: speed }),
      });
    }
  }

  function renderAll() {
    for (const agent of agents.values()) render(agent);
  }

  async function refresh() {
    snapshot = await client.rpc(snapshotRpc, { refresh: false });
    renderAll();
  }

  const refreshQuietly = () =>
    void refresh().catch(() => {
      snapshot = null;
      renderAll();
    });
  refreshQuietly();
  const timer = setInterval(refreshQuietly, 60_000);
  return {
    update(agent: ComposerAgent | null) {
      if (disposed) return;
      for (const id of agents.keys()) if (id !== agent?.id) remove(id);
      if (agent) {
        agents.set(agent.id, agent);
        render(agent);
      }
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      for (const id of pills.keys()) remove(id);
    },
  };
}
