import { mobileOrigin, type MobileRequest, type MobileResponse } from "../shared/mobile.js";
import { mobileRuntime } from "../shared/mobile-runtime.js";
import { bridgeModuleImports } from "../shared/mobile-scripts.js";
import { managementReader, requestManagement } from "./connection.js";
export { managementPath } from "./connection.js";
export type ReadResource = (request: MobileRequest) => Promise<MobileResponse>;
export const readManagement: ReadResource = requestManagement;

function resource(path: string): MobileRequest {
  return { path, method: "GET", body: "", contentType: "" };
}

export async function mobileDocument(read?: ReadResource): Promise<{ html: string }> {
  const readResource = read ?? (await managementReader());
  async function text(path: string): Promise<string> {
    const response = await readResource(resource(path));
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
    const path = "/" + match[1].replace(/^\//, "");
    const body = resources.get(path);
    if (body === undefined) throw new Error("Magpie 页面脚本缺失。");
    html = html.replace(
      match[0],
      () =>
        `<script>${bridgeModuleImports(body, mobileOrigin + path).replace(/<\/script/gi, "<\\/script")}</script>`,
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
    "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; form-action 'none'; base-uri " +
    mobileOrigin;
  const bootstrap = `<base href="${mobileOrigin}/"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${mobileRuntime}</script>`;
  html = html.replace(/<head>/i, () => `<head>${bootstrap}`);
  // Official 0.1.3056 is ~7 MiB as JSON. Stay below the host/relay frame limits.
  if (Buffer.byteLength(JSON.stringify({ html })) > 16 * 1024 * 1024) {
    throw new Error("Magpie 手机页面超过传输大小限制。");
  }
  return { html };
}
