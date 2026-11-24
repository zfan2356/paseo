import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import { snapshotSchema, signInSchema } from "../shared/magpie.js";
import type { Operation } from "./operations.js";

export interface SshConfig {
  host: string;
  port: number;
  directory: string;
  bun: string;
}
export function sshConfig(env: NodeJS.ProcessEnv): SshConfig | null {
  if (!env.PASEO_MAGPIE_SSH_HOST) return null;
  const host = env.PASEO_MAGPIE_SSH_HOST;
  const port = Number(env.PASEO_MAGPIE_SSH_PORT ?? "22");
  const directory = env.PASEO_MAGPIE_REMOTE_DIR ?? "";
  const bun = env.PASEO_MAGPIE_REMOTE_BUN ?? "bun";
  if (
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !directory.startsWith("/") ||
    directory.includes("\n") ||
    !bun ||
    bun.includes("\n")
  ) {
    throw new Error("请检查 Magpie SSH 主机、端口和远程插件绝对路径配置。");
  }
  return { host, port, directory, bun };
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function sshArguments(config: SshConfig): string[] {
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "-p",
    String(config.port),
    "--",
    config.host,
    `cd ${quote(config.directory)} && exec ${quote(config.bun)} run server/remote-entry.ts`,
  ];
}

const replySchema = z.object({
  id: z.number().int(),
  value: z.unknown().optional(),
  error: z.string().optional(),
});
const okSchema = z.object({ ok: z.literal(true) });
type Launch = (command: string, args: string[]) => ChildProcessWithoutNullStreams;
const launch: Launch = (command, args) => spawn(command, args, { stdio: "pipe" });
export class SshBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly config: SshConfig,
    private readonly spawnWorker: Launch = launch,
  ) {}

  private connect() {
    if (this.child) return this.child;
    const child = this.spawnWorker("ssh", sshArguments(this.config));
    this.child = child;
    let buffer = "";
    child.stdout.setEncoding("utf8");
    // SSH diagnostics can contain local paths; expose only an actionable bounded error.
    child.stderr.resume();
    child.on("error", () => this.disconnect(child));
    child.on("close", () => this.disconnect(child));
    child.stdin.on("error", () => this.disconnect(child));
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) {
        this.disconnect(child);
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const reply = replySchema.parse(JSON.parse(line));
          const request = this.pending.get(reply.id);
          if (!request) continue;
          this.pending.delete(reply.id);
          clearTimeout(request.timer);
          if (reply.error)
            request.reject(new Error("远程 Magpie 操作失败，请检查服务与账号状态。"));
          else request.resolve(reply.value);
        } catch {
          this.disconnect(child);
          return;
        }
      }
    });
    return child;
  }
  private disconnect(child: ChildProcessWithoutNullStreams) {
    if (this.child !== child) return;
    this.child = null;
    child.kill();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("无法连接远程 Magpie，请检查 SSH 和远程插件部署。"));
    }
    this.pending.clear();
  }
  private request(operation: Operation): Promise<unknown> {
    const child = this.connect();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.disconnect(child), 60000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, operation }) + "\n");
    });
  }
  async snapshot(refresh = false) {
    return snapshotSchema.parse(await this.request({ method: "snapshot", refresh }));
  }
  async start() {
    return snapshotSchema.parse(await this.request({ method: "start" }));
  }
  readonly controls = {
    source: async (groupId: string, source: "auto" | "personal" | "ichat") => {
      await this.request({ method: "source", groupId, source });
    },
    ultra: async (groupId: string, enabled: boolean) => {
      await this.request({ method: "ultra", groupId, enabled });
    },
  };
  async begin(agent: "codex" | "claude") {
    return signInSchema.parse(await this.request({ method: "begin", agent }));
  }
  async poll(id: string) {
    return signInSchema.parse(await this.request({ method: "poll", id }));
  }
  async submit(id: string, callback: string) {
    return okSchema.parse(await this.request({ method: "submit", id, callback }));
  }
  async cancel(id: string) {
    return okSchema.parse(await this.request({ method: "cancel", id }));
  }
  dispose() {
    if (this.child) this.disconnect(this.child);
  }
}
