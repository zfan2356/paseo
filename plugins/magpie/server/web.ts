import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

interface WebUiPaths {
  keyPath?: string;
  configPath?: string;
}

const configSchema = z.object({ url: z.url() }).strict();

async function pageUrl(configPath: string): Promise<URL> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new URL("http://127.0.0.1:3430/");
    }
    throw error;
  }
  const config = configSchema.parse(JSON.parse(text));
  const url = new URL(config.url);
  const validProtocol = url.protocol === "http:" || url.protocol === "https:";
  const originOnly =
    url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if (!validProtocol || !originOnly) {
    throw new Error("Magpie 页面地址必须是 HTTP(S) 根地址，不能包含账号、路径或查询参数。");
  }
  return url;
}

export async function webUiLink({
  keyPath = join(homedir(), ".local/state/magpie/web-key"),
  configPath = join(homedir(), ".config/magpie/paseo-web.json"),
}: WebUiPaths = {}): Promise<{ url: string }> {
  const key = (await readFile(keyPath, "utf8")).trim();
  if (!/^[a-zA-Z0-9._~-]{16,}$/.test(key)) {
    throw new Error("Magpie 管理凭据格式不正确。");
  }
  const url = await pageUrl(configPath);
  url.searchParams.set("k", key);
  return { url: url.href };
}
