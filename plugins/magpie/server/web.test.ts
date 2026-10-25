import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { webUiLink } from "./web.js";
import { managementPath, mobileDocument, readManagement, type ReadResource } from "./mobile.js";

test("opens the upstream management server with its existing private sign-in key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "magpie-web-"));
  const keyPath = join(directory, "web-key");
  const paths = { keyPath, configPath: join(directory, "paseo-web.json") };
  try {
    await writeFile(keyPath, "test-management-key_123456\n", { mode: 0o600 });
    expect(await webUiLink(paths)).toEqual({
      url: "http://127.0.0.1:3430/?k=test-management-key_123456",
    });
    await writeFile(keyPath, "invalid&redirect=elsewhere");
    await expect(webUiLink(paths)).rejects.toThrow("Magpie");
    await rm(keyPath);
    await expect(webUiLink(paths)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses a forwarded host without sharing the local Magpie cookie hostname", async () => {
  const directory = await mkdtemp(join(tmpdir(), "magpie-web-"));
  const paths = {
    keyPath: join(directory, "web-key"),
    configPath: join(directory, "paseo-web.json"),
  };
  try {
    await writeFile(paths.keyPath, "remote-management-key_123456", { mode: 0o600 });
    await writeFile(paths.configPath, JSON.stringify({ url: "http://cvm-magpie.localhost:3431" }));
    expect(await webUiLink(paths)).toEqual({
      url: "http://cvm-magpie.localhost:3431/?k=remote-management-key_123456",
    });
    for (const url of [
      "file:///tmp/page",
      "https://user:password@example.com",
      "https://example.com/management",
      "https://example.com/?k=unexpected",
      "https://example.com/#fragment",
    ]) {
      await writeFile(paths.configPath, JSON.stringify({ url }));
      await expect(webUiLink(paths)).rejects.toThrow("Magpie");
    }
    await writeFile(
      paths.configPath,
      JSON.stringify({ url: "https://example.com", unknown: true }),
    );
    await expect(webUiLink(paths)).rejects.toThrow();
    await writeFile(paths.configPath, "{broken");
    await expect(webUiLink(paths)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mobile requests stay within the fixed management service resource paths", () => {
  for (const path of [
    "/",
    "/boot.js",
    "/plugins/routing/client.js",
    "/api/state",
    "/api/icons/a.svg",
    "/icons/codex.svg",
    "/api/providers?name=a%2Fb",
  ]) {
    expect(managementPath(path), path).toBe(true);
  }
  for (const path of [
    "https://example.com/",
    "//example.com/api/state",
    "/api/../secret",
    "/api/%2e%2e/secret",
    "/api/%252e%252e/secret",
    "/api/a\\b",
    "/api/a\nb",
    "/api/%00",
    "/api/%",
    "/api/state#key",
    "/private/config.json",
  ]) {
    expect(managementPath(path), path).toBe(false);
  }
});

test("mobile requests reject GET bodies and writes to static resources before connecting", async () => {
  await expect(
    readManagement({
      path: "/api/state",
      method: "GET",
      body: "e30=",
      contentType: "application/json",
    }),
  ).rejects.toThrow("不支持的 Magpie 页面请求");
  await expect(
    readManagement({
      path: "/app.js",
      method: "POST",
      body: "e30=",
      contentType: "application/json",
    }),
  ).rejects.toThrow("不支持的 Magpie 页面请求");
});

test("mobile document inlines the upstream page without publishing a management key", async () => {
  const files = new Map([
    [
      "/",
      '<html><head><script src="boot.js"></script><link rel="stylesheet" href="app.css"></head><body>Upstream UI<script src="app.js"></script></body></html>',
    ],
    ["/boot.js", "window.bootPrefs = { web: true };"],
    ["/app.js", 'window.originalUI = "</script><p>not markup</p>";'],
    ["/app.css", "body { color: green; }"],
  ]);
  const read: ReadResource = async ({ path, method, body, contentType }) => {
    expect(method).toBe("GET");
    expect(body).toBe("");
    expect(contentType).toBe("");
    const text = files.get(path);
    if (text === undefined) throw new Error("Unexpected resource");
    return {
      status: 200,
      body: Buffer.from(text).toString("base64"),
      contentType: "text/plain",
      reading: "",
    };
  };
  const { html } = await mobileDocument(read);
  expect(html).toContain("Upstream UI");
  expect(html).toContain("window.bootPrefs = { web: true }");
  expect(html).toContain('window.originalUI = "<\\/script>');
  expect(html).toContain("body { color: green; }");
  expect(html).toContain("window.__paseoMagpieReceive");
  expect(html).toContain("connect-src data: blob:");
  expect(html).not.toMatch(/<script src=/);
  expect(html).not.toContain("web-key");
});
