import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { webUiLink } from "./web.js";

test("opens the upstream management server with its existing private sign-in key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "magpie-web-"));
  const keyPath = join(directory, "web-key");
  try {
    await writeFile(keyPath, "test-management-key_123456\n", { mode: 0o600 });
    expect(await webUiLink(keyPath)).toEqual({
      url: "http://127.0.0.1:3430/?k=test-management-key_123456",
    });
    await writeFile(keyPath, "invalid&redirect=elsewhere");
    await expect(webUiLink(keyPath)).rejects.toThrow("Magpie");
    await rm(keyPath);
    await expect(webUiLink(keyPath)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
