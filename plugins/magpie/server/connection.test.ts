import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { managementConnection, requestManagement } from "./connection.js";
import { webUiLink } from "./web.js";

test("official service discovery reuses its key and separates daemon and client addresses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "magpie-connection-"));
  const configPath = join(directory, "paseo-web.json");
  const key = "test-native-service-key_123456";
  const options = {
    configPath,
    keyPath: join(directory, "must-not-exist"),
    daemonWeb: async () => `page http://10.0.0.5:3430/?k=${key}\n`,
  };
  try {
    await writeFile(configPath, JSON.stringify({ runtime: "daemon" }));
    const connection = await managementConnection(options);
    expect(connection.managementUrl.href).toBe("http://10.0.0.5:3430/");
    expect(await webUiLink(options)).toEqual({ url: `http://10.0.0.5:3430/?k=${key}` });
    await writeFile(
      configPath,
      JSON.stringify({
        runtime: "daemon",
        managementUrl: "https://internal.example:3443",
        url: "https://client.example",
      }),
    );
    expect((await managementConnection(options)).managementUrl.href).toBe(
      "https://internal.example:3443/",
    );
    expect((await managementConnection(options)).cookiePort).toBe("3430");
    expect(await webUiLink(options)).toEqual({ url: `https://client.example/?k=${key}` });
    await expect(
      managementConnection({ ...options, daemonWeb: async () => "service serves no page" }),
    ).rejects.toThrow("未提供管理页面");
    await writeFile(configPath, JSON.stringify({ runtime: "daemon" }));
    const wildcard = await managementConnection({
      ...options,
      daemonWeb: async () => `page http://0.0.0.0:3430/?k=${key}`,
    });
    expect(wildcard.managementUrl.hostname).toBe("127.0.0.1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid resource requests fail before reading host credentials", async () => {
  await expect(
    requestManagement({
      path: "//external.example/api/state",
      method: "GET",
      body: "",
      contentType: "",
    }),
  ).rejects.toThrow("不支持");
  await expect(
    requestManagement({
      path: "/api/state",
      method: "POST",
      body: "A".repeat(2 * 1024 * 1024 + 1),
      contentType: "",
    }),
  ).rejects.toThrow("大小限制");
});
