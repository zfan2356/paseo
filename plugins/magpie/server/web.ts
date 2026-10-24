import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function webUiLink(
  keyPath = join(homedir(), ".local/state/magpie/web-key"),
): Promise<{ url: string }> {
  const key = (await readFile(keyPath, "utf8")).trim();
  if (!/^[a-zA-Z0-9._~-]{16,}$/.test(key)) {
    throw new Error("Magpie 管理凭据格式不正确。");
  }
  return { url: `http://127.0.0.1:3430/?k=${encodeURIComponent(key)}` };
}
