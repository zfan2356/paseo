import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mobileOrigin, type MobileRequest, type MobileResponse } from "../shared/mobile.js";
import { mobileRuntime } from "../shared/mobile-runtime.js";

export type ReadResource = (request: MobileRequest) => Promise<MobileResponse>;
const limit = 4 * 1024 * 1024;

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

export function managementPath(path: string): boolean {
  const local = path.startsWith("/") && !path.startsWith("//");
  const invalidRaw = /[\\#]/.test(path) || containsControlCharacters(path);
  if (!local || invalidRaw) return false;
  try {
    const pathname = decodeURIComponent(path.split("?")[0]);
    const traversal = pathname.split("/").some((part) => part === "." || part === "..");
    const invalidDecoded = /[\\%]/.test(pathname) || containsControlCharacters(pathname);
    if (traversal || invalidDecoded) return false;
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

export const readManagement: ReadResource = async (input) => {
  if (!managementPath(input.path)) throw new Error("不支持的 Magpie 页面资源。");
  const validMethod = input.method === "GET" ? input.body === "" : input.path.startsWith("/api/");
  if (!validMethod) throw new Error("不支持的 Magpie 页面请求。");
  const key = (await readFile(join(homedir(), ".local/state/magpie/web-key"), "utf8")).trim();
  if (!/^[a-zA-Z0-9._~-]{16,}$/.test(key)) throw new Error("Magpie 管理凭据格式不正确。");
  const payload = Buffer.from(input.body, "base64");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 3430,
        path: input.path,
        method: input.method,
        headers: {
          Cookie: `magpie_web_3430=${key}`,
          ...(input.contentType ? { "Content-Type": input.contentType } : {}),
          ...(input.method === "POST" ? { "Content-Length": payload.length } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            req.destroy(new Error("Magpie 页面资源超过大小限制。"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 502,
            contentType: String(response.headers["content-type"] ?? "application/octet-stream"),
            reading: String(response.headers["x-magpie-reading"] ?? ""),
            body: Buffer.concat(chunks).toString("base64"),
          });
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("Magpie 页面请求超时。")));
    req.on("error", reject);
    req.end(payload);
  });
};

function resource(path: string): MobileRequest {
  return { path, method: "GET", body: "", contentType: "" };
}

export async function mobileDocument(
  read: ReadResource = readManagement,
): Promise<{ html: string }> {
  async function text(path: string): Promise<string> {
    const response = await read(resource(path));
    if (response.status !== 200) {
      throw new Error(`无法读取 Magpie 页面资源（HTTP ${response.status}）。`);
    }
    return Buffer.from(response.body, "base64").toString("utf8");
  }
  let html = await text("/");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi)];
  const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi)];
  const paths = [...scripts, ...styles].map((match) => "/" + match[1].replace(/^\//, ""));
  const contents = await Promise.all(paths.map(text));
  const resources = new Map(paths.map((path, index) => [path, contents[index]]));
  for (const match of scripts) {
    const body = resources.get("/" + match[1].replace(/^\//, ""));
    if (body === undefined) throw new Error("Magpie 页面脚本缺失。");
    html = html.replace(
      match[0],
      () => `<script>${body.replace(/<\/script/gi, "<\\/script")}</script>`,
    );
  }
  for (const match of styles) {
    const body = resources.get("/" + match[1].replace(/^\//, ""));
    if (body === undefined) throw new Error("Magpie 页面样式缺失。");
    html = html.replace(
      match[0],
      () => `<style>${body.replace(/<\/style/gi, "<\\/style")}</style>`,
    );
  }
  html = html.replace(/<link\b[^>]*rel="icon"[^>]*>/gi, "");
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; form-action 'none'; base-uri " +
    mobileOrigin;
  const bootstrap = `<base href="${mobileOrigin}/"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${mobileRuntime}</script>`;
  html = html.replace(/<head>/i, () => `<head>${bootstrap}`);
  if (Buffer.byteLength(JSON.stringify({ html })) > 6 * 1024 * 1024) {
    throw new Error("Magpie 手机页面超过传输大小限制。");
  }
  return { html };
}
