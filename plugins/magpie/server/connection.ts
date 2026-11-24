import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { MobileRequest, MobileResponse } from "../shared/mobile.js";

const run = promisify(execFile);
const binary = join(homedir(), ".local/bin/magpie");
const configSchema = z
  .object({
    runtime: z.enum(["legacy", "daemon"]).default("legacy"),
    url: z.string().optional(),
    managementUrl: z.string().optional(),
  })
  .strict();

export interface ConnectionOptions {
  configPath?: string;
  keyPath?: string;
  daemonWeb?: () => Promise<string>;
}

export function managementOrigin(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("Magpie 页面地址必须是 HTTP(S) 根地址，不能包含账号、路径或查询参数。");
  }
  return url;
}

export async function connectionConfig({
  configPath = join(homedir(), ".config/magpie/paseo-web.json"),
}: ConnectionOptions = {}) {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return configSchema.parse({});
    throw new Error("无法读取 Magpie 页面配置。", { cause: error });
  }
  try {
    const config = configSchema.parse(JSON.parse(text));
    if (config.url) managementOrigin(config.url);
    if (config.managementUrl) managementOrigin(config.managementUrl);
    return config;
  } catch {
    throw new Error("Magpie 页面配置无效，请检查运行方式和 HTTP(S) 根地址。");
  }
}

async function daemonWeb(): Promise<string> {
  try {
    // Read the official service's link in memory; never persist a second key.
    const { stdout } = await run(binary, ["daemon", "web"], {
      timeout: 10000,
      maxBuffer: 65536,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return stdout;
  } catch {
    throw new Error("无法读取 Magpie 原生服务，请检查 magpie daemon status。");
  }
}

export async function managementConnection(options: ConnectionOptions = {}) {
  const config = await connectionConfig(options);
  let key: string;
  let origin = new URL("http://127.0.0.1:3430/");
  if (config.runtime === "daemon") {
    const output = await (options.daemonWeb ?? daemonWeb)();
    const link = output.match(/https?:\/\/[^\s]+\?k=[a-zA-Z0-9._~-]{16,}/)?.[0];
    if (!link) throw new Error("Magpie 原生服务未提供管理页面，请先启用服务的 Web 页面。");
    const url = new URL(link);
    key = url.searchParams.get("k") ?? "";
    origin = managementOrigin(url.origin);
    if (["0.0.0.0", "[::]"].includes(origin.hostname)) origin.hostname = "127.0.0.1";
  } else {
    try {
      key = (
        await readFile(options.keyPath ?? join(homedir(), ".local/state/magpie/web-key"), "utf8")
      ).trim();
    } catch {
      throw new Error("无法读取 Magpie 管理凭据，请检查插件运行方式。");
    }
  }
  if (!/^[a-zA-Z0-9._~-]{16,}$/.test(key)) throw new Error("Magpie 管理凭据格式不正确。");
  const managementUrl = config.managementUrl ? managementOrigin(config.managementUrl) : origin;
  const cookieOrigin = config.runtime === "daemon" ? origin : managementUrl;
  return {
    key,
    managementUrl,
    cookiePort: cookieOrigin.port || (cookieOrigin.protocol === "https:" ? "443" : "80"),
    pageUrl: config.url ? managementOrigin(config.url) : new URL(managementUrl),
  };
}

export async function startManagement(): Promise<void> {
  const config = await connectionConfig();
  try {
    await run(
      config.runtime === "daemon" ? binary : join(homedir(), ".local/bin/magpie-start"),
      config.runtime === "daemon" ? ["daemon", "start"] : [],
      { timeout: 45000, maxBuffer: 16384 },
    );
  } catch {
    throw new Error("Magpie 启动失败，请在服务器检查已配置的服务。");
  }
}

export function managementPath(path: string): boolean {
  const control = (value: string) =>
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (!path.startsWith("/") || path.startsWith("//") || /[\\#]/.test(path) || control(path))
    return false;
  try {
    const pathname = decodeURIComponent(path.split("?")[0]);
    if (
      pathname.startsWith("//") ||
      pathname.split("/").some((p) => p === "." || p === "..") ||
      /[\\%]/.test(pathname) ||
      control(pathname)
    )
      return false;
    return (
      pathname === "/" ||
      pathname.startsWith("/api/") ||
      /^\/icons\/[a-zA-Z0-9_.-]+\.(svg|png)$/.test(pathname) ||
      /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(js|css)$/.test(pathname)
    );
  } catch {
    return false;
  }
}

function validateRequest(input: MobileRequest): void {
  if (!managementPath(input.path)) throw new Error("不支持的 Magpie 页面资源。");
  if (
    input.method === "GET"
      ? input.body !== ""
      : input.method !== "POST" || !input.path.startsWith("/api/")
  ) {
    throw new Error("不支持的 Magpie 页面请求。");
  }
  if (input.body.length > 2 * 1024 * 1024) throw new Error("Magpie 请求超过大小限制。");
}

export async function requestManagement(
  input: MobileRequest,
  options: ConnectionOptions = {},
): Promise<MobileResponse> {
  validateRequest(input);
  return requestConnected(input, await managementConnection(options));
}

// A document's static resources share one credential read, without a persistent
// cache that could outlive the service's key rotation or configuration changes.
export async function managementReader(options: ConnectionOptions = {}) {
  const connection = await managementConnection(options);
  return (input: MobileRequest) => {
    validateRequest(input);
    return requestConnected(input, connection);
  };
}

function requestConnected(
  input: MobileRequest,
  { managementUrl, key, cookiePort }: Awaited<ReturnType<typeof managementConnection>>,
): Promise<MobileResponse> {
  const payload = Buffer.from(input.body, "base64");
  const request = managementUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const port = managementUrl.port || (managementUrl.protocol === "https:" ? "443" : "80");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: managementUrl.protocol,
        hostname: managementUrl.hostname.replace(/^\[|\]$/g, ""),
        port,
        path: input.path,
        method: input.method,
        headers: {
          Cookie: `magpie_web_${cookiePort}=${key}`,
          ...(input.contentType ? { "Content-Type": input.contentType } : {}),
          ...(input.method === "POST" ? { "Content-Length": payload.length } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            req.destroy(new Error("Magpie 页面资源超过大小限制。"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => reject(new Error("Magpie 连接中断。")));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 502,
            contentType: String(response.headers["content-type"] ?? "application/octet-stream"),
            reading: String(response.headers["x-magpie-reading"] ?? ""),
            body: Buffer.concat(chunks).toString("base64"),
          }),
        );
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error("timeout")), 30000);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", () => reject(new Error("无法连接 Magpie，请检查服务和管理地址。")));
    req.end(payload);
  });
}
