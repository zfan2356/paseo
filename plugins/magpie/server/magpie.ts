import type { Snapshot, SignIn } from "../shared/magpie.js";
import { projectSnapshot, projectSignIn, validCallback } from "./projection.js";
import { Controls } from "./controls.js";
import { requestManagement, startManagement } from "./connection.js";

export type Transport = (path: string, body?: unknown) => Promise<unknown>;
export const localRequest: Transport = async (path, body) => {
  const response = await requestManagement({
    path,
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? "" : Buffer.from(JSON.stringify(body)).toString("base64"),
    contentType: "application/json",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Magpie 操作未成功（HTTP ${response.status}）。`);
  }
  try {
    return response.status === 204
      ? {}
      : JSON.parse(Buffer.from(response.body, "base64").toString("utf8"));
  } catch {
    throw new Error("Magpie 返回了无法识别的数据。");
  }
};

export class MagpieBridge {
  private flow: SignIn | null = null;
  private starting = false;
  readonly controls: Controls;
  constructor(private readonly send: Transport = localRequest) {
    this.controls = new Controls(send);
  }
  private activeFlow(): SignIn | null {
    return this.flow && ["waiting", "installing"].includes(this.flow.state) ? this.flow : null;
  }

  async snapshot(refresh = false): Promise<Snapshot> {
    try {
      const quota = this.send(`/api/usage/quotas${refresh ? "?asked=1" : ""}`).then(
        (data) => ({ data: { data }, failed: false }),
        () => ({ data: { data: [] }, failed: true }),
      );
      const [providers, groups, quotas] = await Promise.all([
        this.send("/api/providers"),
        this.send("/api/groups"),
        quota,
      ]);
      const result = projectSnapshot(providers, groups, quotas.data);
      await this.controls.enrich(result);
      if (quotas.failed) result.issue = "网关已连接，但本次额度读取失败。";
      result.signIn = this.activeFlow();
      return result;
    } catch {
      return {
        available: false,
        speedControlReady: false,
        issue: "无法读取 Magpie。请启动服务；若服务已运行，请检查管理界面和本机凭据。",
        checkedAt: new Date().toISOString(),
        providers: [],
        groups: [],
        quotas: [],
        signIn: this.activeFlow(),
      };
    }
  }

  async start(): Promise<Snapshot> {
    await startManagement();
    return this.snapshot();
  }

  async begin(agent: "codex" | "claude"): Promise<SignIn> {
    if (this.starting) throw new Error("正在准备登录，请稍候。");
    this.starting = true;
    try {
      if (this.flow && ["waiting", "installing"].includes(this.flow.state)) {
        const current = await this.poll(this.flow.id);
        if (["waiting", "installing"].includes(current.state)) {
          if (current.agent === agent) return current;
          throw new Error("请先完成或取消当前登录。");
        }
      }
      this.flow = projectSignIn(await this.send("/api/signin", { agent }));
      return this.flow;
    } finally {
      this.starting = false;
    }
  }

  private owned(id: string): SignIn {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !this.flow || this.flow.id !== id)
      throw new Error("登录会话已失效，请重新开始。");
    return this.flow;
  }
  async poll(id: string): Promise<SignIn> {
    this.owned(id);
    try {
      this.flow = projectSignIn(await this.send(`/api/signin/${id}`));
    } catch {
      this.flow = { ...this.owned(id), state: "failed", error: "无法读取登录状态，请重新开始。" };
    }
    return this.flow;
  }
  async submit(id: string, callback: string): Promise<{ ok: true }> {
    const flow = this.owned(id);
    if (flow.state !== "waiting" || !validCallback(callback.trim(), flow))
      throw new Error(
        "请粘贴本次登录结束时的完整 localhost 地址，或 Claude 页面显示的 code#state。",
      );
    await this.send(`/api/signin/${id}/callback`, { url: callback.trim() });
    return { ok: true };
  }
  async cancel(id: string): Promise<{ ok: true }> {
    this.owned(id);
    await this.send(`/api/signin/${id}/cancel`, {});
    this.flow = { ...this.owned(id), state: "canceled" };
    return { ok: true };
  }
  dispose(): void {
    if (this.flow && ["waiting", "installing"].includes(this.flow.state))
      void this.cancel(this.flow.id).catch(() => {});
  }
}
