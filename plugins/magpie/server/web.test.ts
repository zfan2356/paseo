import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { webUiLink } from "./web.js";

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
