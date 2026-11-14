import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export type Transport = (resource: string, body?: unknown) => Promise<unknown>;
interface ManagementOptions {
  home?: string;
  web?: () => Promise<string>;
}
const run = promisify(execFile);
const configSchema = z
  .object({
    runtime: z.enum(["legacy", "daemon"]).default("legacy"),
    url: z.string().optional(),
    managementUrl: z.string().optional(),
  })
  .strict();

function managementOrigin(value: string): URL {
  const url = new URL(value);
  const root = url.pathname === "/" && !url.search && !url.hash;
  const http = url.protocol === "http:" || url.protocol === "https:";
  if (!http || !root || url.username || url.password)
    throw new Error("Invalid Magpie management origin");
  return url;
}

async function connection(options: ManagementOptions) {
  const home = options.home ?? homedir();
  let config: z.infer<typeof configSchema>;
  try {
    config = configSchema.parse(
      JSON.parse(await readFile(join(home, ".config/magpie/paseo-web.json"), "utf8")),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    config = configSchema.parse({});
  }
  let origin = new URL("http://127.0.0.1:3430/");
  let key: string;
  if (config.runtime === "daemon") {
    const web =
      options.web ??
      (async () => {
        const { stdout } = await run(join(home, ".local/bin/magpie"), ["daemon", "web"], {
          timeout: 10000,
          maxBuffer: 65536,
          env: { ...process.env, NO_COLOR: "1" },
        });
        return stdout;
      });
    const output = await web();
    const link = output.match(/https?:\/\/[^\s]+\?k=[a-zA-Z0-9._~-]{16,}/)?.[0];
    if (!link) throw new Error("Magpie management page is unavailable");
    const url = new URL(link);
    origin = managementOrigin(url.origin);
    if (origin.hostname === "0.0.0.0" || origin.hostname === "[::]") origin.hostname = "127.0.0.1";
    key = url.searchParams.get("k") ?? "";
  } else {
    key = (await readFile(join(home, ".local/state/magpie/web-key"), "utf8")).trim();
  }
  if (!/^[a-zA-Z0-9._~-]{16,}$/.test(key)) throw new Error("Invalid Magpie management credential");
  const managementUrl = config.managementUrl ? managementOrigin(config.managementUrl) : origin;
  const cookieOrigin = config.runtime === "daemon" ? origin : managementUrl;
  const cookiePort = cookieOrigin.port || (cookieOrigin.protocol === "https:" ? "443" : "80");
  return { managementUrl, key, cookiePort };
}

export function managementTransport(options: ManagementOptions = {}): Transport {
  return async (resource, body) => {
    const { managementUrl, key, cookiePort } = await connection(options);
    const response = await fetch(new URL(resource, managementUrl), {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: `magpie_web_${cookiePort}=${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(18000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Magpie management request failed");
    return response.json();
  };
}
