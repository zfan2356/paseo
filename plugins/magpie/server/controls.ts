import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Transport } from "./magpie.js";
import type { Snapshot } from "../shared/magpie.js";
import { personalUltraModels } from "./codex-catalog.js";

const run = promisify(execFile);
const optionsSchema = z.object({ ultrafastModels: z.array(z.string()).default([]) });
const pluginFile = z.object({
  plugins: z.array(
    z.object({ spec: z.string(), off: z.boolean().optional(), options: optionsSchema.optional() }),
  ),
});
export interface SpeedSettings {
  ready: boolean;
  models: string[];
  spec: string;
}
export interface SpeedStore {
  read(): Promise<SpeedSettings>;
  save(settings: SpeedSettings): Promise<void>;
}

export const localSpeedStore: SpeedStore = {
  async read() {
    const file = join(homedir(), ".config/magpie/plugins.json");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { ready: false, models: [], spec: "" };
      throw error;
    }
    const entries = pluginFile
      .parse(JSON.parse(text))
      .plugins.filter((p) => basename(p.spec) === "personal-speed.middleware.js");
    if (entries.length !== 1) return { ready: false, models: [], spec: "" };
    const p = entries[0];
    return { ready: !p.off, models: p.options?.ultrafastModels ?? [], spec: p.spec };
  },
  async save(settings) {
    try {
      await run(
        join(homedir(), ".local/bin/magpie"),
        ["plugin", "options", settings.spec, JSON.stringify({ ultrafastModels: settings.models })],
        { timeout: 30000, maxBuffer: 16384 },
      );
    } catch {
      throw new Error("无法保存 ultra fast 设置，请检查 Magpie 中间件状态。");
    }
  },
};

const groupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    members: z.array(z.string()),
    routing: z.string().optional(),
    pick: z.string().optional(),
    memberInfo: z.array(z.object({ id: z.string(), ready: z.boolean().optional() })).optional(),
  })
  .passthrough();

export function controlledMembers(
  members: string[],
): { personal: string; ichat: string; model: string } | null {
  if (members.length !== 2) return null;
  const [personal, ichat] = members;
  const match = /^(codex|claude)\/(.+)$/.exec(personal);
  if (!match || ichat !== `ichat/${match[2]}`) return null;
  return { personal, ichat, model: match[2] };
}

export function sourceOf(group: {
  members: string[];
  routing?: string;
  pick?: string;
}): "auto" | "personal" | "ichat" | "custom" {
  const members = controlledMembers(group.members);
  if (!members) return "custom";
  if (group.routing === "order") return "auto";
  if (group.routing !== "manual") return "custom";
  if (!group.pick) return "personal";
  if (group.pick === members.personal) return "personal";
  if (group.pick === members.ichat) return "ichat";
  return "custom";
}

export class Controls {
  private changing = false;
  constructor(
    private readonly send: Transport,
    private readonly store: SpeedStore = localSpeedStore,
  ) {}

  private async ultraModels(): Promise<Set<string>> {
    return personalUltraModels(await this.send("/api/state"));
  }

  async enrich(snapshot: Snapshot): Promise<void> {
    try {
      const [speed, available] = await Promise.all([this.store.read(), this.ultraModels()]);
      snapshot.speedControlReady = speed.ready;
      for (const group of snapshot.groups) {
        const members = controlledMembers(group.members.map((m) => m.id));
        group.controllable = members !== null;
        group.ultraEnabled = !!members && speed.models.includes(members.model);
        group.ultraAvailable = !!members && available.has(members.personal);
      }
    } catch {
      snapshot.issue = "账号和路由已读取，但 ultra fast 设置读取失败。";
    }
  }

  private async group(id: string) {
    if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(id)) throw new Error("无效的模型路由。");
    const data = z.object({ groups: z.array(groupSchema) }).parse(await this.send("/api/groups"));
    const group = data.groups.find((g) => g.id === id);
    if (!group || !controlledMembers(group.members))
      throw new Error("此路由不是个人账号与 ichat 的两来源路由，请在 Magpie 中检查。");
    return group;
  }

  async source(id: string, source: "auto" | "personal" | "ichat"): Promise<void> {
    if (this.changing) throw new Error("正在保存另一项设置，请稍后重试。");
    this.changing = true;
    try {
      const group = await this.group(id);
      const members = controlledMembers(group.members)!;
      const pick = source === "personal" ? members.personal : members.ichat;
      if (source !== "auto" && !group.memberInfo?.some((m) => m.id === pick && m.ready))
        throw new Error("该来源当前不可用，请先登录账号或启用对应模型。");
      await this.send("/api/groups/save", {
        ...group,
        routing: source === "auto" ? "order" : "manual",
        pick: source === "auto" ? "" : pick,
      });
    } finally {
      this.changing = false;
    }
  }

  async ultra(id: string, enabled: boolean): Promise<void> {
    if (this.changing) throw new Error("正在保存另一项设置，请稍后重试。");
    this.changing = true;
    try {
      const group = await this.group(id);
      const members = controlledMembers(group.members)!;
      if (!members.personal.startsWith("codex/"))
        throw new Error("Ultra fast 仅适用于个人 ChatGPT / Codex 来源。");
      if (
        enabled &&
        (!group.memberInfo?.some((m) => m.id === members.personal && m.ready) ||
          sourceOf(group) === "ichat")
      )
        throw new Error("请先启用个人来源并登录对应账号。");
      if (enabled && !(await this.ultraModels()).has(members.personal))
        throw new Error("个人账号的模型列表未提供此模型的 Ultra fast，请选择支持的模型。");
      const settings = await this.store.read();
      if (!settings.ready) throw new Error("个人速度中间件未启用，请检查 Magpie 插件。");
      const models = settings.models.filter((m) => m !== members.model);
      if (enabled) models.push(members.model);
      await this.store.save({ ...settings, models });
    } finally {
      this.changing = false;
    }
  }
}
